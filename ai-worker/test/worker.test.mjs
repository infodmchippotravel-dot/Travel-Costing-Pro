/* Tests the AI server without a real API key: a fake Google key list and a fake Claude API run on this computer. */
import http from "node:http";
import assert from "node:assert/strict";
import worker, { verifyFirebaseToken } from "../src/worker.js";

const PROJECT = "hippo-travel-b1006", ORIGIN = "https://infodmchippotravel-dot.github.io";
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
pub.kid = "k1"; pub.alg = "RS256"; pub.use = "sig";
async function token(over = {}, kid = "k1", key = kp.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const h = enc({ alg: "RS256", kid, typ: "JWT" });
  const c = enc({ aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub: "user123", iat: now, exp: now + 3600, firebase: { sign_in_provider: "password" }, ...over });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + c));
  return h + "." + c + "." + Buffer.from(sig).toString("base64url");
}

/* fake Google keys + fake Claude API */
let last = null, reply = { stop_reason: "end_turn", text: "Phuket is best from November to April." };
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (req.url.startsWith("/jwks")) { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ keys: [pub] })); }
    last = { url: req.url, headers: req.headers, body: JSON.parse(b || "{}") };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: last.body.model, content: [{ type: "text", text: reply.text }], stop_reason: reply.stop_reason, stop_details: null, usage: { input_tokens: 10, output_tokens: 5 } }));
  });
});
await new Promise((r) => srv.listen(0, r));
const base = "http://127.0.0.1:" + srv.address().port;
const kv = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const env = { FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGIN: ORIGIN, ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: base, JWKS_URL: base + "/jwks", USER_DAILY_LIMIT: "3", LIMITS: KV };
const ask = async (tok, body, origin = ORIGIN, method = "POST") => {
  const r = await worker.fetch(new Request("https://ai.example/chat", { method, headers: { Origin: origin, "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: method === "POST" ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, body: r.status === 204 ? null : await r.json(), cors: r.headers.get("Access-Control-Allow-Origin") };
};
const Q = { messages: [{ role: "user", content: "Phuket kab jaye?" }], lang: "hi" };
let n = 0; const ok = (name) => console.log("  ok", ++n, name);

let r = await ask(null, null, ORIGIN, "OPTIONS"); assert.equal(r.status, 204); assert.equal(r.cors, ORIGIN); ok("CORS pre-check for the website");
r = await ask(await token(), Q, "https://evil.example"); assert.equal(r.status, 403); ok("another website is refused");
r = await ask(null, Q); assert.equal(r.status, 401); ok("no login is refused");
r = await ask(await token({ firebase: { sign_in_provider: "anonymous" } }), Q); assert.equal(r.status, 401); assert.match(r.body.detail, /anonymous/); ok("anonymous login is refused");
r = await ask(await token({ exp: Math.floor(Date.now() / 1000) - 10 }), Q); assert.equal(r.status, 401); ok("expired login is refused");
r = await ask(await token({ aud: "other-project" }), Q); assert.equal(r.status, 401); ok("login of another Firebase project is refused");
const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
r = await ask(await token({}, "k1", other.privateKey), Q); assert.equal(r.status, 401); assert.match(r.body.detail, /signature/); ok("a forged token (wrong key) is refused");
r = await ask(await token(), { messages: [] }); assert.equal(r.status, 400); ok("empty question is refused");

last = null; r = await ask(await token(), Q);
assert.equal(r.status, 200); assert.equal(r.body.text, reply.text); ok("a logged-in question gets the answer");
assert.match(last.url, /^\/v1\/messages/); assert.ok(last.headers["x-api-key"] === "test-key" || last.headers["authorization"] === "Bearer test-key", "the key is sent to Claude");
assert.match(last.headers["anthropic-beta"] || "", /server-side-fallback-2026-07-01/);
assert.equal(last.body.model, "claude-opus-5-5"); assert.equal(last.body.fallbacks, "default");
assert.equal(last.body.system[0].cache_control.type, "ephemeral"); assert.ok(last.body.system[0].text.length > 1500);
assert.deepEqual(last.body.output_config, { effort: "low" });
assert.equal(last.body.messages[0].role, "user"); assert.equal(last.body.messages.at(-1).role, "system"); assert.match(last.body.messages.at(-1).content, /Hindi/);
assert.ok(!("thinking" in last.body) && !("temperature" in last.body));
ok("the request to Claude: model, key header, cached instructions, language rule last, fallback on");

for (let i = 0; i < 2; i++) assert.equal((await ask(await token(), Q)).status, 200);
r = await ask(await token(), Q);
assert.equal(r.status, 429, "the 4th question of the day is over the limit of 3");
assert.equal((await ask(await token({ sub: "someone-else" }), Q)).status, 200, "another person still can ask"); ok("daily limit per person");
kv.clear();
r = await ask(await token(), { messages: [{ role: "assistant", content: "hi" }, { role: "user", content: "a" }, { role: "user", content: "x".repeat(5000) }] });
assert.equal(r.status, 200); assert.equal(last.body.messages.filter((m) => m.role !== "system").length, 1); assert.ok(last.body.messages[0].content.length <= 2002);
ok("turns are cleaned: starts with the person, same-role turns joined, long text cut");

reply = { stop_reason: "refusal", text: "" };
r = await ask(await token(), Q); assert.equal(r.status, 200); assert.equal(r.body.refusal, true); ok("a refusal gives a polite answer");
const noKey = { ...env, ANTHROPIC_API_KEY: "" };
r = await worker.fetch(new Request("https://ai.example/chat", { method: "POST", headers: { Origin: ORIGIN, Authorization: "Bearer " + (await token()) }, body: JSON.stringify(Q) }), noKey);
assert.equal(r.status, 503); ok("no key on the server: clear message, no crash");

/* ---------- /tts: the online voice ---------- */
let ttsCalls = 0;
const gsrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
  ttsCalls++; last = { url: req.url, headers: req.headers, body: JSON.parse(b || "{}") };
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ audioContent: Buffer.from("ID3-fake-mp3-" + last.body.input.text).toString("base64") }));
}); });
await new Promise((r) => gsrv.listen(0, r));
const memCache = new Map();
globalThis.caches = { default: { match: async (k) => (memCache.has(k.url) ? new Response(memCache.get(k.url)) : undefined), put: async (k, r) => { memCache.set(k.url, new Uint8Array(await r.arrayBuffer())); } } };
kv.clear();
const tenv = { ...env, GOOGLE_TTS_KEY: "g-key", GOOGLE_TTS_URL: "http://127.0.0.1:" + gsrv.address().port, TTS_USER_DAILY_CHARS: "60", TTS_GLOBAL_DAILY_CHARS: "100" };
const say = async (tok, body, origin = ORIGIN, e = tenv) => {
  const r = await worker.fetch(new Request("https://ai.example/tts", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) }), e);
  return { status: r.status, type: r.headers.get("Content-Type"), hit: r.headers.get("X-Cache"), cors: r.headers.get("Access-Control-Allow-Origin"), bytes: r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : null, body: r.status === 200 ? null : await r.json() };
};
r = await say(await token(), { text: "नमस्ते", lang: "hi" }, "https://evil.example"); assert.equal(r.status, 403); ok("tts: another website is refused");
r = await say(null, { text: "नमस्ते", lang: "hi" }); assert.equal(r.status, 401); ok("tts: no login is refused");
r = await say(await token({ firebase: { sign_in_provider: "anonymous" } }), { text: "नमस्ते दोस्तों", lang: "hi", rate: 1 });
assert.equal(r.status, 200); assert.equal(r.type, "audio/mpeg"); assert.equal(r.hit, "miss"); assert.equal(r.cors, ORIGIN);
assert.match(new TextDecoder().decode(r.bytes), /^ID3-fake-mp3-नमस्ते दोस्तों$/);
assert.equal(last.headers["x-goog-api-key"], "g-key"); assert.equal(last.body.voice.name, "hi-IN-Neural2-A"); assert.equal(last.body.voice.languageCode, "hi-IN"); assert.equal(last.body.audioConfig.audioEncoding, "MP3");
ok("tts: the website's anonymous login gets Hindi sound (key only on the server, Hindi voice)");
const before = ttsCalls; r = await say(await token({ sub: "other" }), { text: "नमस्ते दोस्तों", lang: "hi", rate: 1 });
assert.equal(r.status, 200); assert.equal(r.hit, "hit"); assert.equal(ttsCalls, before); ok("tts: the same sentence again comes from the cache (Google is not asked, not counted)");
r = await say(await token(), { text: "Hello there", lang: "en" }); assert.equal(r.status, 200); assert.equal(last.body.voice.name, "en-IN-Neural2-A"); ok("tts: English voice");
r = await say(await token(), { text: "x".repeat(50), lang: "en" }); assert.equal(r.status, 429); ok("tts: daily characters per person");
r = await say(await token({ sub: "third" }), { text: "y".repeat(55), lang: "en" }); assert.equal(r.status, 200); r = await say(await token({ sub: "third2" }), { text: "z".repeat(30), lang: "en" }); assert.equal(r.status, 429); ok("tts: daily characters for the whole website");
r = await say(await token({ sub: "fourth" }), { text: "   " }); assert.equal(r.status, 400); ok("tts: empty text is refused");
kv.clear(); r = await say(await token({ sub: "fifth" }), { text: "no key here" }, ORIGIN, { ...tenv, GOOGLE_TTS_KEY: "" }); assert.equal(r.status, 503); ok("tts: no key on the server: clear message");
r = await say(await token({ firebase: { sign_in_provider: "anonymous" }, sub: "anon2" }), { text: "anonymous off" }, ORIGIN, { ...tenv, TTS_ALLOW_ANONYMOUS: "0" }); assert.equal(r.status, 401); ok("tts: anonymous logins can be switched off");
gsrv.close();

srv.close();
console.log("all", n, "worker tests passed");
