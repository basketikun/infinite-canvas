<!-- Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md. -->

# Blockout MCP — drive the app from an AI agent

Blockout ships a small [MCP](https://modelcontextprotocol.io) server so an AI agent — **Claude Code, Codex, Hermes, OpenClaw, or any MCP client** — can drive a **running** copy of the app: stage entities, choreograph camera and actor marks, apply camera moves, scrub the timeline, and pull a viewport screenshot. It's the same set of moves you'd make by hand, exposed as tools.

This is the agent-integration guide. For the product itself, see the [main README](../README.md).

---

## How it works

```
 MCP client  ──stdio──▶  blockout-mcp.mjs  ──HTTP+bearer──▶  control server  ──IPC──▶  renderer
 (Claude Code)           (this bridge)      127.0.0.1:<rnd>   (src/main)                (the app)
```

- On launch, Blockout's main process starts a **localhost-only HTTP control server** on a **random port** with a **bearer token**, and writes a protocol-v1 descriptor to `~/.config/blockout/control.json` on macOS/Linux or `%APPDATA%\blockout\control.json` on Windows. Legacy `{ port, token, pid }` descriptors remain readable.
- The bridge **`blockout-mcp.mjs`** is a zero-dependency Node ≥18 stdio server. It reads that file, forwards each `tools/call` to the control server, which relays it to the renderer over the `control:invoke` / `control:result` IPC pair and returns the result.
- **Discovery and auth are automatic** — nothing to configure. The server binds to `127.0.0.1` only and every request must carry the bearer token, so it is not reachable off-machine. The port is random, so there are no port conflicts to manage.
- **The app must be running.** If it isn't, every tool returns `Blockout isn't running — launch the app first.` Launch with `npm run dev` (or the packaged app) so the control server comes up.

---

## Connect

Use an **absolute path** to `blockout-mcp.mjs` in every config below. From a
source checkout it is `<repo>/mcp/blockout-mcp.mjs`. Packaged locations are:

- macOS: `/Applications/Blockout.app/Contents/Resources/mcp/blockout-mcp.mjs`
- Windows per-user install: `%LOCALAPPDATA%\Programs\Blockout\resources\mcp\blockout-mcp.mjs`

### Claude Code

One line:

```bash
claude mcp add blockout -- node /absolute/path/to/blockout-mcp.mjs
```

Then in a session, `/mcp` should list **blockout** as connected (once the app is running). Remove it with `claude mcp remove blockout`.

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.blockout]
command = "node"
args = ["/absolute/path/to/blockout-mcp.mjs"]
```

### Hermes

The bridge is also published standalone at [wassermanproductions/blockout-mcp](https://github.com/wassermanproductions/blockout-mcp) for Hermes's git-install flow (a catalog entry is proposed in [hermes-agent#60706](https://github.com/NousResearch/hermes-agent/pull/60706) — once merged, `hermes mcp install official/blockout` is all you need). Manual config in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  blockout:
    command: "node"
    args: ["/absolute/path/to/blockout/mcp/blockout-mcp.mjs"]
```

Launch the Blockout app, then start a new Hermes session to load the tools.

### OpenClaw / any generic MCP client

Any client that takes the standard stdio server list accepts this JSON block:

```json
{
  "mcpServers": {
    "blockout": {
      "command": "node",
      "args": ["/absolute/path/to/blockout-mcp.mjs"]
    }
  }
}
```

No `env`, no headers, no URL — the bridge discovers the running app on its own.

---

## Tools

33 tools. Coordinates are in **meters**: `+X` right, `−Z` forward/away from the default camera; **heading 0 faces −Z**; `rotationDeg` / `panDeg` are clockwise seen from above; `tiltDeg` is positive up. Focal lengths are mm on Super 35 (24 wide, 35 normal, 50–85 tight).

| Tool | Params | Does |
|---|---|---|
| `get_state` | — | **Call first.** Project / scene / active-shot summary: placed entities (id, asset, label, position) and the actor + camera marks on the timeline. |
| `list_assets` | `category?` | The placeable asset catalog (people, animals, vehicles, furniture, environment kits, primitives). Filter by category. |
| `add_entity` | `assetId, x, z, label?, rotationDeg?` | Place an entity on the ground. Returns the new id. |
| `move_entity` | `entityId, x, z, y?, rotationDeg?` | Reposition an entity; omitted fields unchanged. |
| `delete_entity` | `entityId` | Remove an entity. |
| `add_actor_mark` | `entityId, x, z, time, gait?` | Drop a timeline mark: at `time` the actor is at `x,z`. Chain marks to choreograph a walk. `gait`: walk / jog / run / stand. |
| `add_camera_mark` | `x, y, z, panDeg, tiltDeg, time, focalLength?` | Drop a camera mark: camera at `x,y,z` looking `panDeg`/`tiltDeg` at `time`. |
| `clear_camera_marks` | — | Clear the active shot's camera marks (keeps actor marks). |
| `set_shot` | `name?, duration?, aspect?, fps?` | Update active-shot settings; omitted fields unchanged. |
| `new_shot` | `name?` | New shot in the scene (same blocking, fresh camera). |
| `apply_framing` | `kind: 2S\|OTS\|REV\|TOP\|LOW\|DUTCH` | Auto-frame the camera relative to labelled subjects. |
| `list_action_presets` | — | Motion-path presets for non-character performers (plane, heli, bird, chase moves, debris…). Call before `apply_action_preset`. |
| `apply_action_preset` | `entityId, presetId` | Lay a full motion path (with altitude) on an entity from its current pose. Replaces its marks. |
| `list_sequence_styles` | — | Styles available per sequence type (dance styles, fight formats, chase modes). |
| `spawn_sequence` | `type, count, style?, x?, z?, headingDeg?` | Stage a whole choreographed crowd — `dance` / `fight` / `footChase` / `carChase` — performers *and* their choreography, in one call. |
| `list_choreography_options` | — | The choreography vocabulary: kinds, styles per kind, formations, endings per kind. Call before `spawn_choreography` / `choreograph_entities`. |
| `spawn_choreography` | `kind, performers, durationS?, style?, bpm?, formation?, canon?, mirror?, formationChange?, ending?, seed?, x?, z?, headingDeg?` | Stage a full routine — a dance number, a paired / one-vs-many fight, or a foot chase — spawning fresh performers *and* their per-beat blocking. |
| `choreograph_entities` | `entityIds, kind, style?, durationS?, bpm?, formation?, canon?, mirror?, formationChange?, ending?, seed?` | Retarget existing people into a routine: keeps their assets/labels, replaces their timeline. Centers on the group. |
| `list_motion_presets` | `category?` | The single-performer motion library (fight / dance / gesture / everyday / sport / stunt) as `{ id, name, category, duration }`. |
| `list_camera_moves` | — | The 27 classic camera-move presets (orbits, cranes, drone follows, vertigo dolly-zoom, whip pan…). Call before `apply_camera_move`. |
| `apply_camera_move` | `presetId, entityId?` | Generate a full set of camera marks for a preset, built around a subject and riding along if it moves. Track moves enable aim-lock. Replaces camera marks. |
| `set_track_subject` | `entityId?` | Aim-lock the shot camera onto an entity (omit `entityId` to turn tracking off). |
| `snap_to_ground` | `entityId` | Rest an entity on the ground plane. |
| `set_time` | `t` | Scrub the playhead to `t` seconds. |
| `play` / `stop` | — | Start / stop timeline playback. |
| `screenshot` | — | Capture the current viewport as a PNG (returned as an image result). |
| `list_presets` | — | Saved global stage presets, as `{ id, name, savedAt, entityCount }`. |
| `save_preset` | `name` | Save the current staging as a named global preset. |
| `apply_preset` | `id` | Load a saved stage preset into the current scene. |
| `import_scan` | `sourcePath` | Import a Gaussian-splat / photogrammetry scan (`.ply/.splat/.spz/.ksplat`) into `scans/` as an editor-only environment. Returns the created scan. |
| `set_scan_transform` | `scanId, position?, rotationDeg?, scale?, visible?, flipped?` | Position / rotate / scale / show-hide an imported scan; `flipped` rights upside-down .splat exports. Omitted fields unchanged. |
| `remove_scan` | `scanId` | Remove an imported scan from the current scene. |
| `set_reference` | `videoPath, handoffVersion?, mode?, opacity?` | Attach a reference clip (copied into `refs/`) as a ghost/PIP underlay. Motion Previs sends independent handoff protocol version `1`; missing version remains accepted for legacy clients. |

---

## A worked session

Launch the app first (`npm run dev`), then have the agent run:

```jsonc
// 1. Orient — always start here.
get_state {}
// → { project, scene: { entities: [], marks: [] }, shot: {...} }

// 2. Set the stage.
add_entity { "assetId": "env.downtown", "x": 0, "z": 0 }
add_entity { "assetId": "person.man", "x": -1, "z": 1, "label": "THIEF" }
// → { ok: true, data: { entityId: "e_7f3a" } }

// 3. Stage a whole car chase — performers and choreography in one call.
spawn_sequence { "type": "carChase", "count": 5, "style": "weaving", "z": -10 }
// → { ok: true, data: { staged: 5, entityIds: [...] } }

// 4. Give the shot camera a move built around the lead car.
list_camera_moves {}                         // find a preset id
apply_camera_move { "presetId": "follow-behind" }

// 5. Scrub to mid-shot and look at the result.
set_time { "t": 2.5 }
screenshot {}                                // returns a PNG of the viewport
```

From here the agent can `set_shot` the aspect/duration, drop `add_actor_mark`s to refine blocking, or `apply_framing` for coverage — then you switch to **Deliver** in the UI and export the package.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `Blockout isn't running — launch the app first.` | The app isn't up (or has quit). Launch `npm run dev` / the packaged app and retry; the control server starts with the app. |
| Tools connect but every call errors after a restart | A stale control descriptor from a crashed session. It is normally deleted on quit and rewritten on launch. Quit the app fully and relaunch; if needed, delete `~/.config/blockout/control.json` (macOS/Linux) or `%APPDATA%\blockout\control.json` (Windows). |
| `node: command not found` in the client | The MCP client's PATH doesn't include Node. Use an absolute node path in the config's `command`, or launch the client from a shell where `node --version` works (Node ≥18). |
| Client can't find the server | Check the **absolute path** to `blockout-mcp.mjs` in your config, and that it points at *this* repo. |
| Port conflicts | None to worry about — the control server binds a **random** localhost port each launch and advertises it via the discovery file. |

The bridge and control server are localhost-only and token-gated; nothing is exposed off your machine.
