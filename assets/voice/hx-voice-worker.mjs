/* Hippo Travel — the website's own voice (Kokoro-82M, Apache-2.0), made on this device in a background worker.
   Nothing is sent anywhere: the text is turned into sound inside this browser.
   Messages in : {type:'load'} | {type:'say', key, text, lang:'en'|'hi', speed}   (one at a time)
   Messages out: {type:'progress', loaded, total} | {type:'ready', gpu, why} | {type:'audio', key, pcm (Float32Array, 24 kHz)}
                 {type:'error', key, message} | {type:'failed', message} */
import { phonemize } from './vendor/phonemizer.js';
import './hx-g2p-hi.js';

const BASE = new URL('./', import.meta.url).href;
const MODEL = 'model/kokoro-q8.onnx', MODEL_SIZE = 92361116;   /* for the processor */
/* for the graphics card (GPU): half-precision model in two files (GitHub takes files up to 100 MB) */
const GPU_PARTS = [['model/kokoro-fp16.1.bin', 81617370], ['model/kokoro-fp16.2.bin', 81617370]], GPU_SIZE = 163234740;
const VOICE = { en: 'af_heart', hi: 'hf_alpha' };
const CACHE = 'hx-voice-v1';
let session = null, vocab = null, loading = null, ort = null, gpu = false, gpuWhy = '';
const styles = {};

async function useOrt(path) {
  if (ort) return;
  ort = await import(path);
  ort.env.wasm.wasmPaths = BASE + 'vendor/';
  ort.env.wasm.numThreads = 1;   /* more threads need special server headers that GitHub Pages does not send */
  ort.env.logLevel = 'error';
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
  for (const [p, size] of parts) { bufs.push(new Uint8Array(await file(p, (l) => postMessage({ type: 'progress', loaded: done + l, total }), size))); done += size; }
  const u = new Uint8Array(total); let o = 0; for (const b of bufs) { u.set(b, o); o += b.length; }
  return u;
}
/* a graphics card that can run the half-precision model */
async function gpuCan() {
  try {
    if (!self.navigator || !navigator.gpu) { gpuWhy = 'no WebGPU'; return false; }
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) { gpuWhy = 'no graphics adapter'; return false; }
    if (!a.features.has('shader-f16')) { gpuWhy = 'no half-precision on this graphics card'; return false; }
    return true;
  } catch (e) { gpuWhy = String(e && e.message || e); return false; }
}
async function load() {
  if (session) return;
  if (!loading) loading = (async () => {
    vocab = JSON.parse(new TextDecoder().decode(await file('model/tokenizer.json'))).model.vocab;
    await Promise.all([style(VOICE.en), style(VOICE.hi)]);
    /* 1. the graphics card (much faster), only when it makes a real sound faster than it is spoken */
    if (await gpuCan()) {
      try {
        await useOrt('./vendor/ort.webgpu.min.mjs');
        const m = await joined(GPU_PARTS, GPU_SIZE);
        session = await ort.InferenceSession.create(m, { executionProviders: ['webgpu'] });
        await make('Hello.', 'en', 1);   /* the first run also prepares the graphics card */
        const t0 = performance.now(), pcm = await make('Hello, this is a short test of the voice.', 'en', 1), ms = performance.now() - t0;
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
      await useOrt('./vendor/ort.wasm.min.mjs');
      const m = await file(MODEL, (l, t) => postMessage({ type: 'progress', loaded: l, total: t }), MODEL_SIZE);
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
async function say(text, lang, speed) {
  await load();
  return make(text, lang, speed);
}
async function make(text, lang, speed) {
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
    load().then(() => postMessage({ type: 'ready', gpu, why: gpuWhy }), (er) => postMessage({ type: 'failed', message: String((er && er.message) || er) }));
  } else if (d.type === 'say') {
    say(String(d.text || ''), d.lang, d.speed).then(
      (pcm) => postMessage({ type: 'audio', key: d.key, pcm }, [pcm.buffer]),
      (er) => postMessage({ type: 'error', key: d.key, message: String((er && er.message) || er) }));
  }
};
