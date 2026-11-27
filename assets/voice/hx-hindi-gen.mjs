/* Hippo Travel — Hindi voice, helper 1 of 2: text → voice frames (Indus Pocket TTS, "Inaya", CC-BY-4.0).
   It follows the model's INFERENCE.md: text conditioner, then one main step + one flow step per 80 ms frame.
   Each frame goes straight to helper 2 (hx-hindi-dec.mjs), which turns it into sound, so the sound starts at once.
   Messages in : {type:'load'} | {type:'port'} (+ MessagePort to helper 2) | {type:'say', key, text} | {type:'cancel', key}
   Messages out: {type:'progress', loaded, total} | {type:'ready'} | {type:'failed', message} | {type:'gen-done', key} | {type:'error', key, message} */
import * as ort from './vendor/ort.wasm.min.mjs';
import './hx-g2p-hi.js';
import './hx-spm.js';

const BASE = new URL('./', import.meta.url).href;
const DIR = 'hindi/';
const FILES = [['text_conditioner.onnx', 16388300], ['flow_main_weight_int8.onnx', 76298980], ['flow_one_step.onnx', 39093640]];
const CACHE = 'hx-voice-v1';
ort.env.wasm.wasmPaths = BASE + 'vendor/';
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';
/* the int8 weights are opened once when loading (not again at every step): much faster in the browser */
const OPT = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', enableMemPattern: false, extra: { session: { disable_quant_qdq: '1' } } };

let tc = null, main = null, flow = null, tok = null, caches0 = null, loading = null, port = null, cur = null, abort = false;

async function file(path, onProgress, size) {
  const url = BASE + path;
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return await hit.arrayBuffer(); } catch (e) { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download ' + path + ' (' + res.status + ')');
  let buf;
  if (onProgress && res.body) {
    const reader = res.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got); }
    const u = new Uint8Array(got); let o = 0; for (const p of parts) { u.set(p, o); o += p.length; }
    buf = u.buffer;
  } else buf = await res.arrayBuffer();
  if (size && buf.byteLength !== size) throw new Error('The voice file did not download fully. Please try again.');
  if (cache) { try { await cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch (e) { /* no space: works, downloads again next time */ } }
  return buf;
}
/* the voice "Inaya": six fixed attention caches stored in a safetensors file */
function safetensors(buf) {
  const dv = new DataView(buf), n = Number(dv.getBigUint64(0, true));
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))), out = {};
  for (const [k, v] of Object.entries(head)) {
    if (k === '__metadata__') continue;
    const [a, b] = v.data_offsets, raw = buf.slice(8 + n + a, 8 + n + b);
    if (v.dtype === 'F32') out[k] = { data: new Float32Array(raw), shape: v.shape };
    else if (v.dtype === 'F16') { const h = new Uint16Array(raw), f = new Float32Array(h.length); for (let i = 0; i < h.length; i++) f[i] = f16(h[i]); out[k] = { data: f, shape: v.shape }; }
    else if (v.dtype === 'BF16') { const h = new Uint16Array(raw), f = new Float32Array(h.length), u = new Uint32Array(f.buffer); for (let i = 0; i < h.length; i++) u[i] = h[i] << 16; out[k] = { data: f, shape: v.shape }; }
  }
  return out;
}
function f16(h) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15); }

async function load() {
  if (main) return;
  if (!loading) loading = (async () => {
    const total = FILES.reduce((a, f) => a + f[1], 0) + 3442480; let done = 0;
    const bufs = [];
    for (const [f, size] of FILES) { bufs.push(await file(DIR + f, (l) => postMessage({ type: 'progress', loaded: done + l, total }), size)); done += size; }
    const voice = safetensors(await file(DIR + 'inaya.safetensors', (l) => postMessage({ type: 'progress', loaded: done + l, total }), 3442480));
    tok = self.HxSpm.make(JSON.parse(new TextDecoder().decode(await file(DIR + 'tokenizer.json'))));
    caches0 = [0, 1, 2, 3, 4, 5].map((i) => { const c = voice['transformer.layers.' + i + '.self_attn/cache']; return new ort.Tensor('float32', c.data, c.shape); });
    [tc, main, flow] = await Promise.all(bufs.map((b) => ort.InferenceSession.create(new Uint8Array(b), OPT)));
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

/* Gaussian noise, standard deviation √0.3 (as the model's sampler) */
function noise(n) { const a = new Float32Array(n), sd = Math.sqrt(0.3); for (let i = 0; i < n; i++) { const u = Math.max(Math.random(), 1e-12), v = Math.random(); a[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sd; } return a; }

/* the model wants words, not digits, and at most 32 tokens per piece (split at punctuation, then at spaces) */
function pieces(text) {
  let t = self.HxHindiG2P.numbers(String(text || '')).replace(/[₹$]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  t.split(/(?<=[।.!?;:])\s+|\n+/).forEach((s) => {
    s = s.trim(); if (!s) return;
    if (tok.encode(s).length <= 32) { out.push(s); return; }
    let cur = '';
    for (const w of s.split(' ')) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && tok.encode(next).length > 32) { out.push(cur); cur = w; } else cur = next;
    }
    if (cur) out.push(cur);
  });
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
}

const EMPTY_SEQ = () => new ort.Tensor('float32', new Float32Array(0), [1, 0, 32]);
const EMPTY_TXT = () => new ort.Tensor('float32', new Float32Array(0), [1, 0, 1024]);
async function speakPiece(key, s, first) {
  const ids = tok.encode(s);
  if (!ids.length) return;
  const emb = (await tc.run({ tokens: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) })).embeddings;
  const f0 = { sequence: EMPTY_SEQ(), text_embeddings: emb };
  for (let i = 0; i < 6; i++) f0['cache_' + i] = caches0[i];
  let o = await main.run(f0);
  let caches = [0, 1, 2, 3, 4, 5].map((i) => o['present_' + i]);
  noise(32);   /* the unused draw after the text */
  let seq = new ort.Tensor('float32', new Float32Array(32).fill(NaN), [1, 1, 32]);
  const budget = Math.min(250, Math.max(75, 8 * ids.length + 50));
  let firstEos = null, reset = true;
  for (let step = 0; step < budget; step++) {
    if (abort) return;
    const f = { sequence: seq, text_embeddings: EMPTY_TXT() };
    for (let i = 0; i < 6; i++) f['cache_' + i] = caches[i];
    o = await main.run(f);
    caches = [0, 1, 2, 3, 4, 5].map((i) => o['present_' + i]);
    const eos = o.eos_logit.data[0];
    if (firstEos === null && eos > -4) firstEos = step;
    if (firstEos !== null && step >= firstEos + 3) return;
    const lat = (await flow.run({ conditioning: o.conditioning, noise: new ort.Tensor('float32', noise(32), [1, 32]) })).latent.data;
    const l = new Float32Array(lat);
    port.postMessage({ key, lat: l, reset }, [l.buffer]);   /* to helper 2, which makes the sound */
    reset = false;
    seq = new ort.Tensor('float32', new Float32Array(lat), [1, 1, 32]);
  }
}
let queue = Promise.resolve();
self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'port') { port = e.ports[0]; return; }
  if (d.type === 'load') { load().then(() => postMessage({ type: 'ready' }), (er) => postMessage({ type: 'failed', message: String((er && er.message) || er) })); return; }
  if (d.type === 'cancel') { if (cur === d.key) abort = true; return; }
  if (d.type === 'say') {
    queue = queue.then(async () => {
      cur = d.key; abort = false;
      try {
        await load();
        const ps = pieces(d.text);
        for (let i = 0; i < ps.length && !abort; i++) await speakPiece(d.key, ps[i], i === 0);
        port.postMessage({ key: d.key, end: true, aborted: abort });
        postMessage({ type: 'gen-done', key: d.key, aborted: abort });
      } catch (er) {
        port.postMessage({ key: d.key, end: true, aborted: true });
        postMessage({ type: 'error', key: d.key, message: String((er && er.message) || er) });
      }
      cur = null;
    });
  }
};
