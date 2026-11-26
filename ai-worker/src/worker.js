/* =====================================================================
   Hippo Travel — Help chat AI server (Cloudflare Worker)
   ---------------------------------------------------------------------
   The website (public, on GitHub Pages) can not hold an API key, so the
   key lives here as a Cloudflare *secret* (ANTHROPIC_API_KEY) and never
   reaches the browser.

   Who may ask:  only people logged in to the website. Every request must
   carry the Firebase ID token the website already has for the person
   (window.cloudToken()). The token is checked here with Google's public
   keys: right project, not expired, not an anonymous account.
   How much:     a daily limit per person and for everybody together
   (Cloudflare KV, binding LIMITS) so a bill can not run away.
   From where:   only the website's own address (CORS: ALLOWED_ORIGIN).
   What is sent to Claude: only what the person typed in the chat (and
   the last few chat turns) — no costings, no rates, no phone numbers.
   ===================================================================== */
import Anthropic from "@anthropic-ai/sdk";

const JWKS_URL_DEFAULT =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const SYSTEM = `You are the Help chat of Hippo Travel, an Indian travel agency (Kota, Rajasthan) that sells Thailand tour packages. The people writing to you are the agency's own staff and agents, who use the Hippo Travel website to make costings (quotations) and itineraries (tour vouchers) for their clients.

What you do:
- Answer any question about travelling in Thailand: places (Bangkok, Pattaya, Phuket, Krabi, Phi Phi, Koh Samui, Chiang Mai, Chiang Rai, Hua Hin, Koh Chang, Ayutthaya, Kanchanaburi and others), what to see and do, how to travel between places and how long it takes, how many nights to stay, the best time to go and the weather by month, visa and entry rules for Indian passports, money (Thai Baht), SIM cards, food (vegetarian, Jain, Indian restaurants), shopping, VAT refund, rules and manners, festivals, safety, emergency numbers, packing, honeymoon and family trip ideas, and day-by-day plans.
- Help with the website: making a costing, adding items, the PDF, the itinerary, saved rates.

How you answer:
- Reply in the language you are told to use (Hindi in Devanagari, or simple English). If the person writes Hinglish, answer in their chosen language anyway.
- Be short and practical: a few sentences or a short list. Use plain words a busy travel agent understands at once.
- Never invent prices, hotel rates, tour rates or availability. Prices come from the website's Saved Rates; say so if asked.
- For rules that change (visa, entry cards, fees, opening days, exchange rates), give what you know and say clearly that it should be checked on the official website before booking.
- If you are not sure, say so. Do not make up facts.
- You can not book, pay, send messages or see the person's costings. Do not say you did any of these.

Making a costing:
When the person asks you to make (banao / create / make) a costing, quotation, package or itinerary, and the message gives the trip, answer with ONE line only, in this exact form and in English, so the website can fill its Costing Sheet:
PLAN: <client name>, <A> adults <C> children, <DD Mon YYYY>, <City> <N>N <City> <N>N, tours: <tour>, <tour>
Leave out any part the person did not give (do not guess the client name, the date or the number of people). Use the city names Bangkok, Pattaya, Phuket, Krabi, Koh Samui, Chiang Mai, Chiang Rai, Hua Hin, Koh Chang. If they want popular tours added, end the line with: with tours`;

const MAX_TURNS = 12;
const MAX_CHARS = 2000;

/* ---------- small helpers ---------- */
function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/* ---------- Firebase ID token check ---------- */
let jwksCache = { at: 0, keys: null, url: "" };
async function googleKeys(env) {
  const url = env.JWKS_URL || JWKS_URL_DEFAULT;
  if (jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.at < 3600 * 1000) return jwksCache.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error("could not load the login keys");
  const j = await r.json();
  jwksCache = { at: Date.now(), keys: j.keys || [], url };
  return jwksCache.keys;
}
export async function verifyFirebaseToken(token, env, now = Math.floor(Date.now() / 1000)) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const head = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (head.alg !== "RS256" || !head.kid) throw new Error("bad token");
  const project = env.FIREBASE_PROJECT_ID;
  if (!project) throw new Error("FIREBASE_PROJECT_ID is not set");
  if (claims.aud !== project) throw new Error("wrong project");
  if (claims.iss !== "https://securetoken.google.com/" + project) throw new Error("wrong issuer");
  if (!(claims.exp > now)) throw new Error("token expired");
  if (!(claims.iat <= now + 300)) throw new Error("token from the future");
  if (!claims.sub) throw new Error("no user");
  const provider = claims.firebase && claims.firebase.sign_in_provider;
  if (!provider || provider === "anonymous") throw new Error("anonymous login is not allowed");
  const jwk = (await googleKeys(env)).find((k) => k.kid === head.kid);
  if (!jwk) throw new Error("unknown key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!ok) throw new Error("bad signature");
  return claims;
}

/* ---------- daily limits (Cloudflare KV; counts are approximate) ---------- */
async function countToday(env, uid) {
  if (!env.LIMITS) return { ok: true };
  const day = new Date().toISOString().slice(0, 10);
  const userKey = "u:" + uid + ":" + day, allKey = "all:" + day;
  const [u, a] = await Promise.all([env.LIMITS.get(userKey), env.LIMITS.get(allKey)]);
  const nu = (+u || 0) + 1, na = (+a || 0) + 1;
  const perUser = +env.USER_DAILY_LIMIT || 40, perAll = +env.GLOBAL_DAILY_LIMIT || 800;
  if (nu > perUser) return { ok: false, why: "user" };
  if (na > perAll) return { ok: false, why: "all" };
  const ttl = { expirationTtl: 60 * 60 * 48 };
  await Promise.all([env.LIMITS.put(userKey, String(nu), ttl), env.LIMITS.put(allKey, String(na), ttl)]);
  return { ok: true, left: perUser - nu };
}

/* ---------- the chat turns from the website ---------- */
function cleanTurns(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const turns = list.slice(-MAX_TURNS).map((m) => ({
    role: m && m.role === "assistant" ? "assistant" : "user",
    content: String((m && m.content) || "").slice(0, MAX_CHARS).trim(),
  })).filter((m) => m.content);
  while (turns.length && turns[0].role !== "user") turns.shift();
  /* the API needs user / assistant turns one after the other */
  const out = [];
  for (const t of turns) {
    if (out.length && out[out.length - 1].role === t.role) out[out.length - 1].content += "\n" + t.content;
    else out.push(t);
  }
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request.headers.get("Origin"));
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405, cors);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!origin || !allowed.includes(origin)) return json({ error: "This address may not use the AI." }, 403, cors);

    /* who is asking */
    const auth = request.headers.get("Authorization") || "";
    let claims;
    try {
      claims = await verifyFirebaseToken(auth.replace(/^Bearer\s+/i, ""), env);
    } catch (e) {
      return json({ error: "Please log in to the website again.", detail: String(e.message || e) }, 401, cors);
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400, cors); }
    const turns = cleanTurns(body && body.messages);
    if (!turns) return json({ error: "Nothing to answer." }, 400, cors);
    const lang = body.lang === "hi" ? "hi" : "en";

    const lim = await countToday(env, claims.sub);
    if (!lim.ok) {
      return json({ error: lim.why === "user"
        ? "Today's AI questions are used up for you. Try again tomorrow."
        : "Today's AI questions for the whole website are used up. Try again tomorrow." }, 429, cors);
    }

    if (!env.ANTHROPIC_API_KEY) return json({ error: "The AI key is not set on the server." }, 503, cors);
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 60000 });

    /* the long fixed instructions are cached; the language rule goes after them as a system message, so the cache is the same for everybody */
    const messages = turns.slice();
    messages.push({ role: "system", content: lang === "hi"
      ? "Answer in Hindi (Devanagari script). Keep place names and the PLAN line in English."
      : "Answer in simple English." });
    try {
      const response = await client.beta.messages.create({
        model: env.MODEL || "claude-opus-5-5",
        max_tokens: 2000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        output_config: { effort: env.EFFORT || "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages,
      });
      if (response.stop_reason === "refusal") {
        return json({ text: lang === "hi" ? "माफ़ कीजिए, इसका जवाब मैं नहीं दे सकता।" : "Sorry, I can not answer that.", refusal: true }, 200, cors);
      }
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return json({ text, cut: response.stop_reason === "max_tokens", left: lim.left }, 200, cors);
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy. Please try again in a minute." }, 503, cors);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "The AI key on the server is wrong." }, 503, cors);
      if (e instanceof Anthropic.BadRequestError) return json({ error: "The AI could not read this question.", detail: e.message }, 502, cors);
      if (e instanceof Anthropic.APIError) return json({ error: "The AI had a problem (" + e.status + "). Please try again." }, 502, cors);
      return json({ error: "Could not reach the AI. Please try again." }, 502, cors);
    }
  },
};
