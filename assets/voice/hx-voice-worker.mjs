/* Hippo Travel — the website's own voice, made on this device in a background worker. Nothing is sent anywhere.
   English: Piper "Kristin" (fast, public-domain voice). Hindi: Kokoro-82M (Apache-2.0), on the graphics card when it can.
   Messages in : {type:'load', lang} | {type:'say', key, text, lang:'en'|'hi', speed}   (one part at a time)
   Messages out: {type:'progress', lang, loaded, total} | {type:'ready', lang, gpu, why} | {type:'audio', key, pcm (Float32Array), rate}
                 {type:'error', key, message} | {type:'failed', lang, message} */
import { phonemize } from './vendor/phonemizer.js';
import './hx-g2p-hi.js';

const BASE = new URL('./', import.meta.url).href;
const PIPER = 'model/en_US-kristin-medium.onnx', PIPER_SIZE = 63531379;   /* English */
const MODEL = 'model/kokoro-q8.onnx', MODEL_SIZE = 92361116;   /* Hindi, for the processor */
/* for the graphics card (GPU): half-precision model in two files (GitHub takes files up to 100 MB) */
const GPU_PARTS = [['model/kokoro-fp16.1.bin', 81617370], ['model/kokoro-fp16.2.bin', 81617370]], GPU_SIZE = 163234740;
const VOICE = { en: 'af_heart', hi: 'hf_alpha' };
const CACHE = 'hx-voice-v1';
let session = null, vocab = null, loading = null, ort = null, ortP = null, gpu = false, gpuWhy = '', gpuOk = null;
let piper = null, piperCfg = null, piperLoading = null;
const styles = {};

/* the runtime: the graphics-card version when the card can be used (it also runs on the processor), else the processor one */
function useOrt() {
  if (!ortP) ortP = (async () => {
    const g = await gpuCan();
    ort = await import(g ? './vendor/ort.webgpu.min.mjs' : './vendor/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = BASE + 'vendor/';
    ort.env.wasm.numThreads = 1;   /* more threads need special server headers that GitHub Pages does not send */
    ort.env.logLevel = 'error';
  })();
  return ortP;
}

/* a file, from this browser's saved copy when there is one (the voice is downloaded only once) */
async function file(path, onProgress, size) {
  const url = BASE + path;
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return await hit.arrayBuffer(); } catch (e) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download ' + path + ' (' + res.status + ')');
  let buf;
  if (onProgress && res.body) {
    const total = size || +(res.headers.get('Content-Length') || 0);
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(Math.min(got, total), total); }
    const u = new Uint8Array(got); let o = 0; for (const p of parts) { u.set(p, o); o += p.length; }
    buf = u.buffer;
  } else buf = await res.arrayBuffer();
  if (size && buf.byteLength !== size) throw new Error('The voice file did not download fully. Please try again.');
  if (cache) { try { await cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* no space: it works, but downloads again next time */ } }
  return buf;
}

/* several files, downloaded one after the other with one progress, joined into one */
async function joined(parts, total) {
  let done = 0; const bufs = [];
  for (const [p, size] of parts) { bufs.push(new Uint8Array(await file(p, (l) => postMessage({ type: 'progress', lang: 'hi', loaded: done + l, total }), size))); done += size; }
  const u = new Uint8Array(total); let o = 0; for (const b of bufs) { u.set(b, o); o += b.length; }
  return u;
}
/* a graphics card that can run the half-precision model */
async function gpuCan() {
  if (gpuOk !== null) return gpuOk;
  gpuOk = await gpuCheck();
  return gpuOk;
}
async function gpuCheck() {
  try {
    if (!self.navigator || !navigator.gpu) { gpuWhy = 'no WebGPU'; return false; }
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) { gpuWhy = 'no graphics adapter'; return false; }
    if (!a.features.has('shader-f16')) { gpuWhy = 'no half-precision on this graphics card'; return false; }
    return true;
  } catch (e) { gpuWhy = String(e && e.message || e); return false; }
}
/* English: Piper (small and fast, on the processor) */
async function loadEn() {
  if (piper) return;
  if (!piperLoading) piperLoading = (async () => {
    await useOrt();
    piperCfg = JSON.parse(new TextDecoder().decode(await file(PIPER + '.json')));
    const m = await file(PIPER, (l, t) => postMessage({ type: 'progress', lang: 'en', loaded: l, total: t }), PIPER_SIZE);
    piper = await ort.InferenceSession.create(new Uint8Array(m), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })().catch((e) => { piperLoading = null; throw e; });
  return piperLoading;
}
/* Hindi: Kokoro */
async function load() {
  if (session) return;
  if (!loading) loading = (async () => {
    await useOrt();
    vocab = JSON.parse(new TextDecoder().decode(await file('model/tokenizer.json'))).model.vocab;
    await style(VOICE.hi);
    /* 1. the graphics card (much faster), only when it makes a real sound faster than it is spoken */
    if (await gpuCan()) {
      try {
        const m = await joined(GPU_PARTS, GPU_SIZE);
        session = await ort.InferenceSession.create(m, { executionProviders: ['webgpu'] });
        await kokoro('नमस्ते।', 'hi', 1);   /* the first run also prepares the graphics card */
        const t0 = performance.now(), pcm = await kokoro('नमस्ते, यह आवाज़ का एक छोटा सा टेस्ट है।', 'hi', 1), ms = performance.now() - t0;
        let bad = 0, peak = 0; for (const v of pcm) { if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > peak) peak = Math.abs(v); }
        const secs = pcm.length / 24000;
        if (bad || peak < 0.05 || peak > 2 || secs < 1) throw new Error('the graphics card did not make a clear sound');
        if (ms > secs * 1000) throw new Error('the graphics card is slower than speaking (' + Math.round(ms) + ' ms for ' + secs.toFixed(1) + ' s)');
        gpu = true;
      } catch (e) {
        gpuWhy = String(e && e.message || e); gpu = false;
        try { session && (await session.release()); } catch (_) {}
        session = null;
      }
    }
    /* 2. else the processor */
    if (!session) {
      const m = await file(MODEL, (l, t) => postMessage({ type: 'progress', lang: 'hi', loaded: l, total: t }), MODEL_SIZE);
      session = await ort.InferenceSession.create(new Uint8Array(m), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
async function style(name) {
  if (!styles[name]) styles[name] = new Float32Array(await file('model/voices/' + name + '.bin'));
  return styles[name];
}

/* Thai places said the way people in India say them */
const PLACES = [[/\bPhuket\b/gi, 'Poo-ket'], [/\bPhi Phi\b/gi, 'Pee Pee'], [/\bKrabi\b/gi, 'Kra-bee'], [/\bPattaya\b/gi, 'Pat-taya'], [/\bSuvarnabhumi\b/gi, 'Su-varna-bhoomi'], [/\bKoh\b/g, 'Ko']];
/* English text → phonemes (with the small fixes Kokoro's own code makes) */
const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”(){}\[\]]+\s*)+/g;
async function enPhon(text) {
  for (const [a, b] of PLACES) text = text.replace(a, b);
  const out = [];
  let last = 0;
  for (const m of text.matchAll(PUNCT)) {
    if (m.index > last) out.push((await phonemize(text.slice(last, m.index), 'en-us')).join(' '));
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push((await phonemize(text.slice(last), 'en-us')).join(' '));
  return out.join('').replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z').replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di').trim();
}
/* Hindi text: Devanagari words by the website's own rules, Latin words (names, "Costing Sheet") the English way */
async function hiPhon(text) {
  let s = '';
  for (const b of self.HxHindiG2P.hindi(text)) {
    if (b.hi) s += b.hi;
    else if (b.en) s += await enPhon(b.en);
    else if (b.p) s += b.p;
    else if (b.s) s += ' ';
  }
  return s.replace(/\s+/g, ' ').trim();
}
function ids(ph) {
  const out = [0];
  for (const ch of ph) { const id = vocab[ch]; if (id !== undefined) out.push(id); }
  if (out.length > 511) out.length = 511;
  out.push(0);
  return out;
}
/* English with Piper: espeak sounds → the voice's numbers (with a short gap between sounds, as Piper wants) */
async function piperSay(text, speed) {
  for (const [a, b] of PLACES) text = text.replace(a, b);
  const map = piperCfg.phoneme_id_map, out = [...map['^']];
  let last = 0; const bits = [];
  for (const m of text.matchAll(PUNCT)) { if (m.index > last) bits.push([0, text.slice(last, m.index)]); bits.push([1, m[0]]); last = m.index + m[0].length; }
  if (last < text.length) bits.push([0, text.slice(last)]);
  for (const [punct, t] of bits) {
    const ph = punct ? t : (await phonemize(t, piperCfg.espeak.voice || 'en-us')).join(' ');   /* the sounds the voice learnt with */
    for (const c of ph) if (map[c]) { out.push(...map[c]); out.push(...map['_']); }
  }
  out.push(...map['$']);
  if (out.length < 4) return new Float32Array(0);
  const inf = piperCfg.inference;
  const r = await piper.run({
    input: new ort.Tensor('int64', BigInt64Array.from(out.map(BigInt)), [1, out.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(out.length)]), [1]),
    scales: new ort.Tensor('float32', [inf.noise_scale, inf.length_scale / (speed || 1), inf.noise_w], [3]),
  });
  return r[Object.keys(r)[0]].data;
}
async function say(text, lang, speed) {
  if (lang === 'hi') { await load(); return { pcm: await kokoro(text, lang, speed), rate: 24000 }; }
  await loadEn();
  return { pcm: await piperSay(text, speed), rate: piperCfg.audio.sample_rate };
}
async function kokoro(text, lang, speed) {
  const ph = lang === 'hi' ? await hiPhon(text) : await enPhon(text);
  const tok = ids(ph);
  if (tok.length < 3) return new Float32Array(0);
  const st = await style(VOICE[lang] || VOICE.en);
  const row = Math.min(tok.length - 2, 509) * 256;
  const r = await session.run({
    input_ids: new ort.Tensor('int64', BigInt64Array.from(tok.map(BigInt)), [1, tok.length]),
    style: new ort.Tensor('float32', st.slice(row, row + 256), [1, 256]),
    speed: new ort.Tensor('float32', [speed || 1], [1]),
  });
  return r.waveform.data;
}

/* one part at a time: the page keeps the list of parts and gives each helper the next one when it is free */
self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'load') {
    const lang = d.lang === 'hi' ? 'hi' : 'en';
    (lang === 'hi' ? load() : loadEn()).then(() => postMessage({ type: 'ready', lang, gpu: lang === 'hi' && gpu, why: gpuWhy }),
      (er) => postMessage({ type: 'failed', lang, message: String((er && er.message) || er) }));
  } else if (d.type === 'say') {
    say(String(d.text || ''), d.lang, d.speed).then(
      (r) => postMessage({ type: 'audio', key: d.key, pcm: r.pcm, rate: r.rate }, [r.pcm.buffer]),
      (er) => postMessage({ type: 'error', key: d.key, message: String((er && er.message) || er) }));
  }
};
