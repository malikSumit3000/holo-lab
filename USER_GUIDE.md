# Holo Lab User Guide

Holo Lab is a holographic workbench in your browser. You control 3D holograms with your bare hands through a webcam. You can grab them, throw them, twist them, resize them, take them apart and look inside. This guide covers setup, every gesture and key, the Holo Shooter game, voice requests, and fixes for common problems.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Starting Holo Lab](#2-starting-holo-lab)
3. [The screen](#3-the-screen)
4. [Hand gestures](#4-hand-gestures)
5. [Taking objects apart (drill-down)](#5-taking-objects-apart-drill-down)
6. [The light pen](#6-the-light-pen)
7. [Asking for objects by voice or text](#7-asking-for-objects-by-voice-or-text)
8. [Holo Shooter (game mode)](#8-holo-shooter-game-mode)
9. [3D window (head tracking)](#9-3d-window-head-tracking)
10. [Using a mouse instead of a camera](#10-using-a-mouse-instead-of-a-camera)
11. [Tracking tuning](#11-tracking-tuning)
12. [Keyboard reference](#12-keyboard-reference)
13. [Running the Mac (local) version](#13-running-the-mac-local-version)
14. [Troubleshooting](#14-troubleshooting)
15. [Privacy and licences](#15-privacy-and-licences)

---

## 1. What you need

- **Browser:** desktop **Chrome** or **Edge** works best. Other browsers may load, but hand tracking and speech can be slower or may not work.
- **Webcam:** any built-in or USB camera. An iPhone used as a Continuity Camera also works, and it can run at 60 FPS.
- **Space and light:** sit about an arm's length from the camera in an evenly lit room. Your hands should be fully in the frame. A plain background helps.
- **Microphone (optional):** needed only for voice requests.
- **No camera?** You can use a mouse instead. See [section 10](#10-using-a-mouse-instead-of-a-camera).

## 2. Starting Holo Lab

### Online

1. Open **https://malikSumit3000.github.io/holo-lab/**.
2. Click **INITIALIZE** on the boot screen.
3. When the browser asks, **allow camera access**.
4. The boot log shows each system coming online: hand tracking, camera, and the object library. A **Planet** and an **Arc Reactor** then appear.
5. When the hint says *"PINCH AN OBJECT TO GRAB IT"*, you're ready.

If the camera is blocked or the hand model fails to load, Holo Lab switches to **mouse mode** and tells you so in the boot log.

### Locally (Mac version)

See [section 13](#13-running-the-mac-local-version). The local version adds AI-designed objects and lets you use your own 3D models.

## 3. The screen

| Area | Where | What it shows |
|---|---|---|
| **Status panel** | top left | Tracking type (hands or mouse), hands seen, object count, current mode (MANIPULATE, LIGHT PEN, DRILL DEPTH n, HOLO SHOOTER), render FPS and hand-tracking FPS |
| **Gestures panel** | right | A quick gesture and key list. Press `H` to hide or show it |
| **Hand cursors** | follow your hands | A ring for each hand. It fills up while you hold a fist |
| **Breadcrumbs** | top centre | Your position inside an object, for example `V4 ENGINE › PISTON ASSEMBLY`. Pinch a crumb to jump back to it |
| **Info card** | right | The name, purpose, material and a fun fact for the part you're focused on or hovering over. Library models also show their licence |
| **Dock** | bottom | Buttons: PLANET, REACTOR, ENGINE, DNA, HYPERCUBE, VOICE, LIGHT PEN, GAME, CLEAR |
| **Command bar** | bottom | MIC button and a text box for requests, plus status messages and suggestion chips |

You can **pinch any dock button, breadcrumb or chip with your hand** to press it, or click it with the mouse.

Up to **10 objects** can be on screen at once. To make room, disintegrate some or press `X` to clear them all.

## 4. Hand gestures

A **pinch** means touching your thumb tip to your index fingertip. Keep your index finger reaching out a little: a tightly curled fist doesn't count as a pinch.

| Gesture | What it does |
|---|---|
| **Pinch** an object | Grab it. Move your hand to drag it |
| While holding: **push / pull** your hand toward or away from the camera | Move the object nearer or further away |
| While holding: **twist** your hand | Rotate the object |
| **Flick** your hand and let go | Throw the object. It bounces off the screen edges |
| **Open palm swipe** across an object | Spin it |
| **Two-hand pinch** on one object, then **spread or squeeze** your hands | Resize it. On objects with parts, spreading **explodes** it into its parts |
| **Fist, held for 1 second** over an object | Disintegrate (delete) it. The cursor ring fills while you hold |
| **Pinch a dock button** | Press it |

Tips:

- **Grabbing is forgiving.** The grab zone is a little larger than the object, and the nearest object wins.
- **Grabs are "sticky."** A brief tracking flicker won't drop the object. It's released only after your fingers stay open for a moment (80 ms by default).
- Small, unintended depth changes and twists are ignored while you hold an object, so it stays still when your hand does.

## 5. Taking objects apart (drill-down)

Every object is built as a tree of parts. The **V4 Engine** is the deepest, three to four levels down. Library models with real part structures, such as the Milk Truck, can be taken apart as well. Single-piece models are marked *solid*. You can grab, twist and resize them, but they don't explode.

1. **Explode:** two-hand pinch the object and spread your hands. Parts fly apart and labels appear.
2. **Pull out a part:** pinch one part of the exploded object and pull it away.
   - Let go **near its slot** and it snaps back into place.
   - Let go **far from its slot** to **drill in**. The part flies to the centre, enlarges and becomes the focus, and everything else dims to a ghost.
3. **Explode again:** spread the focused part with two hands to see its sub-parts. Repeat as deep as the object goes.
4. **Go back up:** press `B` or `Esc`, pinch **◀ BACK**, or pinch any breadcrumb. The part flies back into its slot.

While you're drilled in, the dimmed objects in the background can't be grabbed, so you can't move them by accident. The info card describes whatever you're focused on or hovering over.

**Try this:** spawn the engine (`3`), explode it, pull out a *Piston assembly*, drill in, explode it, pull out the *Connecting rod*, drill in again, then press `B` twice to return to the full engine.

## 6. The light pen

The light pen lets you sculpt glowing strokes in 3D space.

1. Press `P` or pinch **LIGHT PEN** in the dock. The mode changes to LIGHT PEN.
2. **Pinch in empty space** and move your hand to draw. Push or pull your hand to draw in depth.
3. Press `P` again to switch the pen off. Press `X` or **CLEAR** to remove everything.

## 7. Asking for objects by voice or text

### Speaking

- **Hold `SPACE`**, say what you want, then **release** it. For example: *"show me a truck"*, *"an engine"*, *"spawn a lantern"*.
- You can also pinch **MIC** (or the **VOICE** dock button) to start, then pinch it again to stop.
- A level meter shows it's listening. The text it heard appears in the command bar so you can check it.
- The first time you speak, the **Whisper** speech model downloads once (about 77 MB) and is cached. After that, speech recognition runs entirely in your browser and works offline.

### Typing

- Press `/` (or click the text box), type a request, and press **Enter**. Press `Esc` to leave the box.

### What happens next

- **Clear match:** the object appears straight away.
- **Close match:** you get *"Did you mean…"* chips. Pinch or click one.
- **No match:**
  - **Online:** you'll see suggestions from the library.
  - **Mac version with Ollama:** your local AI designs the object from simple shapes, which takes roughly 15–45 seconds. The design is a real part tree that you can explode and drill into. Designs are cached, so asking again is instant.

### What's in the library

| Built-in (always available) | Online models (Khronos glTF samples) |
|---|---|
| Planet (`1`), Arc Reactor (`2`), V4 Engine (`3`), DNA Helix (`4`), Tesseract/Hypercube (`5`) | Antique Camera, Avocado, Boom Box, Lantern, Milk Truck, Toy Car, Water Bottle |

Each object also answers to related words. "Earth", "globe", "motor", "car", "radio", "lamp" and "bottle" all work.

## 8. Holo Shooter (game mode)

Press `G` or pinch **GAME**. Your lab objects are hidden and kept safe until you return.

### Controls

| Action | Hand | Mouse / keys |
|---|---|---|
| **Aim** | Make a finger gun: index finger out, other fingers curled. The crosshair follows where your finger points | Move the mouse |
| **Fire** | **Drop your thumb** onto your hand like a hammer, or **flick** your finger up like recoil. Lift your thumb again before the next shot | Left click |
| **Shield** | **Open palm** with your other hand. A hex shield blocks incoming shots in its area | Right button |
| **Reload** | Make a **fist** with your other hand (the magazine holds 8 rounds) | `R` |
| **Exit** | Pinch or shoot **✕ EXIT** | `Esc` or `G` |

### Gameplay

- Holographic drones attack in **waves** at different depths. Some hover, some strafe and some dive. They charge up, then fire slow plasma shots at you.
- **Red** drones are basic (100 points), **orange** armoured drones take 3 hits (250 points), and every 5th wave brings a **pink boss** (2500 points).
- The HUD shows **score, wave, combo multiplier, accuracy and best score**, plus your **HULL** (health) and ammo.
- When your hull runs out, the **GAME OVER** screen shows your results. Shoot or click **RESTART** to play again. Your best score is saved in this browser.
- In game mode, `D` shows aiming debug info, and `M`, `F` and `T` still work.

If aiming feels too twitchy or too sluggish, open **Tracking tuning** (`T`) and adjust the *Shooter* sliders ([section 11](#11-tracking-tuning)).

## 9. 3D window (head tracking)

Press `W` to turn the screen into a **window into a 3D room**. When you move your head, the view shifts as if you were looking through glass. The first time you turn it on, a small face-tracking model (about 4 MB) loads. It works in both the lab and the game. Press `W` again to turn it off. It needs the camera.

## 10. Using a mouse instead of a camera

| Mouse | Lab | Game |
|---|---|---|
| Move | Cursor | Aim |
| **Left click / drag** | Pinch: grab, drag, throw (release while moving), press buttons, draw with the pen | Fire |
| **Right drag** | Open palm: spin objects | Shield |
| **Wheel** | While dragging: move in depth. Over an object: resize it, or explode/assemble it if it has parts | — |
| `Delete` key | Delete the object under the cursor | — |

## 11. Tracking tuning

Press `T` to open the tuning panel. Changes take effect immediately and are **saved in this browser**. **RESET DEFAULTS** restores the factory settings.

| Slider | Raise it if… | Lower it if… |
|---|---|---|
| **Smoothing (steadiness)** | — | The cursor jitters when your hand is still |
| **Responsiveness (less lag)** | Objects lag behind fast moves | The cursor gets jittery |
| **Pinch sensitivity** | Pinches aren't detected | Grabs happen by accident |
| **Sticky grab (ms)** | Objects drop while you hold them | Objects are slow to release |
| **Depth sensitivity** | Push/pull moves objects too little | Objects shoot in and out |
| **Twist sensitivity** | Rotation feels sluggish | Rotation feels twitchy |
| **Grab zone size** | Objects are hard to grab | You grab the wrong object |
| **Shooter: aim assist** | You want more help hitting targets | The crosshair feels pulled around |
| **Shooter: aim reach** | You must move your hand far to cross the screen | Aim is too twitchy |
| **Shooter: finger-direction aiming** | You want aim to follow where your finger points | You'd rather aim by hand position |
| **Shooter: thumb trigger sensitivity** | Thumb shots don't register | Shots fire by accident |
| **Shooter: flick-to-fire speed** | Shots fire by accident | Flicks don't register |

The panel's own rule of thumb: *if it's slow and steady, lower smoothing; if it lags on fast moves, raise responsiveness.*

## 12. Keyboard reference

### Lab

| Key | Action |
|---|---|
| `1`–`5` | Spawn Planet, Arc Reactor, V4 Engine, DNA Helix, Tesseract |
| `SPACE` (hold) | Speak a request |
| `/` | Type a request |
| `B` / `Esc` | Go back up one drill level |
| `P` | Toggle light pen |
| `X` | Clear all objects |
| `G` | Start Holo Shooter |
| `W` | Toggle 3D window (head tracking) |
| `H` | Hide or show the gestures panel |
| `T` | Tracking tuning panel |
| `V` | Toggle the camera background video |
| `C` | Switch to the next camera |
| `M` | Mute or unmute sound |
| `F` | Toggle fullscreen |
| `Delete` | Delete the object under the mouse |

### Game

| Key | Action |
|---|---|
| `R` | Reload |
| `Esc` / `G` | Back to the lab |
| `D` | Aiming debug overlay |
| `M` / `F` / `T` / `W` | Mute / fullscreen / tuning / 3D window |

## 13. Running the Mac (local) version

The local version does everything the online version does, and adds the following:

- **AI designs:** objects that aren't in the library are designed by a local AI model.
- **Your own model library:** download the curated set of models, or add your own `.glb` files.

### Setup

```bash
git clone https://github.com/malikSumit3000/holo-lab.git
cd holo-lab
python3 tools/fetch_library.py   # optional: download the 3D model library (~64 MB, asks first)
python3 run.py                   # starts a local server and opens http://localhost:8765
```

`run.py` uses only the Python standard library. It serves the app on `localhost`, which browsers allow to use the camera. It also opens Chrome if it can find it.

| Option | Meaning |
|---|---|
| `--port 8765` | Preferred port. If it's busy, the next free port is used |
| `--no-browser` | Don't open a browser automatically |
| `HOLO_MODEL=qwen3:14b python3 run.py` | Use a specific Ollama model |

Stop the server with `Ctrl+C`, or with the Stop button in PyCharm.

### AI designs with Ollama

1. Install [Ollama](https://ollama.com).
2. Pull a model: `ollama pull qwen3`.
3. Start `run.py`. It starts Ollama for you if it isn't already running, and it chooses from qwen3, qwen2.5, llama3, gemma or mistral, in that order.

Designs from an 8B model are simple and occasionally odd. A larger model, such as `qwen3:14b`, gives better results if your Mac has enough memory.

### Adding your own 3D models

1. Put any `.glb` file into `library/models/`.
2. Run `python3 tools/fetch_library.py --scan`.
3. The file name becomes the model's voice name. For example, `jet_engine.glb` answers to *"show me a jet engine"*.

To download only some of the curated models, use `--only toy_car,lantern`. To skip the confirmation prompt, use `--yes`.

## 14. Troubleshooting

| Problem | Fix |
|---|---|
| Boot log says **"No camera access - using mouse instead"** | Allow the camera in the browser's site settings and reload. On macOS, also allow Chrome under **System Settings → Privacy & Security → Camera**. Close other apps that are using the camera |
| **Wrong camera** in use | Press `C` to switch to the next camera |
| Hands not detected | Improve the lighting, move back so your whole hand is visible, and keep your palm facing the camera. Check that **HAND TRACKING** in the status panel shows an FPS value |
| Cursor is **jittery** or **laggy** | Adjust **Smoothing** and **Responsiveness** in the tuning panel (`T`) |
| Objects **drop** while held | Raise **Sticky grab** and/or lower **Pinch sensitivity** |
| Accidental grabs | Lower **Pinch sensitivity** or **Grab zone size** |
| **"MAX OBJECTS"** | You've reached 10 objects. Disintegrate some with a fist hold, or press `X` |
| **"Microphone blocked"** | Allow the microphone in the browser. On macOS, also allow Chrome under **System Settings → Privacy & Security → Microphone** |
| **"Didn't catch that"** | Hold `SPACE` a little longer and speak clearly. The first request waits for the speech model to download |
| Online: *"isn't in the online library"* | Pick one of the suggested chips, or use the Mac version with Ollama for AI designs |
| Mac version: AI generation fails | Make sure Ollama is installed and has a model (`ollama pull qwen3`), then restart `run.py` |
| **Low FPS** | Use fewer objects, close other heavy tabs, press `V` to hide the camera background, and use Chrome or Edge with hardware acceleration enabled |
| Can't grab a dimmed object | You're drilled into a part. Press `B` / `Esc` to go back up first |
| *"USE BACK TO LEAVE THIS PART FIRST"* | The focused part can't be deleted. Go back up a level first |

For developers: open the app with `?test` at the end of the URL (for example `http://localhost:8765/?test`) to run the built-in gesture regression tests with synthetic hands.

## 15. Privacy and licences

- **Video and audio stay on your computer.** Hand tracking, face tracking and speech recognition all run inside your browser. The camera image and your voice are never uploaded.
- Model files (hand/face tracking, Whisper, and the online 3D models) are downloaded once and cached by the browser.
- Your tuning settings and best game score are stored only in this browser's local storage.
- The Mac version's AI requests go only to Ollama on your own machine.
- **3D model licences:** the online models come from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets). Six are CC0. The Cesium Milk Truck is CC-BY-4.0 (© Cesium). Each model's licence is shown in its info card and listed in `web-library.json`. Downloaded models are recorded by `tools/fetch_library.py`, and non-commercial licences are flagged in the info card.

---

*Built with MediaPipe Tasks, Three.js, transformers.js (Whisper) and Ollama.*
