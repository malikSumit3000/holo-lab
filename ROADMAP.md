# Holo Lab – Build Roadmap

A step-by-step workflow for the next four upgrades, written as a build prompt: each phase has a goal, design decisions, files, edge cases, and **acceptance tests that must pass before the next phase starts**.

---

## Ground rules (apply to every phase)

1. **Never break what works.** After each phase, re-run the regression suite (`?test` in the URL, see Phase 1.5): grab, drag, throw + bounce, palm spin, two-hand explode, fist disintegrate, light pen, dock buttons.
2. **Mouse fallback always works.** Every hand gesture has a mouse/keyboard equivalent so the app is testable without a camera.
3. **All tuning numbers live in one place** (`js/config.js`), never scattered as magic numbers.
4. **Free and offline-first.** No paid APIs. Anything downloaded (models, speech) is downloaded once and cached locally. Internet use is optional and clearly labelled.
5. **Licences tracked.** Every 3D model added to the library records its source and licence in `library/index.json`.
6. **Performance budget:** ≥ 50 FPS on the M5 MacBook Air with 6 objects + 2 hands. Check the FPS counter after each phase.
7. **No console errors** on load or during the regression suite.
8. **Help panel and README stay in sync** with every new gesture or key.
9. **Checkpoints:** before starting each phase, snapshot the project (git commit, with the owner's OK) so any phase can be rolled back.

---

## Phase 1 – Precision & responsiveness  *(foundation for everything else)*

**Problem:** fixed smoothing = lag when moving fast; pinch flicker drops grabs; depth is noisy.

### 1.1 One Euro filter (`js/filters.js`)
- Adaptive low-pass filter used in VR/AR: heavy smoothing when the hand is slow (precision), almost none when fast (no lag).
- Applied to: pinch cursor (x, y), palm centre (x, y), depth, hand roll (on an unwrapped angle so ±180° doesn't jump), and all 21 skeleton points.
- Filters reset when a hand re-appears so it doesn't "slide in" from its old position.

### 1.2 Sticky pinch
- Pinch **starts instantly** (ratio < ON threshold).
- Pinch **ends only after the ratio stays above OFF for 80 ms** → brief tracking flickers no longer drop objects.

### 1.3 Magnetic grabbing
- Hit zones are 25% larger + 15 px margin; nearest object wins.
- While grabbed, objects follow with less extra smoothing (the filter already handles jitter).

### 1.4 Dead-zones while holding
- Depth: ignore changes smaller than 0.15 units (stops objects drifting in/out while you hold still).
- Twist: ignore rotations smaller than ~3°.

### 1.5 Camera + tuning + tests
- Request 60 FPS from the camera (iPhone Continuity Camera supports it).
- **Tuning panel (key `T`)**: sliders for Smoothing, Responsiveness, Pinch sensitivity, Depth sensitivity, Twist sensitivity. Saved per browser.
- **Regression harness (`js/dev/sim.js`)**: synthetic hands driven through the real tracking code; open `?test` to run all gesture tests and print PASS/FAIL.

**Acceptance tests:** all regression tests pass; a fast drag has visibly less lag than before; a 3 px/frame jitter on a still hand produces < 1 px cursor jitter; a 2-frame pinch dropout does not release a held object.

---

## Phase 2 – Drill-down parts system ("pick a part out and explode it too")

### 2.1 Data model (`js/parts.js`)
- Every object is a **tree of parts**. A part definition:
  `{ name, info: { what, material, fact }, color, build(), pos, explode, children: [...] }`
- `explode` = where the part moves (direction × distance) when its parent is pulled apart.
- Each assembly re-centres itself so it rotates around its visual centre.

### 2.2 Interactions
| State | Gesture | Result |
|---|---|---|
| Assembled | pinch | grab whole object (as today) |
| Assembled | two-hand pinch + spread | explode into parts (labels appear) |
| **Exploded** | **pinch a part** | that part detaches and follows your hand |
| Part pulled | release **far** from its slot | **drill in:** part flies to centre, enlarges, becomes the focus; everything else dims to a ghost |
| Part pulled | release **near** its slot | snaps back into place |
| Focused part | two-hand spread | explode **that** part into its sub-parts (repeat to any depth) |
| Any level | pinch a breadcrumb / press `B` or `Esc` | go back up; the part flies back into its slot |

- Leaf parts (no sub-parts) can still be pulled out and inspected (rotate, resize) with their info card.
- Ghosted (dimmed) objects can't be grabbed, so you can't accidentally move the background.

### 2.3 UI
- **Breadcrumb bar** (top centre): `V4 ENGINE › PISTON ASSEMBLY › CONNECTING ROD` – each crumb is pinchable.
- **Info card** (right): name, what it does, material, a fun fact, number of sub-parts, next-step hint. Shows the focused part, or the part under your hand while hovering an exploded object.

### 2.4 Content: a detailed inline-4 engine (3–4 levels deep)
```
V4 ENGINE
├─ Engine block
├─ Cylinder head assembly
│  ├─ Head casting
│  ├─ Camshaft assembly → shaft, cam lobes, cam gear
│  ├─ Valve train → intake valves, exhaust valves, valve springs
│  ├─ Spark plugs
│  └─ Valve cover
├─ Pistons & connecting rods
│  └─ Piston assembly ×4 → piston, compression rings, oil ring, wrist pin,
│                          connecting rod assembly → rod beam, rod cap, rod bolts, bearing shells
├─ Crankshaft assembly → main shaft, crank pins, counterweights, main bearings
├─ Flywheel
├─ Timing system → crank gear, cam drive gear, timing belt
├─ Oil pan
├─ Intake manifold → plenum, runners, throttle body
└─ Exhaust manifold → runners, collector
```
- Small "running engine" animation when assembled (crank spins, pistons move).

**Acceptance tests:** explode engine → pull piston assembly → drill → explode → pull connecting rod → drill → explode → back ×2 returns to the full engine with every part in place; ghosted objects can't be grabbed; breadcrumb always matches the depth; no part is ever lost or duplicated after 10 drill/back cycles; FPS ≥ 50.

---

## Phase 3 – Holo Shooter (game mode)

### 3.1 Mode
- New dock button **GAME** / key `G`. Hides lab objects, starts the game; `Esc` returns to the lab with everything restored.

### 3.2 Finger-gun controls
- **Aim:** index finger extended, other fingers curled → crosshair projected along the index finger.
- **Fire:** thumb drops onto the hand (the "hammer"), debounced to 150 ms; must lift the thumb again to fire the next shot (no accidental auto-fire).
- **Aim assist:** crosshair gently pulled toward targets within 60 px (strength in config).
- **Other hand:** open palm = hex **shield** that blocks incoming shots; fist = **reload** (8-round magazine).
- Mouse fallback: move = aim, click = fire, right-click = shield, `R` = reload.

### 3.3 Gameplay
- 3–4 holographic drones at different depths, with movement patterns (hover, strafe, dive). They telegraph and fire slow plasma shots at you.
- Waves get faster and bigger; every 5th wave a boss drone with a weak-point.
- Score, combo multiplier, accuracy %, health, wave counter; game-over screen; high score saved locally.
- Hits: laser beam from your finger, particle explosion, hit-marker sound, score pop-up.

### 3.4 "3D window" head tracking (optional, toggle `W`)
- Face tracking (MediaPipe Face Landmarker, ~4 MB, local) moves the virtual camera with your head → the screen behaves like a window into a real 3D room. Works in lab mode too.

**Acceptance tests:** fire rate cannot exceed debounce; no shot fires while the thumb stays down; shield blocks shots in its area only; reload empties/refills correctly; game → lab → game restores state; FPS ≥ 50 with 6 drones + effects.

---

## Phase 4 – Voice → object ("say what you want, it appears")

### 4.1 Speech (offline)
- **Whisper** speech recognition running **in the browser** (transformers.js, WebGPU). Downloaded once (~40–150 MB, cached), then works offline.
- Push-to-talk: hold `Space`, or pinch the **MIC** dock button; a waveform shows it's listening; the recognised text is displayed so you can see what it heard.
- Fallback (optional, online): Chrome's built-in speech recognition.

### 4.2 Object library (offline)
- `library/index.json`: `{ id, name, aliases, tags, file, scale, licence, source }`.
- `tools/fetch_library.py`: downloads a curated starter set **once** from verified free sources, e.g. Khronos glTF sample assets (*2CylinderEngine*, *GearboxAssy*, *Buggy* – real CAD assemblies with part trees), NASA 3D resources (planets, spacecraft), Kenney/Poly Haven CC0 objects. Records licences.
- Loader converts a GLB's node hierarchy into a **Phase 2 part tree**, so library objects can be exploded and drilled into like the engine. Single-mesh models are marked "solid" (inspect only).
- Holographic restyle of loaded models (keeps their colour as a tint).

### 4.3 Matching words → object
- Normalise text ("show me a…", "spawn", plurals), then fuzzy-match names/aliases/tags; show the top 3 matches if unsure ("Did you mean: jet engine / engine / turbine?").

### 4.4 Generate when not in the library (local AI)
- Send the request to the **local Qwen model (Ollama, thinking off)** via a proxy endpoint in `run.py`; it returns a JSON part tree of primitives (box, cylinder, sphere, cone, torus) with positions, sizes, colours and hierarchy.
- JSON is validated and size-capped before building; on failure it retries once, then says what went wrong.
- Because it's built from parts, generated objects explode and drill down too.

**Acceptance tests:** "show me a planet / an engine / a gearbox" spawns the right thing offline; an unknown object ("a rocket") is generated as an explodable part tree within ~15 s; garbage AI output never crashes the app; licences for every downloaded model are listed.

---

## Order and status

| Phase | Status |
|---|---|
| 1 – Precision | built – 13/13 regression tests passed (synthetic hands); needs a real-hand feel check |
| 2 – Drill-down parts | built – drill chain, ghosting, breadcrumbs, 10-cycle test passed; needs a real-hand feel check |
| 3 – Holo Shooter | built – 19/19 regression tests passed (6 new game tests); needs a real-hand feel check |
| 4 – Voice → object | next |
