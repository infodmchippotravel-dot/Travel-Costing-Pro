/* Hippo Travel — the website's own voice (Kokoro-82M, Apache-2.0), made on this device in a background worker.
   Nothing is sent anywhere: the text is turned into sound inside this browser.
   Messages in : {type:'load'} | {type:'say', key, text, lang:'en'|'hi', speed, pre} | {type:'need', keys} | {type:'drop', which:'pre'|'now'|'all', keys (kept)}
   Messages out: {type:'progress', loaded, total} | {type:'ready'} | {type:'audio', key, pcm (Float32Array, 24 kHz)}
                 {type:'error', key, message} | {type:'dropped', key} | {type:'failed', message} */
import * as ort from './vendor/ort.wasm.min.mjs';
import { phonemize } from './vendor/phonemizer.js';
import './hx-g2p-hi.js';

const BASE = new URL('./', import.meta.url).href;
const MODEL = 'model/kokoro-q8.onnx', MODEL_SIZE = 92361116;
const VOICE = { en: 'af_heart', hi: 'hf_alpha' };
const CACHE = 'hx-voice-v1';
let session = null, vocab = null, loading = null;
const styles = {};

ort.env.wasm.wasmPaths = BASE + 'vendor/';
ort.env.wasm.numThreads = 1;   /* more threads need special server headers that GitHub Pages does not send */

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

async function load() {
  if (session) return;
  if (!loading) loading = (async () => {
    const [m, v] = await Promise.all([
      file(MODEL, (l, t) => postMessage({ type: 'progress', loaded: l, total: t }), MODEL_SIZE),
      file('model/tokenizer.json'),
    ]);
    vocab = JSON.parse(new TextDecoder().decode(v)).model.vocab;
    session = await ort.InferenceSession.create(new Uint8Array(m), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    await Promise.all([style(VOICE.en), style(VOICE.hi)]);
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

/* jobs: what the person asked to hear comes first; "made early" jobs (the newest answer, before 🔊 is pressed) after */
const jobs = [];
let busy = false;
function pump() {
  if (busy) return;
  let k = jobs.findIndex((j) => !j.pre);
  if (k < 0) k = 0;
  const j = jobs.splice(k, 1)[0];
  if (!j) return;
  busy = true;
  say(String(j.text || ''), j.lang, j.speed).then(
    (pcm) => postMessage({ type: 'audio', key: j.key, pcm }, [pcm.buffer]),
    (er) => postMessage({ type: 'error', key: j.key, message: String((er && er.message) || er) })
  ).then(() => { busy = false; pump(); });
}
self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'load') {
    load().then(() => postMessage({ type: 'ready' }), (er) => postMessage({ type: 'failed', message: String((er && er.message) || er) }));
  } else if (d.type === 'say') {
    if (!jobs.some((j) => j.key === d.key)) jobs.push({ key: d.key, text: d.text, lang: d.lang, speed: d.speed, pre: !!d.pre });
    pump();
  } else if (d.type === 'need') {
    /* 🔊 pressed for parts that were waiting as "made early": they now come first */
    for (const j of jobs) if (d.keys.indexOf(j.key) >= 0) j.pre = false;
  } else if (d.type === 'drop') {
    /* jobs no longer wanted (speech stopped, or a newer answer): not made */
    const keep = d.keys || [];
    for (let k = jobs.length - 1; k >= 0; k--) {
      const j = jobs[k];
      if ((d.which === 'all' || (d.which === 'pre') === j.pre) && keep.indexOf(j.key) < 0) { postMessage({ type: 'dropped', key: j.key }); jobs.splice(k, 1); }
    }
  }
};
