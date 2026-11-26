# Website voice (Help chat)

The Help chat reads answers aloud. Chrome, Edge and phones use their own clear voices. Some browsers have none, for example Brave and Firefox, or a Windows PC with only the old voices. In those browsers the website uses the voice in this folder, so the voice sounds the same everywhere.

- The sound is made **on the person's device**, in a background worker (`hx-voice-worker.mjs`). No text is sent anywhere.
- The first time, the browser downloads about 105 MB. It then keeps the files in its storage (Cache Storage `hx-voice-v1`).
- A person can choose the voice in the chat: 🔊 → *Which voice*. The choices are Automatic, the website's voice, or the device's voice.

## Files and licences

| File | What it is | Licence |
|---|---|---|
| `model/kokoro-q8.onnx`, `model/tokenizer.json`, `model/voices/af_heart.bin` (English), `model/voices/hf_alpha.bin` (Hindi) | Kokoro-82M by hexgrad, ONNX version by onnx-community (Hugging Face `onnx-community/Kokoro-82M-v1.0-ONNX`) | Apache-2.0, see `model/LICENSE-kokoro.txt` |
| `vendor/ort.wasm.min.mjs`, `vendor/ort-wasm-simd-threaded.*` | ONNX Runtime Web 1.22.0, Microsoft | MIT, see `vendor/LICENSE-onnxruntime-web.txt` |
| `vendor/phonemizer.js` | phonemizer 1.2.1 (English sounds), by Xenova; it contains eSpeak NG | The package is Apache-2.0 (see `vendor/LICENSE-phonemizer.txt`). eSpeak NG is GPL-3.0 and its source is at https://github.com/espeak-ng/espeak-ng |
| `hx-g2p-hi.js`, `hx-voice-worker.mjs` | Written for this website. They turn Hindi into sounds and run the voice. | Part of this website |

Checks of the downloaded files (SHA-256):

- `kokoro-q8.onnx`: `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478` (the same as on Hugging Face)

## Limits

- On an old or slow computer, the first words can take a few seconds. Long answers are spoken part by part, and the next part is made while the first is playing.
- The Hindi voice is clear, but less natural than the English voice.
- Hindi words are turned into sounds by simple rules (`hx-g2p-hi.js`). A rare word may be said a little differently.
- If the browser cannot run the voice (very old browsers), the device's voice speaks instead.
