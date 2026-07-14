# PowerCodex Desktop

The PowerCodex Chat & Agent experience as a native desktop app. It bundles the
zero-dependency lifecycle server, opens the friendly UI in its own window, and adds
a real OS folder picker for "Open project".

## Run it in development

```bash
cd desktop
npm install          # one-time: pulls Electron + electron-builder
npm start            # syncs the lifecycle tool in, then launches the app window
```

## Build the installer (Windows) — easiest

**Double‑click [`build-installer.bat`](build-installer.bat).** It installs the build tools
the first time (needs internet), bundles the whole app, produces
**`dist/PowerCodex-Setup.exe`**, and opens the folder. Then run that setup — it installs
PowerCodex, adds desktop + Start‑menu shortcuts, and launches it automatically. Nothing
else to configure; the app is fully self‑contained.

### Or from a terminal

```bash
cd desktop
npm install                 # one-time: pulls Electron + electron-builder
npm run dist:installer      # → dist/PowerCodex-Setup.exe  (one-click installer)
```

Other targets:
- `npm run dist` → **`dist/PowerCodex.exe`** — a single portable executable (no install;
  double‑click, or right‑click → *Pin to taskbar*).
- `npm run dist:dir` → an unpacked app folder under `dist/win-unpacked/` (fastest; for a
  quick local try without packaging).

Everything the app needs is packaged inside the executable. On launch it starts a
local server on a free port, writes its working files under your user data folder
(`%APPDATA%/PowerCodex` on Windows, `~/Library/Application Support/PowerCodex` on macOS),
and opens the chat window. Main‑process logs are written to `<userData>/logs/main.log`.

## Build for macOS

```bash
cd desktop
npm install                                 # one-time: pulls Electron + electron-builder
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac   # → dist/PowerCodex-<version>-<arch>.dmg
```

The build is **unsigned**, so on first launch macOS Gatekeeper blocks it — **right‑click
the app → Open** once to approve it (thereafter it opens normally). To build both Intel and
Apple‑Silicon images at once: `electron-builder --mac dmg --x64 --arm64`.

> **Signing & notarization (later, not configured here):** provide a Developer ID via
> `CSC_LINK`/`CSC_KEY_PASSWORD` and add a `"notarize": { "teamId": "…" }` block under
> `build.mac` in `package.json`. Left out on purpose so local builds work with no
> credentials.

## Cross‑platform notes

- `npm run pack` (`electron-builder --dir`) builds an unpacked app for the **host OS** —
  handy for a quick local smoke test and it validates the full packaging config.
- Real installers must be built on their target OS: the **`.dmg` requires macOS** and the
  **`.exe` requires Windows** (electron‑builder won't cross‑build these reliably here).

## How it fits together

- `main.js` — Electron main process: boots `vendor/lifecycle/lib/server.js` in‑process,
  opens the window at `/chat`, and serves the native folder picker over IPC.
- `preload.js` — exposes `window.pcDesktop.pickFolder()` to the page (context‑isolated).
- `scripts/sync-lifecycle.js` — copies `../tools/lifecycle` into `vendor/lifecycle`
  before `start`/`dist`, so the build is self‑contained. `vendor/` is generated (gitignored).

## Optional: app icon

Drop a `build/icon.ico` (256×256, Windows) and/or `build/icon.icns` (macOS) into this
folder and electron‑builder picks them up automatically for the window, taskbar/dock, and
installer. Without them, the default Electron icon is used. (`desktop/.gitignore` keeps the
`build/` folder trackable so these icons commit even though the repo root ignores `build/`.)
