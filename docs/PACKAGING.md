# Packaging DR Companion as a standalone app

## Target experience

User double-clicks **DR Companion** and gets a ~520×780 window. No `cmd`, no `npm run`.

## Stack

- **Tauri 2** (Rust shell + system WebView)
- Frontend: Vite + React (already built)
- Bundle targets: **NSIS** + **MSI** on Windows

## Commands

| Command | Result |
|---------|--------|
| `npm run dev` | Browser-only UI |
| `npm run tauri:dev` | Native window, hot reload |
| `npm run tauri:build` | Release `.exe` + installer |

## Windows build host

Needed only on the machine that *produces* the installer:

1. Node.js LTS
2. `rustup` stable
3. VS Build Tools with C++
4. WebView2 runtime (preinstalled on modern Windows)

```bat
npm install
npm run tauri:build
```

Artifacts:

- `src-tauri\target\release\dr-companion.exe`
- `src-tauri\target\release\bundle\nsis\*.exe` installer
- `src-tauri\target\release\bundle\msi\*.msi`

## App behavior for packaging

- Fixed default size, resizable, not fullscreen
- Optional always-on-top (settings → Tauri `set_always_on_top`)
- Does not require admin for current-user NSIS install
- Live Lich bridge is optional; demo works offline

## CI later

GitHub Actions `windows-latest` can run `tauri:build` and attach installers to releases so players never see a terminal.
