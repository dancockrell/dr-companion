# Packaging DR Companion as a standalone app

> **Rule 0 — never fork.** A problem is to be solved, never dodged. Fix the thing,
> replace it outright, or delete the feature — those are the only three moves.
> Never leave two answers to one question standing side by side, and never route
> a parallel path around something you did not want to touch. That is a noodle to
> nowhere, and it is the most serious thing you can do to this codebase.
> Full rule: [`CLAUDE.md`](../CLAUDE.md).

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

## CI later

GitHub Actions `windows-latest` can run `tauri:build` and attach installers to releases so players never see a terminal.
