# Packaging DR Companion as a standalone app

## Target experience

User double-clicks **DR Companion** and gets a ~520×780 window. No `cmd`, no `npm run`.

## Stack

- **Tauri 2** (Rust shell + system WebView)
- Frontend: Vite + React (already built)
- Bundle target: **NSIS** on Windows - current-user install, no admin
  required, which is the whole target experience. MSI was dropped
  (2026-08-29): it's the format for enterprise-managed rollout (Group
  Policy/SCCM), which this app has no use for, and it was the one thing
  in CI that was ever flaky (WiX's `light.exe` intermittently failing to
  launch on a fresh Windows runner).

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

## App behavior for packaging

- Fixed default size, resizable, not fullscreen
- Optional always-on-top (settings → Tauri `set_always_on_top`)
- Does not require admin for current-user NSIS install
- Live Lich bridge is optional; demo works offline

## CI

This is built, not planned. `.github/workflows/release.yml` runs on a `v*` tag,
on `windows-latest`, calls `npm run tauri:build`, and attaches
`src-tauri/target/release/bundle/nsis/*.exe` to a draft release, so players
never see a terminal. `docs/RELEASE.md` is the procedure; the workflow file is
what actually runs.
