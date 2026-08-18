# Blockout — Build Plan, QA & Audit

Companion to [DESIGN.md](DESIGN.md). This is the execution plan: milestones with acceptance criteria, the QA/audit program for a Grade-A bar, repo layout, docs, packaging, and risks.

> **Status (2026-07-06): Phases 0–6 complete for v0.1.** All automated gates green (typecheck, lint, 45 unit tests, 6-step e2e smoke with ffprobe-verified export and byte-determinism check), DMGs build and boot, 50-entity perf probe at 120fps. Deferred to post-1.0 as planned: pose extraction from reference video, camera solve, direct API send, USD. One manual gate remains for the user: feed an exported package to a real generator and judge blocking adherence (QA-CHECKLIST "product gate").

---

## 1. Repository layout

```
blockout/
├── README.md                  # GitHub-facing: what/why, screenshots, install, quickstart
├── AGENTS.md                  # how an AI agent (OpenClaw/Codex/Hermes/Claude) runs & modifies this app
├── CLAUDE.md                  # thin pointer to AGENTS.md (Claude Code convention)
├── package.json
├── docs/
│   ├── DESIGN.md              # product & architecture (source of truth)
│   ├── ROADMAP.md             # this file
│   ├── QA-CHECKLIST.md        # manual QA script, run before every release
│   └── generator-profiles.md  # how to add/update a generator profile
├── src/
│   ├── main/                  # Electron main: files, ffmpeg, export orchestration
│   ├── renderer/              # React app: modes, library, inspector, timeline
│   ├── engine/                # pure TS: timeline evaluation state(t), camera math,
│   │                          #   marks/paths, rigs (noise), schema — NO DOM/three imports
│   └── export/                # offscreen frame renderer + ffmpeg pipelines
├── assets/                    # GLB library (CC0), thumbnails, generator profiles (JSON)
├── tests/
│   ├── unit/                  # engine math, schema, prompt generation
│   ├── e2e/                   # Playwright user flows
│   └── golden/                # reference frames for render regression
└── .github/workflows/ci.yml   # lint, typecheck, unit, e2e, smoke export
```

The `engine/` package being pure TypeScript (no DOM, no three.js) is a hard rule: it's what makes camera math, mark timing, and prompt generation trivially unit-testable, and lets an AI agent reason about the core logic without a browser.

---

## 2. Milestones

Each phase ends **demoable and shippable-quality for what it contains** — no phase leaves broken stubs behind.

### Phase 0 — Foundation
Scaffold Electron + React + TS(strict) + r3f; CI green from day one (lint, typecheck, unit, e2e smoke); project file open/save; empty three-mode shell with viewport.
**Accept when:** `npm start` opens the app; `npm test` and CI pass; a project folder round-trips (save → reopen → identical state).

### Phase 1 — Stage
Asset library (people, animals, vehicles, furniture, primitives, 4 starter environment kits: house interior, city street, nightclub, car interior); drag-to-place with ground/gravity snap; gizmo move/rotate/scale; labels + color tints; lighting presets + sun widget; undo/redo; custom GLB import.
**Accept when:** the 60-second-tour staging step works end to end by direct manipulation only; 50-entity scene orbits at 60 fps on an M-series Mac.

### Phase 2 — Shoot
Camera entity with sensor/lens math (verified against real FOV tables); shot-size auto-framing; marks system (camera + actors + vehicles), editable paths, gait playback with speed matching + sanity warnings; timeline UI (tracks, pills, scrub, retime); camera rigs (sticks/dolly/steadicam/handheld/crane/drone/car-mount); look-through-camera with aspect masks and framing assists; keyframable zoom + dolly-zoom preset; rack-focus DOF.
**Accept when:** a 3-camera-mark + 2-actor shot with a steadicam rig plays back correctly, is fully retimeable on the timeline, and `state(t)` unit tests cover marks/easing/rig math.

### Phase 3 — Deliver
Deterministic offscreen export → ffmpeg MP4; depth + outline passes; mark stills, first/last frames, top-down blocking diagram; metadata.json; generator profiles (Seedance 2.0, Veo 3.1, Kling, LTX 2.3, Wan 2.2 + stills profiles); prompt generation; export package folder layout; labels On/Stills-only/Off.
**Accept when:** the headless smoke test scripts a scene, exports, and asserts: file exists, exact frame count, duration, resolution; golden-frame diffs pass; a real Seedance/Kling run with an exported package produces visibly blocking-matched output (manual gate, you judge it).

### Phase 4 — Projects & film workflow
Scene/shot rail; coverage model (scene-owned blocking, shot-owned cameras, fork-on-demand); duplicate/reorder; animatic export; contact-sheet PDF; per-shot notes.
**Accept when:** a 2-scene, 6-shot mini-project can be built, covered from 3 angles without re-blocking, and exported as one animatic.

### Phase 5 — Interop
glTF export (animated camera + skinned actors) verified by round-trip import in Blender 4.x; bundled Blender helper script; ComfyUI workflow JSON export; reference video underlay (ghost overlay + PiP, timeline-synced, onion-skin at marks).
**Accept when:** a Blockout shot opened in Blender shows the same camera move at the same fps through the active camera; a reference video can be matched by eye using the underlay.

### Phase 6 — Hardening, audit & release (the "Level A" gate)
Full QA program (below); performance profiling; error handling & crash recovery (autosave every 60s, restore on relaunch); packaging (DMG mac arm64/x64, NSIS Windows, AppImage); code-signing/notarization decision; README with screenshots + install docs; AGENTS.md finalized; version 1.0 tag.
**Accept when:** the audit checklist (§3) is 100% green and a zero-context user can install from the GitHub release and produce an export in under 15 minutes.

### Phase 7+ — Post-1.0
Assisted pose extraction from reference video (MediaPipe-class, local); experimental camera solve; direct API send (fal/Replicate); USD export; asset-pack expansion; preset sharing.

---

## 3. QA & audit program (Grade-A definition)

### Automated (CI on every push)
- **Typecheck + lint:** TS strict, ESLint, no warnings allowed on main.
- **Unit (Vitest):** camera FOV vs. published sensor/lens tables; mark timing/easing; path arc-length & gait speed; schema round-trip (save→load→deep-equal); prompt generator output per profile.
- **Golden-frame regression:** N canonical scenes rendered headless; per-pixel diff within tolerance. Catches any rendering or determinism drift.
- **E2E (Playwright):** the 60-second tour as a scripted test — stage, mark, play, export.
- **Headless smoke export:** scripted project → full export → assert frame count, duration, resolution, all package files present, metadata.json valid against schema.

### Manual QA script (docs/QA-CHECKLIST.md, run per release)
Fresh-install first-run; every library category placeable; undo through 50 mixed operations; a complex shot (5 camera marks, 3 actors, vehicle, rack focus, handheld); kill-app-mid-edit → autosave recovery; export every pass type; import package stills/video into one real generator; Blender round-trip; 30-minute free-use session hunting for friction, not just bugs.

### The audit (Phase 6 exit)
A structured pass, findings triaged and burned down to zero P0/P1:
1. **Correctness:** every DESIGN.md feature demoed against its spec line.
2. **Determinism:** same project exported twice on two machines → identical frame checksums.
3. **Performance budget:** 60 fps viewport @ 50 entities; export ≥ 4 fps @ 1080p on an M-series Mac; app cold-start < 4s.
4. **Robustness:** corrupted project file → readable error, no crash; disk-full during export → clean abort; missing custom asset → placeholder + warning.
5. **UX review:** every feature reachable without documentation; empty states present; no dead-end screens; keyboard map complete.
6. **Code review:** a full review pass (fresh-context, adversarial) over `engine/` and `export/` — the correctness-critical core.
7. **Docs:** README accurate against the shipped build; AGENTS.md commands verified by actually running an agent session against them.

---

## 4. Documentation deliverables

- **README.md** — hero screenshot, one-paragraph pitch, feature bullets, install (download release / build from source), the 60-second tour, generator-profile table, license & asset credits. Written for a GitHub visitor who's never heard of the app.
- **AGENTS.md** — for OpenClaw/Codex/Hermes/Claude agents: prerequisites, exact commands (`npm install`, `npm start`, `npm test`, `npm run smoke`, `npm run package`), repo map, engine-purity rule, how to add an asset or generator profile, test-before-commit policy, gotchas (Electron version pinning, ffmpeg binary paths). **CLAUDE.md** points here so every agent ecosystem finds one source of truth.
- **docs/QA-CHECKLIST.md**, **docs/generator-profiles.md** — as above.

---

## 5. Sharing & distribution

- GitHub repo (private or public — your call), releases with attached installers built by CI on tags.
- **macOS note:** unsigned apps trigger Gatekeeper warnings for other users. Options: (a) Apple Developer ID ($99/yr) + notarization in CI — the professional route if you'll share widely; (b) document right-click-Open for small-circle sharing. Decide at Phase 6; the build supports both.
- Windows/Linux installers from the same CI matrix.

---

## 6. Risks & honest calls

| Risk | Call |
|---|---|
| Reference-video → auto-reconstruction (feature #6) is research-grade | Underlay matching ships in v1 and is genuinely useful; pose extraction post-1.0; camera solve experimental. Don't let this block the core. |
| Character animation quality (foot-sliding, retarget glitches) | Grey-box tolerance helps; gait-speed matching in engine; accept "clearly a walking human," not mocap polish. |
| Generator behavior changes (durations, ref formats) | Profiles are data (JSON) — updating a model is an edit, not a release. |
| Electron app size (~200MB) | Accepted cost for the ecosystem benefits; assets kept lean. |
| Scope creep in Stage mode (becoming a 3D editor) | Principle 1 & 5: if it doesn't serve marks or the export, it's out. |

---

## 7. Build execution & model routing

When we build this: architecture, the `engine/` core (timeline evaluation, camera math, rig noise), export determinism, and the Phase 6 audit are **Fable-tier** work. Scaffolding, library UI components, asset wiring, profile JSON authoring, docs drafts, and test boilerplate route to **Opus/Sonnet subagents** per your model-usage strategy. Each phase ends with tests green and a commit, so any agent (or future session) can pick up from a clean state.
