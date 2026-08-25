# DR Companion

A control panel for DragonRealms that sits beside Genie and talks to Lich, so
the things you do every session (get to a healer, run town chores, pick a
hunting ground, stop everything right now) are buttons instead of typed
commands you have to remember while something is eating you.

**Status: pre-alpha, but no longer a mock.** The Lich bridge is written and
works: the panel reads live character state, including per-skill mindstate, and
can stop every running script. What it does not do yet is drive the game. Read
[Honest status](#honest-status) before you install anything.

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
    |      ws://127.0.0.1:7415/companion   <- lich-scripts/companion_bridge.lic
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
| **`lich-scripts/companion_bridge.lic`** | **Works.** Verified against an independent WebSocket client. |
| Reading live state from Lich | Works: vitals, guild, circle, favors, burden, room, and per-skill ranks and mindstate |
| Training recommendation from mindstate | Works |
| `stop_all`, `pause`, `resume` | Work, and are never gated on game state |
| Every other intent | Refused with a reason. Nothing pretends to work. |
| Travel: passports and instance scoping | Works |
| Healer / hunting / town-run scoring | Works, on placeholder game data |
| Athletics obstacle thresholds | Data is in, not yet wired into route planning |
| Setup wizard | Detects for real. Installs nothing silently: it shows you the command. |
| Windows `.exe` and installer | Builds. NSIS, MSI, and a standalone exe. |
| **Driving the game** (travel, hunt, town run) | **Not built.** The bridge reads and stops. It does not yet act. |

Two documents cover the detail. [docs/REVIEW.md](docs/REVIEW.md) is a code review of this
exact tree, written before any of it was cleaned up. [docs/DOMAIN.md](docs/DOMAIN.md)
is a research pass on how DragonRealms actually works, sourced from Elanthipedia
and from reading community scripts, and it corrects several things the data
modules had guessed.

## Repository history

Two packaged builds were made before this repo existed. Both are in history so
the difference is visible:

- `build-a`: the UI build, mock bridge complete
- `build-b`: the Tauri packaging pass, plus a truncated source file that broke
  the build. Committed as it shipped, then repaired in the next commit.

## Running it

The desktop app checks what you have and offers to fill the gaps. It will not
touch a Ruby you already have, nothing downloads without a yes, and everything
it installs goes in its own folder. The rules are written down in
[docs/SETUP-POLICY.md](docs/SETUP-POLICY.md).

To run it from source you need Node.js LTS. Nothing else, for the demo.

```bash
npm install
npm run dev
```

Open `http://localhost:1420` and click **Open the demo dashboard**.
No Genie, no Lich, no Ruby. You are driving a simulated character.

To exercise the live WebSocket path without the game:

```bash
npm install ws --no-save
npm run mock-lich
```

Then switch the bridge to **Live Lich** in Settings.

For the native window you also need Rust and the Visual Studio C++ build tools.
`npm run tauri:build` produces an NSIS installer, an MSI and a standalone exe.
See [docs/PACKAGING.md](docs/PACKAGING.md).

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
