# Installing Blockout from source on Linux

Blockout's packaged releases target macOS and Windows, but it runs well on Linux
built from source. This guide covers Linux Mint and other Debian/Ubuntu-based
distributions (Ubuntu 24.04+ package base).

> Contributed by [@erosDiffusion](https://github.com/erosDiffusion), who worked
> through these steps and the troubleshooting below on Linux Mint —
> see [issue #5](https://github.com/wassermanproductions/blockout/issues/5). Thank you!

## 1. Install system dependencies

```bash
sudo apt update
sudo apt install -y git nodejs npm ffmpeg build-essential \
                    libx11-xcb1 libxcb-dri3-0 libxtst6 libnss3 libasound2t64
```

> On Ubuntu 24.04+ / current Mint the ALSA package is `libasound2t64`
> (the older `libasound2` name has no installation candidate — see
> Troubleshooting).

## 2. Upgrade Node.js to 22+ (required)

Blockout's build tools (Vite, Electron 43) require Node.js 22 or newer. System
repositories often ship older versions (e.g. v18), so upgrade first:

```bash
# Install 'n' (Node version manager) globally
sudo npm install -g n

# Upgrade to the latest LTS version of Node.js
sudo n lts

# Clear the shell's command-location cache
hash -r

# Verify — should print v22 or higher
node -v
```

## 3. Clone and set up the repository

```bash
git clone https://github.com/wassermanproductions/blockout.git
cd blockout
npm install
```

## 4. Fetch the Electron binary

If npm's post-install scripts didn't run, download the Electron engine binary
manually:

```bash
node node_modules/electron/install.js
```

## 5. Start the application

```bash
npm start
```

## Troubleshooting

| Issue | Cause | Resolution |
| :--- | :--- | :--- |
| `Package 'libasound2' has no installation candidate` | Newer Mint/Ubuntu releases (24.04 LTS base) renamed 64-bit `time_t` libraries with a `t64` suffix. | Use `libasound2t64` in the apt install command. |
| `SyntaxError: ... 'node:util' does not provide an export named 'styleText'` or `EBADENGINE` | System Node.js is too old (e.g. v18). Vite, Rolldown, and Electron 43 require Node.js ≥ 22.12.0. | Upgrade Node with `sudo npm install -g n && sudo n lts`, run `hash -r`, then `rm -rf node_modules package-lock.json && npm install`. |
| `Error: Electron uninstall` | npm skipped Electron's post-install script, so the executable is missing from `node_modules`. | Run `node node_modules/electron/install.js`. |
