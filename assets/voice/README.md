# Website voice (Help chat)

The Help chat reads answers aloud with the voices in this folder, so the voice sounds the same in every browser and on every phone and computer (Chrome, Edge, Brave, Firefox …). In the chat's 🔊 settings, a person can choose this device's own voice instead.

- The sound is made **on the person's device**, in background workers. No text is sent anywhere.
- **English:** Piper voice "Kristin" (`hx-voice-worker.mjs`). It is small and fast, about 4× faster than speaking even on a slow computer.
- **Hindi:** Indus Pocket TTS, voice "Inaya". It also says English words inside Hindi (Hinglish). Two helpers work at the same time:
  - `hx-hindi-gen.mjs` turns the text into voice frames, 80 ms each;
  - `hx-hindi-dec.mjs` turns the frames into sound.
  - The sound plays while it is being made, so it starts within a moment.
- **Download, once:** English about 65 MB. Hindi about 180 MB, only when the chat is used in Hindi. The browser then keeps the files (Cache Storage `hx-voice-v1`).

## Files and licences

| File | What it is | Licence |
|---|---|---|
| `model/en_US-kristin-medium.onnx` + `.onnx.json` (English) | Piper voice "Kristin" (Hugging Face `rhasspy/piper-voices`), trained on LibriVox recordings | The recordings are public domain (model card). Piper is MIT. |
| `hindi/*.onnx`, `hindi/inaya.safetensors`, `hindi/bundle.json` | **Indus Pocket TTS Hindi, voice Inaya.** Model by **Indus Labs** (`Indus-Labs/indus-pocket-tts`), based on **Kyutai Pocket TTS**. ONNX version (INT8 weights) by Scribe Animator / OHO Tech (`sanjuoo7/indus-pocket-tts-hindi-onnx-inaya-weight8`). | **CC BY 4.0.** See `hindi/LICENSE.md`, `hindi/NOTICE.txt` and `hindi/ATTRIBUTION.md`. Kyutai's terms also apply: no voice impersonation or cloning without consent, and no fraudulent or deceptive use. |
| `hindi/tokenizer.json` | The same tokenizer as `tokenizer.model` of that release, written as JSON (pieces and scores) for the browser | CC BY 4.0 (as above) |
| `vendor/ort.wasm.min.mjs`, `vendor/ort-wasm-simd-threaded.*` | ONNX Runtime Web 1.22.0, Microsoft | MIT, see `vendor/LICENSE-onnxruntime-web.txt` |
| `vendor/phonemizer.js` | phonemizer 1.2.1 (English sounds), by Xenova. It contains eSpeak NG. | The package is Apache-2.0, see `vendor/LICENSE-phonemizer.txt`. eSpeak NG is GPL-3.0; its source is at https://github.com/espeak-ng/espeak-ng |
| `hx-spm.js`, `hx-g2p-hi.js`, `hx-voice-worker.mjs`, `hx-hindi-gen.mjs`, `hx-hindi-dec.mjs` | Written for this website: tokenizer, Hindi numbers in words, and the voice helpers | Part of this website |

Checks of the downloaded files:

- `en_US-kristin-medium.onnx`: MD5 the same as listed in `voices.json` of `rhasspy/piper-voices`.
- Hindi files: SHA-256 the same as in `SHA256SUMS` of the ONNX release.
- `hindi/tokenizer.json`: gives the same token numbers as the original SentencePiece on the test sentences (Hindi, English, Hinglish, nukta letters).

## Limits

- On a slow computer or phone, long Hindi answers can have short pauses. This is because the sound is made a little slower than it is spoken there.
- The Hindi voice says numbers as words. The website turns digits into Hindi words first.
- The speed setting (Slow / Normal / Fast) changes the English voice only.
- If the browser cannot run the voices (very old browsers), the device's voice speaks instead.
