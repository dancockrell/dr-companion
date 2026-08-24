# DR Companion

Modern control panel for Dragon Realms (Genie + Lich). Demo mode works without the game.

## Goal: double-click executable (no terminal)

Production builds use **Tauri 2** to ship a normal Windows app:

- `DR Companion.exe` (portable / installed)
- Optional NSIS installer (Start Menu + shortcut)

### For users (later)

1. Download the installer or zip from a release.
2. Double-click **DR Companion**.
3. A small window opens beside Genie — no Command Prompt.

### For developers (now)

**Dev (browser):**

```bat
cd C:\Users\Admin\Desktop\dr-companion
npm install
npm run dev
```

Open http://localhost:1420 → **Skip to demo**.

**Desktop window (requires Rust + WebView2 on Windows):**

```bat
npm install
npm run tauri:dev
```

**Build standalone .exe (Windows build machine):**

```bat
npm install
npm run tauri:build
```

Outputs under `src-tauri\target\release\bundle\` (NSIS/MSI + exe).

Requirements to *build* the .exe (not needed by end users):

- Node.js LTS
- Rust (rustup)
- Visual Studio Build Tools (C++ workload)
- WebView2 (usually already on Windows 10/11)

End users only need the built installer — no npm, no terminal.

## Demo vs live

| Mode | Needs |
|------|--------|
| Skip to demo | Browser or Tauri window only |
| Live automation | Genie + Lich + bridge (coming next) |

## Design notes

See `docs/` and the design document shipped with the project.
