# Browser Audio and Video Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Trim one existing audio or video node at integer-second boundaries, preview the result, and copy or download one exported media file.

**Architecture:** Use ffmpeg.wasm in a single-thread Worker, loaded only when the user opens the trim dialog. Bundle the ESM core with Vite and keep processing local. Encode video to MP4 (H.264/AAC) and audio to MP3 after confirming the shipped core exposes the required demuxers, decoders, encoders, and muxers. Keep the trim UI to one source, start/end seconds, preview, cancel, copy, and download.

**Tech Stack:** React 19, TypeScript, Vite, Ant Design, existing local media storage, @ffmpeg/ffmpeg 0.12.x, @ffmpeg/util 0.12.x, @ffmpeg/core 0.12.10 single-thread core.

**Spec:** docs/superpowers/specs/2026-10-07-infinite-canvas-custom-feature-design.md

## Global Constraints

- Process the media in the browser; do not upload it to another service.
- The selected @ffmpeg/core single-thread WebAssembly file is about 31 MB and loads only when trimming is opened; do not put it on the initial page path.
- The fork is MIT licensed and @ffmpeg/core is GPL-2.0-or-later. Do not add or distribute this dependency until the maintainer confirms that license is acceptable for the intended distribution.
- Do not use the multi-thread core or require COOP/COEP header changes.
- Start/end values are whole seconds; reject start >= end and end beyond the source duration.
- Show loading, progress when available, and cancellation; clean up worker and object URLs on all outcomes.
- Try clipboard writing only when the browser supports the exported MIME type; if unavailable or rejected, provide one-click download.
- Do not invent file-size, duration, timeout, or retry limits.

## Review Focus

- Zero, negative, fractional, reversed, or past-duration time values: normalize slider values to whole seconds and reject invalid ranges.
- A source shorter than one whole second: explain no valid whole-second range and block export.
- Unsupported/corrupt input or missing codec: show a useful error and keep the source node unchanged.
- User cancels during core load or transcode: stop work, release worker resources, and do not show a successful export.
- ClipboardItem or navigator.clipboard missing, MIME unsupported, permission rejected, or insecure context: offer the exported file for download.

---

### Task 1: Add a lazy-loaded single-thread media engine (after license approval)

**Files:**
- Modify: web/package.json
- Modify: web/bun.lock
- Modify: web/package-lock.json
- Create: web/src/lib/media-trim.ts

**Interfaces:**
- Produces: trimMedia(source: Blob, startSeconds: number, endSeconds: number, options: { signal: AbortSignal; onProgress?: (progress: number) => void }) -> Promise<Blob>.
- Produces: terminateMediaTrim() to abort the current FFmpeg worker and release its in-memory filesystem.
- Uses local bundled ESM URLs for ffmpeg-core.js and ffmpeg-core.wasm; never fetches a third-party CDN at runtime.

- [x] Before editing dependencies, confirm the maintainer accepts shipping the GPL-2.0-or-later @ffmpeg/core package. If not accepted, stop this plan and present a browser-native alternative with its format/quality limits; do not silently substitute it.
- [x] Add compatible @ffmpeg/ffmpeg, @ffmpeg/util, and @ffmpeg/core packages. Use the Vite ESM core asset path and lazy dynamic imports so the initial application bundle does not load the core.
- [x] Inspect the shipped core’s supported formats/encoders and encode the initial supported inputs explicitly: MP4 H.264/AAC and WebM VP8/VP9/Opus/Vorbis video; MP3, WAV/PCM, Ogg Vorbis/Opus, and MP4/AAC audio. Produce MP4 H.264/AAC for video and MP3 for audio. If the core lacks any required encoder/muxer, stop and revise this plan before implementing a partial export.
- [x] Implement trimMedia with a worker-backed FFmpeg instance, integer range validation, progress callback, and AbortSignal handling. On abort, terminate the worker and reject with AbortError; allow a later trim to create a fresh worker.
- [ ] Manually check local input/output for each listed container family, verify output Blob MIME, and confirm invalid range and abort behavior.
- [ ] Run the frontend typecheck and Vite build to verify worker and ESM asset packaging. Inspect emitted build assets to confirm the core is emitted separately from the initial JavaScript entry.

### Task 2: Add a whole-second trim dialog for existing media nodes

**Files:**
- Create: web/src/components/canvas/canvas-media-trim-dialog.tsx
- Modify: web/src/components/canvas/canvas-node-hover-toolbar.tsx
- Modify: web/src/pages/canvas/project.tsx
- Modify: web/src/i18n/locales/zh-CN.ts
- Modify: web/src/i18n/locales/en-US.ts

**Interfaces:**
- Consumes: trimMedia(source, startSeconds, endSeconds, { signal, onProgress }) from Task 1.
- Produces: a trim toolbar action for existing video/audio nodes and a dialog that keeps the source node immutable.
- Dialog state: source duration, integer start/end seconds, output Blob/URL, loading/progress, and cancel.

- [x] Add a trim action only for video/audio nodes with stored media.
- [x] Load source media with getMediaBlob(node.metadata.storageKey), derive duration from node metadata or HTML media metadata, and clamp slider positions to whole seconds.
- [x] Reject invalid ranges; if floor(source duration) < 1, explain that the source has no valid whole-second range and disable export.
- [x] On export, show loading/progress when available and a Stop action. On cancel, call AbortController.abort() and terminateMediaTrim(); do not mark the operation successful.
- [x] Revoke temporary preview URLs and release worker state on close, success, failure, and cancellation. Keep the original source metadata and Blob unchanged.
- [ ] Manually check video with and without an audio track, audio preview, integer snapping, invalid/end-of-duration ranges, cancel while loading and while encoding, and failure on unsupported media.

### Task 3: Copy or download the exported file

**Files:**
- Modify: web/src/components/canvas/canvas-media-trim-dialog.tsx
- Create: web/src/lib/media-clipboard.ts
- Modify: web/src/i18n/locales/zh-CN.ts
- Modify: web/src/i18n/locales/en-US.ts

**Interfaces:**
- Produces: copyOrDownloadMedia(blob: Blob, filename: string) -> Promise<"copied" | "downloaded">.
- Uses ClipboardItem.supports(blob.type), navigator.clipboard.write, and the existing file-saver dependency.

- [x] Implement a copy attempt only when ClipboardItem.supports exists and returns true for the output MIME type, and navigator.clipboard.write is available.
- [x] If MIME support is false, the API is unavailable, or the clipboard write rejects, download the same exported Blob in one action and report which path occurred.
- [x] Keep a direct Download button available after export even when copy succeeded; do not promise paste support in every destination app.
- [ ] Manually check supported and unsupported MIME behavior, clipboard rejection, downloaded filename/type, and success/error feedback.
