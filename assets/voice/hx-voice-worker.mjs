/* Hippo Travel — the website's English voice: Piper "Kristin" (public-domain recordings), made on this device. Nothing is sent anywhere.
   (Hindi has its own two helpers: hx-hindi-gen.mjs + hx-hindi-dec.mjs.)
   Messages in : {type:'load', lang:'en'} | {type:'say', key, text, speed}   (one part at a time)
   Messages out: {type:'progress', lang, loaded, total} | {type:'ready', lang} | {type:'audio', key, pcm (Float32Array), rate}
                 {type:'error', key, message} | {type:'failed', lang, message} */
import * as ort from './vendor/ort.wasm.min.mjs';
import { phonemize } from './vendor/phonemizer.js';

const BASE = new URL('./', import.meta.url).href;
const PIPER = 'model/en_US-kristin-medium.onnx', PIPER_SIZE = 63531379;
const CACHE = 'hx-voice-v1';
ort.env.wasm.wasmPaths = BASE + 'vendor/';
ort.env.wasm.numThreads = 1;   /* more threads need special server headers that GitHub Pages does not send */
ort.env.logLevel = 'error';
let piper = null, cfg = null, loading = null;

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
    const reader = res.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(Math.min(got, total), total); }
    const u = new Uint8Array(got); let o = 0; for (const p of parts) { u.set(p, o); o += p.length; }
    buf = u.buffer;
  } else buf = await res.arrayBuffer();
  if (size && buf.byteLength !== size) throw new Error('The voice file did not download fully. Please try again.');
  if (cache) { try { await cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* no space: it works, but downloads again next time */ } }
  return buf;
}
async function load() {
  if (piper) return;
  if (!loading) loading = (async () => {
    cfg = JSON.parse(new TextDecoder().decode(await file(PIPER + '.json')));
    const m = await file(PIPER, (l, t) => postMessage({ type: 'progress', lang: 'en', loaded: l, total: t }), PIPER_SIZE);
    piper = await ort.InferenceSession.create(new Uint8Array(m), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

/* Thai places said the way people in India say them */
const PLACES = [[/\bPhuket\b/gi, 'Poo-ket'], [/\bPhi Phi\b/gi, 'Pee Pee'], [/\bKrabi\b/gi, 'Kra-bee'], [/\bPattaya\b/gi, 'Pat-taya'], [/\bSuvarnabhumi\b/gi, 'Su-varna-bhoomi'], [/\bKoh\b/g, 'Ko']];
const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”(){}\[\]]+\s*)+/g;
/* espeak sounds → the voice's numbers (with a short gap after each sound, as Piper wants) */
async function say(text, speed) {
  await load();
  for (const [a, b] of PLACES) text = text.replace(a, b);
  const map = cfg.phoneme_id_map, out = [...map['^']];
  let last = 0; const bits = [];
  for (const m of text.matchAll(PUNCT)) { if (m.index > last) bits.push([0, text.slice(last, m.index)]); bits.push([1, m[0]]); last = m.index + m[0].length; }
  if (last < text.length) bits.push([0, text.slice(last)]);
  for (const [punct, t] of bits) {
    const ph = punct ? t : (await phonemize(t, cfg.espeak.voice || 'en-us')).join(' ');   /* the sounds the voice learnt with */
    for (const c of ph) if (map[c]) { out.push(...map[c]); out.push(...map['_']); }
  }
  out.push(...map['$']);
  if (out.length < 4) return new Float32Array(0);
  const inf = cfg.inference;
  const r = await piper.run({
    input: new ort.Tensor('int64', BigInt64Array.from(out.map(BigInt)), [1, out.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(out.length)]), [1]),
    scales: new ort.Tensor('float32', [inf.noise_scale, inf.length_scale / (speed || 1), inf.noise_w], [3]),
  });
  return r[Object.keys(r)[0]].data;
}

self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'load') {
    load().then(() => postMessage({ type: 'ready', lang: 'en' }), (er) => postMessage({ type: 'failed', lang: 'en', message: String((er && er.message) || er) }));
  } else if (d.type === 'say') {
    say(String(d.text || ''), d.speed).then(
      (pcm) => postMessage({ type: 'audio', key: d.key, pcm, rate: cfg.audio.sample_rate }, [pcm.buffer]),
      (er) => postMessage({ type: 'error', key: d.key, message: String((er && er.message) || er) }));
  }
};
