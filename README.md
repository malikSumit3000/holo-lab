# Holo Lab

An Iron Man–style holographic workbench that runs in the browser. Grab, throw, twist and resize 3D holograms with your bare hands, using only a webcam. Pull objects apart, then pull a part out and take that apart too.

**Try it:** https://malikSumit3000.github.io/holo-lab/. Use desktop Chrome or Edge, allow the camera, and press START.

## What you can do

- **Pinch** an object to grab and move it. Push or pull your hand to move it in depth, and twist your hand to rotate it.
- **Flick and let go** to throw it. **Make a fist** and hold it to disintegrate the object.
- **Two-hand pinch, then spread** to resize, or to explode an object into its parts.
- **Pinch a part** of an exploded object and pull it out to drill into it. Press `B` or `Esc` to go back up a level.
- **Hold SPACE and speak**, or type, for example *"show me a truck"*. Speech recognition (Whisper) runs in your browser and downloads once, about 77 MB.
- **GAME** starts the finger-gun shooter: aim with your index finger and flip your thumb to fire.
- Press `H` for the full gesture list, and `T` for tracking tuning. A mouse works if you have no camera.

## Online vs. Mac version

| | Online (GitHub Pages) | Mac version (`python3 run.py`) |
|---|---|---|
| Hand tracking, all gestures, game | ✅ | ✅ |
| Voice and typed requests | ✅ | ✅ |
| Object library | built-ins + 7 models loaded from Khronos | built-ins + your downloaded models |
| AI designs of objects not in the library | — | ✅ with a local Ollama model |

To run the full version locally:

```bash
python3 tools/fetch_library.py   # optional: download the 3D model library (~64 MB)
python3 run.py                   # opens http://localhost:8765
```

AI designs need [Ollama](https://ollama.com) and a model such as `qwen3`; `run.py` starts Ollama for you.

## Built with

MediaPipe Tasks (hand and face tracking), Three.js, transformers.js with Whisper, and Ollama with Qwen3. The 3D models come from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets): six are CC0, and the Cesium Milk Truck is CC-BY-4.0 (© Cesium). Each model's licence is listed in `web-library.json` and shown in its info card.
