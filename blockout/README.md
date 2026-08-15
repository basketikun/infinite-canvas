<!-- Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md. -->

<div align="center">

<img src="docs/images/logo.png" alt="Blockout logo" width="340" />

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
  <a href="../../releases"><img src="https://img.shields.io/github/v/release/wassermanproductions/blockout?include_prereleases&label=download" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20·%20Windows-2f7bf6" alt="Platforms">
  <a href="https://ko-fi.com/samwasserman"><img src="https://img.shields.io/badge/Ko--fi-support%20Sam%20Wasserman-ff5e5b?logo=kofi&logoColor=white" alt="Support Sam Wasserman on Ko-fi"></a>
</p>

**Previs for AI-native filmmaking.** Stage a scene, choreograph the camera and cast against marks — the way real sets work — and export a motion-reference package a video generator can't misread.

![Blockout — a downtown car chase staged in Shoot mode](docs/images/hero.png)

</div>

---

Video generators produce dramatically better results when you hand them an unambiguous motion reference: a rough 3D render showing exactly the camera move and character blocking you want. Blockout is the fastest path from *"I can see the shot"* to *"the generator can't get it wrong."* It exports video + depth pass + stills + a tailored prompt that **Seedance 2.0, Veo 3.1, Kling, LTX 2.3, and Wan 2.2** can follow precisely.

It is deliberately **not** a 3D art tool. Grey-box mannequins and vehicles at real-world scale, real lens math, and choreography tools are the whole product. The fidelity target is *unambiguous, not beautiful.*

- 🎬 **Real camera optics** — Super 16 / 35 / Full Frame / 65mm sensors, real focal lengths, keyframable zoom, rack focus, aspect masks.
- 🚶 **Marks-based choreography** — one mental model for camera and actors; editable paths, per-mark easing, gaits, and speed sanity warnings.
- 🎥 **Coverage model** — a scene owns the blocking; shots own cameras. Shoot the same action from five angles without re-blocking.
- 👥 **One-click crowds** — dance numbers, brawls, foot and car chases: pick a size and style, click the floor, and the whole choreographed cast stages exactly there. Restyle the entire group later in one click.
- 💃 **A choreographer** — build real staged routines: timed dance phrases with formations, canon and mirroring; paired fight exchanges where reactions land on the attack; and chases along a serpentine path. Spawn a fresh cast or apply it to people you already placed.
- ✨ **An Animate tab** — 194 character motions (fights, weapons, dances, sports, everyday actions, stunts) and 33 action paths (plane landings, helicopter orbits, car chases, motorcycle weaves, galloping horses, collapsing debris) always one click away.
- 🎛️ **39 classic camera moves** — orbits, cranes, drone follows, spirals, crash-zooms, the vertigo dolly-zoom — built around your subject and riding along if it moves.
- 🌍 **Block inside real places** — import a Gaussian-splat / photogrammetry scan of a location (shot on your phone or any video-to-3D tool) and stage the action inside it. Scans are an editor aid — they never touch the export.
- 📦 **Deterministic exports** — the same project renders byte-identical frames on every run. Playback performance never touches the output.
- 🤖 **Agent-drivable** — a bundled MCP server lets Claude Code, Codex, or any MCP client stage and shoot the scene for you.

---

## The 60-second workflow

1. **STAGE** — drop in one of 50+ environment kits (downtown, residential street, supermarket, movie theater, train car, backyard with pool, sky for aerials…), place people / animals / vehicles / furniture / props from the library, and label your subjects ("THIEF", red).
2. **SHOOT** — select an actor, press `M`, click the floor to drop numbered marks; the actor walks them on your timeline. Frame the camera (or click **MS** to auto-frame a medium shot at your lens), drop camera marks, pick a rig — dolly, steadicam, handheld, crane, drone, car-mount. Scrub, retime, play.
3. **DELIVER** — pick your generator, click **Export shot package**:

```
Shot-1A/export-…/
├── 1A_reference.mp4      # the motion reference (deterministic render)
├── 1A_depth.mp4          # depth pass for ComfyUI control workflows
├── 1A_normal.mp4         # optional normal pass
├── stills/               # frame at every camera mark + first/last + top-down blocking diagram
├── prompt.txt            # generated from your actual blocking, tailored per generator
├── comfyui-workflow.json # pre-wired depth-conditioning workflow (Wan/LTX profiles)
├── metadata.json         # machine-readable marks/lenses/timings
└── README.txt
```

Plus per-scene tools: **animatic export** (all shots stitched), **contact sheet**, and **Blender handoff** (`.glb` with the animated camera + a one-click import script).

---

## Screenshot tour

|  |  |
|---|---|
| ![Stage mode: a 20-dancer number on a lit stage](docs/images/stage-crowd.png) | ![Shoot mode: looking through a drone rig following a plane](docs/images/shoot-followcam.png) |
| **Stage** — one click spawns a whole choreographed crowd. Twenty dancers, mixed styles, every performer individually editable. | **Shoot** — look through the shot camera as a *Follow Behind* drone move rides a climbing plane, aim-locked to the aircraft. |
| ![Shoot mode: a fight sequence with timeline lanes and the inspector open](docs/images/timeline-choreo.png) | ![Stage mode: a backyard scene at golden hour](docs/images/backyard.png) |
| **Choreograph** — a paired brawl laid out as timeline lanes of mark pills; select a fighter to edit its path in the inspector. | **Light** — a backyard with pool, trampoline, grill, kid and dog, dressed in golden-hour light. Nine lighting presets — including physical-sky domes lit by the sun — one click each. |

### Deliver

![Deliver mode: the export panel with a generated, per-generator prompt](docs/images/deliver.png)

Pick a target generator and Blockout writes the prompt from your *actual* blocking — lens, sensor, rig, and every subject's move — then bundles the reference video, depth pass, stills, and a pre-wired ComfyUI workflow.

---

## Feature tour

### Stage

Fifty-plus grey-box environment kits and a full library of people, animals, vehicles, furniture, and props — all at real-world scale, all procedurally generated in code. Label subjects with colored callouts, snap things to the ground, and save any staging as a reusable global **preset** (a dinner scene, a driving setup) to start from in any project.

### Shoot

Coverage the way a real set works: the **scene** owns the blocking, each **shot** owns a camera. Drop camera and actor marks on a shared timeline, choose a rig (dolly / steadicam / handheld / crane / drone / car-mount), and get **speed sanity warnings** when a walk implies 6 m/s. Auto-framing presets (two-shot, OTS, reverse, top, low, dutch) place the camera relative to your labelled subjects. Ghost an existing video — including depth maps — over the viewport as a timeline-synced **reference underlay** to match blocking by eye.

### Deliver

Data-driven **generator profiles** define durations, resolutions, reference modes, and prompt templates per model; adding a new generator is a config edit. Exports are **deterministic** — the timeline is stepped at exact fps and rendered offline, so the same project exports byte-identical frames on every run. Projects are a folder of pretty-printed, stable-key-order JSON: diff it, branch it, review it.

### Sequences & presets

Stage a whole choreographed crowd in one action — pick **Dance number / Fight / Foot chase / Car chase**, set the head-count (2–60) and style, then **click the floor exactly where you want them**: performers *and* their choreography appear there, facing the camera. For a fully staged routine, the **Choreographer** builds timed dance phrases (with formations, canon and mirroring), paired fight exchanges where each reaction lands on the attack, and chases along a serpentine path — spawn a new cast or apply it to people already on set. A staged sequence is a *starting point*: shift-click the group (their choreography moves with them when you drag) and the **✨ Animate tab** swaps everyone's dance style or path in one click. Non-character performers get motion-path presets too: plane takeoff / landing / flyby, helicopter orbit, bird swoop, motorcycle weave, galloping horse, falling debris, thrown objects. For the camera, apply one of **39 classic moves** — orbits, cranes, drone follows, whip pans, spirals, crash-zooms, the vertigo dolly-zoom — each built around your subject and riding along if it moves.

Run the take the way a set does: the **Take bar** in Shoot walks Rehearse → Record → Review — rehearse plays the blocking with path ribbons on, record wraps the camera or performer capture in a 3-2-1 countdown, and review plays back through the shot camera exactly as it will export. Spike-tape floor marks and path ribbons (with direction chevrons and time labels) are toggleable editor chrome, and a **Set your marks** coach walks a first-timer through the whole loop.

### Agent control

Blockout ships an **MCP server** so an AI agent can drive the running app — stage entities, choreograph marks, reframe, scrub, and grab a viewport screenshot — the same moves you'd make by hand. See **[mcp/README.md](mcp/README.md)** for the full agent-integration guide.

---

## Works with

Blockout is one of three standalone filmmaking apps that fit together. Each works on its own, and they chain: measure a reference in Motion Previs Studio, block and export the shot here, then split the finished mix in Stem Studio once the edit is done.

- **[Motion Previs Studio](https://github.com/wassermanproductions/motion-previs-studio)** — turns a reference video into pose, depth, and camera data. Send its reference into a Blockout shot to animate against.
- **[Stem Studio](https://github.com/wassermanproductions/stem-studio)** — splits a finished mix back into dialogue, music, and SFX stems.

---

## Install

**macOS — paste one line into Terminal** (⌘-Space, type "Terminal") and it
downloads the latest build, installs it to Applications, and opens it — no
security warnings:

```bash
curl -fsSL https://raw.githubusercontent.com/wassermanproductions/blockout/main/install.sh | bash
```

**Windows — download** the Windows 11 x64 installer from
[GitHub Releases](https://github.com/wassermanproductions/blockout/releases).
You can also grab the macOS DMG there, or build from source — see the note
about unsigned builds below.

**Linux — build from source**: see [docs/INSTALL-linux.md](docs/INSTALL-linux.md)
(Mint / Ubuntu 24.04+ steps and troubleshooting, contributed by
[@erosDiffusion](https://github.com/erosDiffusion)).

<div align="center">

<img src="docs/images/blockout-windows.png" alt="Blockout for Windows 11" width="300" />

**Now on Windows 11** — native controls, bundled export tooling, per-user install (no admin needed).

</div>

```bash
git clone <this repo>
cd blockout
npm install
npm run dev                    # development, hot reload
# or
npm run build && npm start     # production build
```

Requirements for source builds: **Node 22+**. Development builds resolve a
checksum-pinned FFmpeg executable and also support the `BLOCKOUT_FFMPEG`
override. Windows packaging downloads, verifies, and audits the exact BtbN GPL
pair before building. The rejected nonfree static package is not a dependency.
macOS packaging downloads and verifies the same pinned, audited FFmpeg pair
automatically. To rebuild it from verified sources and the audited patch
instead, run `npm run prepare:ffmpeg:mac -- --build-from-source`.

Current release artifacts are unsigned. A macOS DMG downloaded in a browser is
quarantined, so macOS falsely claims the app "is damaged" — either use the
one-line installer above (terminal downloads aren't quarantined, so no warning
appears), or after dragging Blockout to Applications run
`xattr -cr /Applications/Blockout.app` once in Terminal. On Windows,
SmartScreen will warn on first run — verify the installer's SHA-256 checksum
from the release page, then use **More info → Run anyway**. Code
signing/notarization is planned for a stable distribution.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Project opens with missing reference media | Reattach the approved source and allow Blockout to copy it into `refs`; save and reopen. |
| Subject jumps or action starts from an old position | Inspect time zero, remove stale marks, and rebuild the opening state deliberately. |
| Export has the wrong shot | Stop, refresh current state, select the intended scene and shot, and export with an exact expected base name. |
| Export cancellation leaves a partial file | Wait for cancellation to complete, confirm the encoder has closed, then remove the partial output. |
| Filename is rejected | Use a short descriptive name without reserved device words or trailing spaces and dots. |
| Agent action targets a stale entity | Refresh state, confirm the current ID, and retry once with the new ID. |
| Shoot reports invalid action or gait data | Preserve a copy, remove or rebuild the malformed mark, save, and reopen. Do not keep replaying an invalid action payload. Current builds reject it before the timeline can fail. |

---

## Agent control (MCP)

Point **Claude Code, Codex, Hermes, or any MCP client** at the bundled MCP server and it can stage the scene, choreograph marks, reframe the camera, scrub the timeline, and pull a viewport screenshot. Register it with Claude Code in one line:

```bash
claude mcp add blockout -- node /ABSOLUTE/PATH/TO/blockout/mcp/blockout-mcp.mjs
```

Packaged bridge locations are
`/Applications/Blockout.app/Contents/Resources/mcp/blockout-mcp.mjs` on macOS
and `%LOCALAPPDATA%\Programs\Blockout\resources\mcp\blockout-mcp.mjs` for the
default per-user Windows install.

Discovery and auth are automatic — the app writes a versioned localhost-only
control descriptor to `~/.config/blockout/control.json` on macOS/Linux or
`%APPDATA%\blockout\control.json` on Windows. The zero-dependency bridge reads
both versioned and legacy descriptors. There are **33 tools** (from `get_state`
and `add_entity` through `spawn_choreography`, `import_scan`, `apply_camera_move`,
and `screenshot`).
👉 **Full setup, the complete tool table, and a worked session: [mcp/README.md](mcp/README.md).**

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run typecheck` / `npm run lint` | Strict TS + ESLint |
| `npm test` | Engine unit tests (Vitest) |
| `npm run smoke` | Build + full end-to-end smoke: boots the app, stages a scene, exports a real package, verifies it with ffprobe, checks byte-determinism |
| `npm run package:mac` | Download and audit the pinned macOS FFmpeg pair, then build the current-architecture DMG |
| `npm run package:win` | Build a Windows 11 x64 per-user NSIS installer (`release/`; run on Windows) |
| `npm run verify:assets` / `npm run sbom` | Verify pinned runtime assets / generate SPDX and CycloneDX SBOMs |

## Project structure

See [docs/DESIGN.md](docs/DESIGN.md) (product + architecture), [docs/ROADMAP.md](docs/ROADMAP.md) (build plan + QA program), and [AGENTS.md](AGENTS.md) (how AI agents should build / run / modify this app). The deterministic core lives in `src/engine/` — pure TypeScript, no DOM, fully unit-tested; `state(t)` is a pure function shared by playback, video export, stills, and glTF baking.

## Support

A few people asked if they could send tips to support my work developing open source tools. So I set up an optional way in case anyone wants to.

No pressure at all. Using the apps, sharing them, starring the repositories, and contributing code all help too. Thank you.

- [GitHub Sponsors](https://github.com/sponsors/wassermanproductions)
- [Ko-fi](https://ko-fi.com/samwasserman)

## License & credits

**Apache License 2.0** — see [LICENSE](LICENSE). Free to use, modify, fork, and build on, commercially or otherwise.

**Attribution required:** per the [NOTICE](NOTICE) file (Apache 2.0 §4(d)), any use, fork, or redistribution must retain the NOTICE file and credit **Sam Wasserman ([wassermanproductions.com](https://wassermanproductions.com))** in its documentation and about/credits surface.

All 3D assets are procedurally generated in code — no external asset licenses
are involved. The Windows FFmpeg/FFprobe pair remains a separate
GPL-3.0-or-later component; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
and [its exact source/build provenance](third_party/ffmpeg/PROVENANCE.md).

The Windows/macOS ports are prerelease engineering outputs. Stable or
commercial distribution additionally requires upstream/trademark permission,
platform signing/notarization, final FFmpeg/H.264 review, and the normal full
third-party compliance review.

Created by **Sam Wasserman** — [wassermanproductions.com](https://wassermanproductions.com) · [wasserman.ai](https://wasserman.ai).

Windows support contributed and maintained by **Gumbii Digital** ([github.com/GumbiiDigital](https://github.com/GumbiiDigital)) — see [MODIFICATIONS.md](MODIFICATIONS.md).
