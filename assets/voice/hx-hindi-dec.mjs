/* Hippo Travel — Hindi voice, helper 2 of 2: voice frames → sound (Mimi decoder of Indus Pocket TTS, CC-BY-4.0).
   Frames come from helper 1 (hx-hindi-gen.mjs) through a MessagePort; the sound goes to the page in short pieces (about 0.24 s).
   Messages in : {type:'load'} | {type:'port'} (+ MessagePort from helper 1)
   Port in     : {key, lat (Float32Array 32), reset} | {key, end, aborted}
   Messages out: {type:'progress', loaded, total} | {type:'ready'} | {type:'failed', message} | {type:'frames', key, pcm} | {type:'done', key, aborted} */
import * as ort from './vendor/ort.wasm.min.mjs';

const BASE = new URL('./', import.meta.url).href;
const DIR = 'hindi/';
const CACHE = 'hx-voice-v1';
ort.env.wasm.wasmPaths = BASE + 'vendor/';
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';
const OPT = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', enableMemPattern: false };

let mimi = null, stateList = null, states = null, loading = null;
async function file(path, size) {
  const url = BASE + path;
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return await hit.arrayBuffer(); } catch (e) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download ' + path + ' (' + res.status + ')');
  const buf = await res.arrayBuffer();
  if (size && buf.byteLength !== size) throw new Error('The voice file did not download fully. Please try again.');
  if (cache) { try { await cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) {} }
  return buf;
}
async function load() {
  if (mimi) return;
  if (!loading) loading = (async () => {
    stateList = JSON.parse(new TextDecoder().decode(await file(DIR + 'bundle.json'))).mimi_state;
    mimi = await ort.InferenceSession.create(new Uint8Array(await file(DIR + 'mimi_decoder.onnx', 41330795)), OPT);
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
function fresh() {
  states = {};
  for (const s of stateList) states[s.input_name] = new ort.Tensor('float32', new Float32Array(s.shape.reduce((a, b) => a * b, 1)), s.shape);
}
/* frames are made in order; a few are sent together */
let queue = Promise.resolve(), buf = [], bufKey = null;
function flush(key) {
  if (!buf.length) return;
  const n = buf.reduce((a, b) => a + b.length, 0), pcm = new Float32Array(n); let o = 0;
  for (const b of buf) { pcm.set(b, o); o += b.length; }
  buf = [];
  postMessage({ type: 'frames', key, pcm }, [pcm.buffer]);
}
function onPort(e) {
  const d = e.data || {};
  queue = queue.then(async () => {
    if (bufKey !== d.key) { flush(bufKey); bufKey = d.key; }
    if (d.end) { flush(d.key); postMessage({ type: 'done', key: d.key, aborted: !!d.aborted }); return; }
    if (d.reset || !states) fresh();
    const feeds = Object.assign({ latent: new ort.Tensor('float32', d.lat, [1, 1, 32]) }, states);
    const o = await mimi.run(feeds);
    for (const s of stateList) states[s.input_name] = o[s.output_name];
    const pcm = o.pcm.data, clean = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) { const v = pcm[i]; clean[i] = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }
    buf.push(clean);
    if (buf.length >= 3) flush(d.key);
  }).catch((er) => postMessage({ type: 'done', key: d.key, aborted: true, message: String((er && er.message) || er) }));
}
self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'port') { e.ports[0].onmessage = onPort; return; }
  if (d.type === 'load') load().then(() => postMessage({ type: 'ready' }), (er) => postMessage({ type: 'failed', message: String((er && er.message) || er) }));
};
