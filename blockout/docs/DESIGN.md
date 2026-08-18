<!-- Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md. -->

# Blockout — Design Document

*A desktop previs tool for AI-native filmmaking. Stage a scene in minutes, choreograph camera and character blocking against marks, and export motion-reference packages (video + stills + prompts) for generators like Seedance 2.0, Veo 3.1, Kling, LTX 2.3, and Wan 2.2.*

**Status:** Design approved-pending-review · **Owner:** Sam Wasserman · **Last updated:** 2026-07-05

---

## 1. Vision

Filmmakers using AI video generators get dramatically better results when they feed the model a motion reference — a rough 3D render that shows exactly the camera move and character blocking they want. Today that means firing up Blender, which is slow, heavy, and built for a different job.

Blockout is the fastest path from "I can see the shot in my head" to "here is a reference video the generator can't misread." It is not a 3D modeling tool. Fidelity target: **unambiguous, not beautiful.** A capsule-limbed mannequin that clearly walks from the door to the window, shot on a clearly-35mm dolly move, beats a photorealistic render that took a day.

### Product principles

1. **One mental model: marks.** Cameras hit marks. Actors hit marks. A shot is choreography between marks on a shared timeline. This is how real sets work, and it's the only concept a user must learn.
2. **Three verbs, in order: Stage → Shoot → Deliver.** The entire app is these three modes. If a feature doesn't belong to one of them, it doesn't ship.
3. **Direct manipulation everywhere.** Drag a character onto the floor. Grab the camera. Click the floor to drop a mark. No dialogs in the core loop.
4. **Defaults that are already right.** New shot = 5 seconds, 24 fps, 35mm lens on Super 35, 16:9, soft day light. You change what you need, never configure from scratch.
5. **The export is the product.** Everything upstream exists to produce a package a video generator (or Blender, or a collaborator) ingests perfectly.

---

## 2. Core workflow (60-second tour)

1. **New Project** → "The Heist" → Scene 1 → Shot 1A.
2. **STAGE:** drag *City Street* environment kit in; drag *Man*, *Woman*, *SUV* from the library; place them. Label the man "THIEF" (red), the woman "COP" (blue).
3. **SHOOT:** press `M` on the actor to drop Mark 1 at his feet, click across the street for Mark 2 → he auto-walks between them, timed. Grab the camera, frame a medium shot (or click the **MS** preset — it frames for you), drop Camera Mark 1. Move the camera, widen to 24mm, drop Camera Mark 2. Set rig = *Steadicam*. Press space: the whole choreography plays.
4. **DELIVER:** pick *Seedance 2.0* profile → Export. You get an MP4, a depth pass, stills at every mark, a top-down blocking diagram, and a prompt.txt ready to paste.

Total time for a simple shot: under five minutes.

---

## 3. Feature specification

### 3.1 The Library (Stage mode)

Searchable palette with big thumbnails, all assets deliberately grey-box/low-poly with accent-color support:

- **People:** man, woman, child, elderly; height/build sliders; rigged mannequins (Mixamo-compatible skeleton) with a gait set: stand, walk, jog, run, sit, lie, crouch, turn, gesture/talk, fall, get-in/out-of-vehicle.
- **Animals:** dog, cat, horse, bird (flight path capable); walk/run/idle gaits.
- **Vehicles:** sedan, SUV, pickup, bus, van, truck, tank, train (rides a rail spline), motorcycle, bicycle, plane (exterior), boat. Wheels rotate with movement; vehicles bank slightly on turns.
- **Furniture & props:** bed, couch, armchair, dining table, kitchen table, desk, side table, lamp, chair, stool, bar, counter, shelf, TV, plates/glasses (grouped "table setting"), door (openable), window.
- **Environment kits** (one-click room/world shells): house interior (modular walls/doors/windows), house exterior + yard, city street (buildings, sidewalks, crosswalk, streetlights), store/supermarket aisles, nightclub (dance floor, bar, DJ booth, colored lights), office, warehouse, car interior (seats/dash/windows — camera can sit inside), bus interior, plane cabin, open field, desert, parking lot, alley, rooftop.
- **Primitives:** cube, cylinder, ramp, wall segment, stairs — for anything not in the library ("it just needs to read as an ATM").
- **Custom imports:** drop in any GLB/OBJ; it's copied into the project and appears in a "Project" library tab.

**Placement:** drag from library → lands on the floor under the cursor, ground-snapped, gravity-aware (a lamp dropped over a table lands on the table). Move/rotate/scale gizmo; `alt`-drag duplicates; array tool for repeated items (parked cars, club crowd).

### 3.2 Labels & identification

Any entity can carry a **label**: billboard text that floats above it (always faces camera) plus a color tint on the model itself. Labels serve two purposes: keeping you organized, and telling the *generator* which subject is which ("THIEF in red"). Export-time toggle: labels **On / Stills only / Off** — often you want them burned into reference stills but not the motion video.

### 3.3 Cameras & lenses (Shoot mode)

Real optics, simplified controls:

- **Sensor formats:** Super 16, Super 35 (default), Full Frame / VistaVision, 65mm/IMAX. FOV computed from real sensor width + focal length — so "35mm on Super 35" looks like it does on set.
- **Lens set:** 12 / 16 / 24 / 35 / 50 / 85 / 100 / 135 mm, plus free entry. Focal length is **keyframable per mark** → zooms and dolly-zooms (Vertigo shot is a one-click preset).
- **Shot-size presets with auto-framing:** select a subject, click WS / FS / MS / MCU / CU / ECU / OTS / Insert / Two-shot → the camera repositions at the current lens to achieve that framing. Presets are starting points; you always fine-tune by hand.
- **Camera rigs** (a motion character applied on top of the mark path):
  - *Sticks* (locked-off; pan/tilt only)
  - *Dolly* (rail-smooth, eased)
  - *Steadicam* (smooth float + subtle low-frequency drift)
  - *Handheld* (layered noise, intensity slider from "doc-style" to "Bourne")
  - *Crane/Jib* (arcing boom moves)
  - *Drone* (large-scale smooth 3D flight)
  - *Car mount* (parent camera to any vehicle/actor — instant chase shots, hood mounts, POV from a moving bus)
- **Framing assists:** rule-of-thirds grid, center cross, action-safe area, aspect-ratio mask (16:9, 9:16, 2.39:1, 4:3, 1:1), horizon indicator, 180°-line indicator relative to two selected subjects.
- **Focus:** a focus-distance value per mark + a cheap DOF blur in the export render → **rack focus reads clearly in the reference video.**
- **Multiple cameras per shot** are allowed for coverage (see 3.6).

### 3.4 Marks & choreography

The unifying concept. A **mark** is: position + facing + arrival time + hold time + ease-in/out, plus per-type extras (camera: lens & focus; actor: gait & posture).

- Select any entity, press `M` or click the floor in mark-drop mode → numbered marks (1, 2, 3…) appear as classic spike-tape **T marks** on the floor, color-matched to the entity. As many marks as the shot needs.
- Between marks the entity travels a smooth, editable path (drag the curve handles to route a walk around the couch). Actors auto-orient along the path and their gait cycle speed matches actual travel speed. Vehicles steer along the path with wheel rotation.
- **Speed sanity check:** if timing implies a human walking at 14 mph, the mark glows amber and suggests "switch to run or add time" — silent guardrail against physically absurd references.
- **Timeline** (bottom panel in Shoot): one track per moving entity + one per camera. Marks are draggable pills; stretch a pill to change hold duration; drag between pills to retime a move. Scrub anywhere; space to play; loop toggle.
- Actions at marks: at any mark an actor can trigger a gait/pose change (arrive → sit; arrive → crouch) or a prop interaction (open door, get into car).

### 3.5 Environment, light & atmosphere

Generators read lighting direction and time-of-day from the reference. Keep it simple but explicit: **Day / Golden hour / Night / Interior warm / Interior cool / Club (colored, animated)** presets, a draggable sun/key-light direction widget, and a fog/atmosphere slider. No lighting rig editing — presets plus one directional control covers previs needs.

### 3.6 Projects, scenes, shots & coverage

- Hierarchy: **Project → Scene → Shot** (rail on the far left, like slides in Keynote). Shots are named film-style: 1A, 1B, 2A…
- **A Scene owns the stage** (set + entities + master blocking). **A Shot owns a camera + timing**, referencing the scene's blocking — so shooting coverage works like a real set: the action stays put, you move the camera. A shot may *fork* the blocking when it needs a variant.
- Duplicate shot / duplicate scene; drag to reorder; per-shot notes field.
- **Animatic export:** one click renders every shot in a scene, in order, stitched into a single MP4 — an instant editorial previz of the whole scene.
- **Contact sheet export:** a PDF/PNG storyboard grid — first frame of every shot with lens/duration captions — for planning and collaborators.

### 3.7 The Deliver package (export)

Export runs **deterministically offline**: the timeline is stepped at exactly the target fps and frames are rendered to an offscreen buffer, then encoded — output smoothness never depends on how fast the machine played it back. Per shot you get a folder:

```
TheHeist/Scene-01/Shot-1A/export-2026-07-05/
├── 1A_reference.mp4          # clean shaded pass, chosen aspect/res/fps
├── 1A_depth.mp4              # depth pass (for ComfyUI depth workflows)  [toggle]
├── 1A_normal.mp4             # normal pass (ControlNet-friendly)          [toggle]
├── stills/
│   ├── 1A_mark-1.png … mark-N.png   # frame at every camera mark
│   ├── 1A_first.png / 1A_last.png   # first/last frame (image-to-video anchors)
│   └── 1A_topdown.png               # blocking diagram: paths, marks, camera cone
├── prompt.txt                # generator-tailored prompt (see 3.8)
└── metadata.json             # lenses, marks, timings, labels, machine-readable
```

Resolution/fps/duration presets come from the selected **generator profile**, so you never export a 14-second clip for a model that caps at 10.

### 3.8 Generator handoff

A profile system, data-driven (JSON) so new models are a config edit, not a code change:

- **Profiles at launch:** Seedance 2.0, Veo 3.1, Kling 2.x, LTX 2.3, Wan 2.2, GPT Image 2 / Nano Banana / Ideogram / Krea 2 (stills-oriented profiles that emphasize the mark stills + top-down diagram).
- Each profile knows: max clip duration, supported resolutions/aspects, how it consumes references (first-frame image, reference video, depth video), and a **prompt template**.
- **Prompt generation:** built from actual scene data — shot size, lens, rig ("smooth steadicam move"), camera path description, each labeled subject and its action with timing ("the man labeled THIEF walks right-to-left, reaching the SUV at the 3-second mark"), lighting preset. One click copies it; it explicitly instructs the model to *match the camera and subject motion of the attached reference video*.
- **ComfyUI:** exports a ready-made workflow JSON wired for a depth/video-reference pipeline (Wan 2.2 / LTX 2.3 nodes) pointing at the exported files.
- **Direct send (later phase):** where public APIs exist (fal.ai / Replicate endpoints), a "Send to generator" button uploads the package and opens results. V1 is export + copy-paste, which is reliable everywhere.

### 3.9 Blender interop

Export any shot as **glTF (.glb)** with the full animated scene — camera (with focal-length animation), skinned actors, moving vehicles. Blender imports glTF natively, so the pipeline is: rough it in Blockout in minutes → refine in Blender when a shot demands it. A small optional Blender add-on script (bundled in the export) sets scene fps, resolution, and active camera to match on import. USD export is a later milestone.

### 3.10 Reference ingestion (matching an existing video)

Phased honestly, because full motion reconstruction is research-grade:

- **V1 — Reference underlay:** import any video (including a depth-map video) and display it as a synced, scrubbed overlay in the viewport — ghosted 50% over your 3D view or picture-in-picture. You match the blocking by eye, frame by frame, which is fast and surprisingly accurate. Onion-skin ghosting of the reference at your camera marks.
- **V2 — Assisted character motion:** run pose estimation (MediaPipe/RTMPose class models, bundled locally) on the reference to extract 2D/3D skeletal motion and retarget it onto a mannequin as a starting point you then clean up with marks.
- **V3 — Camera solve (experimental):** estimate camera trajectory from the reference video and propose camera marks. Flagged experimental; never blocks the core product.

---

## 4. UX design

### Layout (one window)

```
┌────────────────────────────────────────────────────────────────┐
│  ● ● ●    Blockout      [ STAGE ]  [ SHOOT ]  [ DELIVER ]      │ ← 3 modes, always visible
├──────┬─────────────────────────────────────────────┬───────────┤
│Scenes│                                             │ Inspector │
│&Shots│              VIEWPORT                       │ (only the │
│ rail │   HUD: 35mm · MS · 16:9 · 5.0s · 24fps      │  selected │
│      │   (each HUD item is click-to-edit)          │  thing's  │
│  1A  │                                             │  props)   │
│  1B  ├─────────────────────────────────────────────┤           │
│  2A  │  TIMELINE (Shoot mode only)                 │           │
│      │  CAM  ─●──────●────────●   marks as pills   │           │
│      │  THIEF ──●───────●                          │           │
└──────┴─────────────────────────────────────────────┴───────────┘
         Library palette overlays the left of the viewport in Stage mode
```

- **Stage mode:** library visible, timeline hidden. **Shoot mode:** timeline visible, library collapses. **Deliver mode:** viewport becomes a preview player with the export panel on the right. The interface reconfigures itself around the current verb — the user never hunts.
- **Viewport:** free orbit camera by default; `C` toggles "look through shot camera" with the aspect mask. Small always-on top-down minimap (toggleable) showing paths and marks.
- **Inspector shows only what's selected** — an actor shows gait/label/height; the camera shows lens/rig/focus; nothing shows a wall of tabs.
- **Empty states teach:** a new project's viewport says "Drag a character or environment onto the stage." A staged scene with no marks says "Select the camera and press M to drop your first mark."
- **Keyboard:** `space` play/pause · `M` drop mark · `C` look through camera · `1–9` jump to camera marks · `Cmd/Ctrl+D` duplicate · `Cmd/Ctrl+E` export · `Cmd/Ctrl+Z` deep undo (every action undoable).
- **No modal dialogs** in the core loop. Export progress is a slim bar in Deliver mode, cancellable.

### Visual language

Dark, quiet UI (near-black chrome, one accent color) so the viewport is the star. Grey-box world with saturated accent colors only where the user assigns them — labels and marks pop exactly where attention belongs. Generous type, real names ("Steadicam", not "smoothing σ=0.4"). Every icon has a text label; nothing is mystery-meat.

---

## 5. Architecture

### Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron + electron-builder** | True desktop app, one codebase → mac/win/linux installers, easiest for collaborators and AI agents to work on; mature ffmpeg/node integration for export |
| UI | **React + TypeScript (strict)** | Ubiquitous, agent-friendly, component model fits the Inspector/Library patterns |
| 3D | **Three.js (plain, imperative)** managed by a single SceneManager; React stays UI-only | The scene is driven by the deterministic `state(t)` evaluator, which fits imperative three better than r3f's declarative graph; one owner for all GL state |
| State | **Zustand**, single store, snapshot-based undo through `store.mutate` | Deep undo/redo for free; serializes cleanly to project files |
| Video encode | **FFmpeg** (audited packaged platform asset, explicit override/system fallback for source runs) fed **raw RGBA frames** from the offscreen framebuffer | Byte-deterministic fixed-fps output (no per-frame PNG encode); also depth/normal passes and animatic stitching |
| Assets | **Procedurally generated grey-box models in code** (articulated capsule mannequins, parametric vehicles/furniture/environment kits) | Zero asset licensing, zero binary blobs in git, deterministic, consistent look; a walk cycle is math, not mocap |
| Tests | Vitest (unit) + Playwright e2e smoke (real export, ffprobe-verified) + byte-determinism render test | See docs/ROADMAP.md QA plan |

*Considered and rejected:* **Tauri** (lighter, but Rust sidecar friction for ffmpeg/3D and fewer agents fluent in it), **Unity/Godot** (heavier toolchain, worse GitHub/agent ergonomics, overkill for grey-box), **Blender add-on** (inherits Blender's UI complexity — the exact thing this app exists to escape).

### Process model

- **Renderer process:** the entire app UI + interactive 3D.
- **Export worker:** a hidden renderer window renders frames off-screen at export resolution while the UI stays live; frames stream to ffmpeg in the main process. Cancellable, progress-reported.
- **Main process:** file I/O, project management, ffmpeg orchestration, (later) generator API calls.

### Project file format (git-friendly)

A project is a **folder**: `project.json` (settings, generator profile choices), `scenes/scene-01.json` (stage + entities + master blocking), `scenes/scene-01/shots/1A.json` (camera, marks, timing, overrides), `assets/` (custom imports), `exports/` (gitignored). All JSON pretty-printed with stable key ordering → clean diffs, mergeable, reviewable on GitHub.

### Determinism rule

Playback and export share one timeline-evaluation function: `state(t)` is a pure function of the project data. No wall-clock, no physics stepper, no randomness without a stored seed (handheld noise stores its seed per shot). This is what makes golden-frame testing—and trust in the export—possible.

---

## 6. Everything beyond the brief (included above, flagged here)

Ideas you didn't ask for that earn their place: shot-size **auto-framing**, **dolly-zoom preset**, **speed sanity warnings**, **coverage model** (scene owns blocking, shots are angles), **animatic export**, **contact-sheet PDF**, **rack-focus that reads in the render**, **180°-line indicator**, **car-mount/parented cameras**, **depth + outline passes for ComfyUI control**, **data-driven generator profiles**, **labels burn-in toggle per export**, **top-down blocking diagram**, and the **reference underlay** as the pragmatic v1 of video matching.
