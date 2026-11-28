# Hippo Travel — Help chat server (AI answers + online voice)

This folder is a small **Cloudflare Worker**. It does two separate jobs, each switched on by its own key:

- **Online voice** (`/tts`, key `GOOGLE_TTS_KEY`): the Help chat reads answers aloud with Google's clear Hindi and English voices. The voice starts within about half a second, in every browser (Brave too), with nothing to download. See *Online voice* below.
- **AI answers** (key `ANTHROPIC_API_KEY`): the Help chat can use a real AI (Claude, by Anthropic) for questions that it cannot answer by itself.

**The AI is OFF until you set it up.** Until then, nothing is sent anywhere and the Help chat works fully inside the website. It can still make costings and itineraries, check mistakes, answer Thailand questions and do the website check.

## Why a server is needed

The website is public on GitHub, so an API key placed in its code would be visible to everyone. The key is therefore kept here, as a Cloudflare **secret**, and never reaches the browser.

## What it does to stay safe

| Check | How |
|---|---|
| Only logged-in people | Every question must carry the Firebase login token the website already has. The server checks it with Google's public keys: right project, not expired, signature correct. **Anonymous accounts are refused.** |
| Only this website | The server answers only requests from `https://infodmchippotravel-dot.github.io` (`ALLOWED_ORIGIN`). |
| No runaway bill | There is a daily limit per person (`USER_DAILY_LIMIT`, 40) and for everybody together (`GLOBAL_DAILY_LIMIT`, 800), counted in Cloudflare KV. The counts are approximate. Also set a monthly spend limit in the Anthropic Console. |
| Little data leaves | Only the words typed in the chat (and the last few chat turns) go to Anthropic. Costings, rates, phone numbers and client lists are **not** sent. |

## Cost (please read)

The server uses `claude-opus-5-5` by default: $4 per million input tokens, $20 per million output tokens. The long instructions are cached, which makes them about 10× cheaper after the first question.

- One normal chat question costs roughly **$0.01–0.02 (about ₹1–2)**.
- With the default limits, the most the server can spend in one day is about **$16**.
- `MODEL` in `wrangler.toml` can be changed to `claude-haiku-5-5`. It costs about 40× less ($0.10 / $0.50 per million tokens), but its answers are simpler. The choice is yours.

## Set it up (once, on a computer with Node.js)

1. **Get an Anthropic API key.**
   - Go to console.anthropic.com, add billing, and create an API key.
   - Set a monthly spend limit there.
   - **Never paste the key into the chat, an e-mail or this repository.**
2. **Make a free account on cloudflare.com.**
3. **Run these commands in this folder.** The secret command asks for the key and stores it on Cloudflare only.
   ```bash
   npm install
   npx wrangler login
   npx wrangler kv namespace create LIMITS
   ```
   Copy the `id` it prints into `wrangler.toml`, in the `[[kv_namespaces]]` part, and remove the `#` signs. Then run:
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler deploy
   ```
4. `deploy` prints an address like `https://hippo-help-ai.<your-name>.workers.dev`. This address is not a secret.
5. **Connect it to the website.** In `index.html`:
   - set `window.HIPPO_AI_URL` to that address;
   - add the same address to `connect-src` in the Content-Security-Policy at the top.

   Then test and deploy the website.

## Test without a key

```bash
npm install
npm test
```

The test runs the real server code with a fake Google key list and a fake Claude API on your computer.

## Limitations

- People whose website login has no cloud account yet (anonymous) do not get AI answers. They get the normal Help chat answers.
- The AI can be wrong. Every AI answer is marked "Answer by AI — please check important details". It is told never to invent prices, and to say that visa and entry rules must be checked on the official site.
- Speaking to the chat (🎤) uses the browser's own speech recognition, not this server.

## Online voice (`/tts`)

**What it does:** the website sends one sentence at a time to this server. The server checks the website login and the daily limits, then asks Google Text-to-Speech for the sound and sends it back.

- The voices are `hi-IN-Neural2-A` (Hindi) and `en-IN-Neural2-A` (Indian English). You can change them in `wrangler.toml`.
- The same sentence is made only once and then kept for 30 days in the Cloudflare cache, so it does not count again.
- Only the sentence being read is sent to Google.

**Cost:** Google gives a free amount of characters every month (see cloud.google.com/text-to-speech/pricing; Neural2 voices: about 1 million characters a month). The daily limits are:

- `TTS_GLOBAL_DAILY_CHARS` (30,000 a day, about 0.9 million a month) for the whole website;
- `TTS_USER_DAILY_CHARS` (20,000) for each person.

With these limits, the voice should stay inside the free amount. Also set a budget alert in Google Cloud.

**Set it up (once):**

1. **Google Cloud** (console.cloud.google.com):
   1. Make a project.
   2. Turn on **Cloud Text-to-Speech API**.
   3. Add a billing account. It is needed even for the free amount.
   4. Go to **APIs & Services → Credentials → Create credentials → API key**.
   5. Edit the key: under *API restrictions*, allow only **Cloud Text-to-Speech API**.
   6. Set a budget alert (Billing → Budgets & alerts).
2. **Put the worker on Cloudflare** (free account): follow *Set it up* below, or let the Help chat's developer do it.
3. **Add the Google key as a secret.** Use either way:
   - Cloudflare dashboard → Workers & Pages → `hippo-help-ai` → Settings → Variables and Secrets → Add → type **Secret**, name `GOOGLE_TTS_KEY`, paste the key; or
   - run `npx wrangler secret put GOOGLE_TTS_KEY`.

   Never paste the key into the chat, an e-mail or this repository.
4. **Connect the website.** In `index.html`, set `window.HIPPO_TTS_URL` to `https://hippo-help-ai.<your-name>.workers.dev/tts`. Add the same address to `connect-src` in the Content-Security-Policy at the top.

If the online voice cannot answer, the website uses its other voices on its own: the device's voice or the website's own voice.
