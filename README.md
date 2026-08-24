# DR Companion

A control panel for DragonRealms that sits beside Genie and talks to Lich, so
the things you do every session (get to a healer, run town chores, pick a
hunting ground, stop everything right now) are buttons instead of typed
commands you have to remember while something is eating you.

**Status: pre-alpha.** The interface is real and you can click through all of
it. The Lich side is not written yet. Everything you see running is a mock.
Read [Honest status](#honest-status) before you install anything.

## What it is

DragonRealms lets players build their own tools. Lich is the long-standing
automation engine, Genie is a common front end, and there are years of
community scripts behind both. What there isn't is a plain interface: most
automation is a text command with flags you look up on a wiki. DR Companion is
an attempt at the other thing, a small window with large buttons and a Stop
control that is always visible.

Three density modes, because the same player wants different things at
different times:

- **Simple**: one big context-aware button, vitals, bags, a plain log
- **Standard**: adds inventory containers and situation chips
- **Power**: shows the scoring, so you can see why it picked a healer

The design rule the code keeps coming back to: never answer "which healer" with
"the closest one". Account tier, instance, path and cost all matter, and a F2P
character locked to Zoluren has a different correct answer than a Premium one.

## Architecture

```
Game server
    |
  Lich 5   (Ruby, TCP proxy, runs the automation)
    |      ws://127.0.0.1:7415/companion   <- the bridge, not yet written
DR Companion   (Tauri 2 window, React UI, this repo)
```

The Companion never reads the game stream itself and never sends game commands
directly. It sends high-level intents (`go_healer`, `town_run`, `stop_all`)
over a localhost WebSocket, and a Lich script decides how to carry them out.
The protocol is specified in [docs/BRIDGE_CONTRACT.md](docs/BRIDGE_CONTRACT.md).

Keeping the split means the UI can be rewritten without touching game logic,
and the Lich side stays inspectable Ruby that any player can read.

## Honest status

| Piece | State |
|---|---|
| React UI, three modes | Works |
| Mock bridge (simulated character) | Works |
| Healer / hunting / town-run scoring | Works, on placeholder game data |
| WebSocket client | Written, connects, reconnects |
| `tools/mock-lich-server.mjs` | Works, but needs `npm install ws` first |
| `lich-scripts/companion_bridge.rb` | Two `echo` lines. Not implemented. |
| Tier gating (`intentBlockReason`) | Returns `null` for everything |
| Setup wizard detect + install | Simulated. Detects and installs nothing yet. |
| Tauri `.exe` build | Not yet buildable, see the review |

A fuller account is in [docs/REVIEW.md](docs/REVIEW.md), a code review of this
exact tree written before any of it was cleaned up.

## Repository history

Two packaged builds were made before this repo existed. Both are in history so
the difference is visible:

- `build-a`: the UI build, mock bridge complete
- `build-b`: the Tauri packaging pass, plus a truncated source file that broke
  the build. Committed as it shipped, then repaired in the next commit.

## Running it

You need Node.js LTS. Nothing else, for the demo.

```bash
npm install
npm run dev
```

Open `http://localhost:1420` and click **Skip installs, open demo dashboard**.
No Genie, no Lich, no Ruby. You are driving a simulated character.

To exercise the live WebSocket path without the game:

```bash
npm install ws --no-save
npm run mock-lich
```

Then switch the bridge to **Live Lich** in Settings.

For the native window you also need Rust and the Visual Studio C++ build tools.
See [docs/PACKAGING.md](docs/PACKAGING.md), and note the icon problem listed in
the review before you try `npm run tauri:build`.

## On rules and other people's work

DragonRealms permits player-built tools. What it asks of players is presence,
and that obligation belongs to the person at the keyboard, not to a program.
This one is built to make that easy rather than to argue about it: Stop is
always on screen, the activity log says what is happening, and nothing here
tries to hide that automation is running.

Game mechanics are public and come from Elanthipedia and ordinary play. Script
code belongs to whoever wrote it. This repo contains no copied script text and
does not bundle, launch or reimplement anyone's paid product. The boundary is
written down in [docs/GAME_KNOWLEDGE.md](docs/GAME_KNOWLEDGE.md).

## Licence

MIT. See [LICENSE](LICENSE).
