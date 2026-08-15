# Third-Party Notices

Blockout's own source is licensed under Apache-2.0. The packaged application
also contains separately licensed components; those components remain under
their respective licenses.

## Runtime components

- Electron (MIT) and its Chromium/Node.js components; see Electron's bundled license files.
- React and React DOM (MIT), Three.js (MIT), Zustand (MIT), and Anthropic
  TypeScript SDK (MIT).
- Windows x64 packages include the pinned BtbN GPL FFmpeg/FFprobe build
  documented in `resources/ffmpeg/PROVENANCE.md`. The executable pair and
  license remain GPL-3.0-or-later components, not Apache-2.0 components.
- macOS packages build the same FFmpeg commit natively from checksum-pinned
  sources using the committed audited patch. Its FFmpeg/FFprobe pair likewise
  remains GPL-3.0-or-later and is documented in the packaged provenance.
- Source/development runs use `BLOCKOUT_FFMPEG` or a system FFmpeg. The rejected
  nonfree static package is not a dependency.

Release SBOMs enumerate the npm dependency graph in SPDX and CycloneDX formats;
`ASSET_MANIFEST.json` separately records the non-npm FFmpeg runtime. Package-
specific copyright and license texts are kept with installed components.
