# Generator profiles

A profile tells Blockout how a target AI generator consumes references and constrains the export (duration cap, resolution, fps), plus how to phrase the adherence instruction in the generated prompt. Profiles are **data, not code** — updating for a new model version is an edit, not a release.

Built-ins live in `src/engine/profiles.ts` (`BUILTIN_PROFILES`). Video: Seedance 2.0, Veo 3.1, Kling 2.x, LTX 2.3, Wan 2.2. Image: GPT Image 2, Nano Banana, Ideogram, Krea 2.

## Fields

| Field | Meaning |
|---|---|
| `id`, `name`, `vendor`, `kind` | Identity; `kind` is `'video'` or `'image'` |
| `maxDuration` | Hard per-clip cap in seconds — the Deliver panel warns when the shot exceeds it |
| `recommendedDuration` | Sweet spot shown to the user |
| `aspects` | Aspect ratios the model accepts |
| `exportWidth` | Long-edge resolution for exports targeting this model |
| `fps` | Export frame rate |
| `refModes` | How the model consumes references, in priority order: `referenceVideo`, `firstFrame`, `lastFrame`, `depthVideo`, `stills` |
| `attachHint` | One sentence shown in Deliver telling the user what to attach where |
| `adherenceClause` | Appended to the generated prompt; instructs the model to match the reference exactly |

Profiles with `depthVideo` in `refModes` also get a pre-wired `comfyui-workflow.json` in the export package.

## Adding or updating a profile

1. Edit `BUILTIN_PROFILES` in `src/engine/profiles.ts` (copy the closest existing profile).
2. Keep `exportWidth` divisible by 2 (h264 yuv420p requires even dimensions; heights are derived and evened automatically).
3. Run `npm test` — `schema.test.ts` asserts every profile produces a working prompt.
4. If the model needs a different prompt structure (not just a different adherence clause), extend `generatePrompt` in `src/engine/prompt.ts` behind a profile field, not a hardcoded id check.

## Prompting notes

The generated prompt is assembled from actual scene data: lens/sensor/aspect/lighting line, camera choreography per leg (push/track/boom/pan/tilt/zoom with timings), each labeled subject's marks and gaits with arrival times, the setting, then the profile's adherence clause and a standing instruction that grey placeholder figures should be replaced with the described subjects while keeping positions/timing identical.
