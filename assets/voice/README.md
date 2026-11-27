# Website voice (Help chat)

The Help chat reads answers aloud with the voice in this folder, so it sounds the same in every browser and on every phone and computer (Chrome, Edge, Brave, Firefox …). In the chat's 🔊 settings, a person can choose this device's own voice instead.

- The sound is made **on the person's device**, in a background worker (`hx-voice-worker.mjs`). No text is sent anywhere.
- **English:** Piper voice "Kristin" (small and fast, about 4× faster than speaking even on a slow computer). **Hindi:** Kokoro-82M (clear, but heavier, so slower on a slow computer).
- **Hindi on the graphics card first.** When the browser has WebGPU and the graphics card can run half-precision (`shader-f16`), the voice is made on the graphics card, which is faster. The worker first makes one short test sentence there. If that sound is not clear (silent or broken), or the card is slower than speaking, the processor is used instead.
- **Download, once:** English about 65 MB. Hindi, only when the chat is used in Hindi: about 185 MB with the graphics card (`kokoro-fp16.1.bin` + `kokoro-fp16.2.bin` + the WebGPU runtime), or about 105 MB with the processor. The browser then keeps the files in its storage (Cache Storage `hx-voice-v1`).
- A person can choose the voice in the chat: 🔊 → *Which voice*. The choices are Automatic, the website's voice, or the device's voice.

## Files and licences

| File | What it is | Licence |
|---|---|---|
| `model/en_US-kristin-medium.onnx` + `.onnx.json` (English) | Piper voice "Kristin" (Hugging Face `rhasspy/piper-voices`), trained on LibriVox recordings | The recordings are public domain (model card). Piper voices are made with Piper (MIT). |
| `model/kokoro-q8.onnx`, `model/tokenizer.json`, `model/voices/hf_alpha.bin` (Hindi) | Kokoro-82M by hexgrad, ONNX version by onnx-community (Hugging Face `onnx-community/Kokoro-82M-v1.0-ONNX`) | Apache-2.0, see `model/LICENSE-kokoro.txt` |
| `model/kokoro-fp16.1.bin` + `model/kokoro-fp16.2.bin` | `onnx/model_fp16.onnx` of the same Kokoro ONNX version, cut into two files (GitHub takes files up to 100 MB). The worker joins them again. | Apache-2.0 |
| `vendor/ort.wasm.min.mjs`, `vendor/ort-wasm-simd-threaded.*`, `vendor/ort.webgpu.min.mjs`, `vendor/ort-wasm-simd-threaded.jsep.*` | ONNX Runtime Web 1.22.0, Microsoft (processor and graphics-card versions) | MIT, see `vendor/LICENSE-onnxruntime-web.txt` |
| `vendor/phonemizer.js` | phonemizer 1.2.1 (English sounds for both voices), by Xenova; it contains eSpeak NG | The package is Apache-2.0 (see `vendor/LICENSE-phonemizer.txt`). eSpeak NG is GPL-3.0 and its source is at https://github.com/espeak-ng/espeak-ng |
| `hx-g2p-hi.js`, `hx-voice-worker.mjs` | Written for this website. They turn Hindi into sounds and run the voice. | Part of this website |

Checks of the downloaded files (SHA-256):

- `en_US-kristin-medium.onnx`: MD5 the same as listed in `voices.json` of `rhasspy/piper-voices`
- `kokoro-q8.onnx`: `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478` (the same as on Hugging Face)
- `kokoro-fp16.1.bin` + `kokoro-fp16.2.bin` joined: `ba4527a874b42b21e35f468c10d326fdff3c7fc8cac1f85e9eb6c0dfc35c334a` (the same as `model_fp16.onnx` on Hugging Face)

## Limits

- The graphics-card way could not be tried on a real graphics card while it was being made. The full-precision model gave the same sound on a software graphics card and on the processor. The half-precision model is checked on each device with the test sentence.
- With the processor, on an old or slow computer, the first words can take a few seconds. Long answers are spoken part by part, and the next part is made while the first is playing.
- The Hindi voice is clear, but less natural than the English voice.
- Hindi words are turned into sounds by simple rules (`hx-g2p-hi.js`). A rare word may be said a little differently.
- If the browser cannot run the voice (very old browsers), the device's voice speaks instead.
