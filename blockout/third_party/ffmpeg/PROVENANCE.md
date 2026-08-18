# FFmpeg/FFprobe Binaries and Corresponding Source

Blockout port baseline: upstream commit
`6a85105101a0504e38c330b0caae010c957b2321`.

The Windows x64 installer uses the BtbN GPL build from release
`autobuild-2026-06-30-13-34`:

- Archive: `ffmpeg-n7.1.5-1-g7d0e842004-win64-gpl-7.1.zip`
- Archive SHA-256: `405b190f746db40539eb453967f72c0e69d8bf260b10ceff36e0c2149a9ad22f`
- `ffmpeg.exe`: `9b2f8ddda3958ce61433b07efc657ab078e71a36d6a0a3240da7eece70a75bc2`
- `ffprobe.exe`: `4919faa7f0586eb05802908276f78096d3003335eaa38c378b6b1c44f1e19814`
- `LICENSE.txt`: `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`

The package script verifies the archive and every extracted file, then checks
that both executables contain `--enable-gpl`, `--enable-version3`,
`--enable-libx264`, and `--disable-libfdk-aac`, and do not contain
`--enable-nonfree`. Only those two executables, the license, and this provenance
file enter the installer.

Corresponding source uploaded beside each Windows prerelease:

- FFmpeg commit `7d0e8420048cffd0ca3883b877ead2390496d0b2` archive, SHA-256
  `2caafb2bbfb69c0518470651640e71ac7f5fb3117d188bf6ea2d909307a02b1d`.
- BtbN build scripts commit `7a83528ea3431e9eca982a712bc3a7cd0789d5d0` archive, SHA-256
  `0f0f15e02b4fd1b1bc37d2e3a6f57cd7a2078c31a51c8546110d3ccb40029d30`.

Run `npm run fetch:ffmpeg-source` to download and verify both archives. macOS
uses a native source build from `mifi/ffmpeg-build-script` commit
`967cfb0c7d8ab000c466d00e4b6186f150ef4481`, modified only by the committed
`macos-gpl.patch` to pin the same FFmpeg commit, remove nonfree/OpenSSL, and
disable the x264 CLI. Every input archive and the patch are checksum-pinned in
`ASSET_MANIFEST.json`; `prepare:ffmpeg:mac` verifies them before building.
`verify:release-assets` requires GPL/version3/x264, rejects nonfree/OpenSSL,
checks the GPL license and output hashes, and rejects non-system dynamic libraries.

macOS packages are built natively per architecture and include only `ffmpeg`,
`ffprobe`, the GPL text, build manifest, and this provenance file. The rejected
nonfree static package is not a dependency and is never included.
