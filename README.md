# DR Companion

Desktop panel for DragonRealms on Lich 5. Common actions are buttons. Stop is
always on screen.

Pre-alpha. It reads live character state and can kill running scripts. It does
not drive the game yet.

Two modes: **basic** and **power**. Power shows the scoring, so you can see why
it picked a healer. Panels resize, drag-reorder, and pop into their own windows.

## Architecture

```
Game server
    |
  Lich 5   ws://127.0.0.1:7415/companion   <- lich-scripts/companion_bridge.lic
    |
DR Companion   Tauri 2 window, React UI
```

Companion never reads the game stream and never sends game commands. It sends
intents (`go_healer`, `town_run`, `stop_all`) over a localhost WebSocket. The
Lich script decides how to carry them out. Protocol:
[docs/BRIDGE_CONTRACT.md](docs/BRIDGE_CONTRACT.md).

Your scripts stay yours. Companion calls them.

## Status

| Piece | State |
|---|---|
| React UI, two modes | Works |
| Mock bridge (simulated character) | Works |
| `lich-scripts/companion_bridge.lic` | Works. Checked against an independent WebSocket client. |
| Runaway detection | Works. Stops when it repeats without progress. |
| Live state from Lich | Works: vitals, guild, circle, favors, burden, room, per-skill ranks and mindstate |
| Training recommendation from mindstate | Works |
| `stop_all`, `pause`, `resume` | Work, and are never gated on game state |
| Every other intent | Refused, with a reason |
| Travel: passports and instance scoping | Works |
| Healer / hunting / town-run scoring | Works, on placeholder game data |
| Athletics obstacle thresholds | Data is in, not wired into routing yet |
| Setup wizard | Works. Detects and installs dependencies. |
| Per-character profiles | Works |
| Tier gating (`intentBlockReason`) | Implemented. Safety intents are never gated. |
| Preferred heal city | Works, with a scored fallback that says why |
| Windows `.exe` and installer | Builds. NSIS installer, standalone exe. |
| Command layer (roundtime, stun, refusals) | Works against a fake game |
| `check_health`, `stow_all` | Written, untested on a live game |
| Console with command trace | Works |
| Driving the game (travel, hunt, town run) | Not built |

Nothing here has talked to a live game yet.
[docs/TESTING.md](docs/TESTING.md) is the order to try things in.

## Running it

Node.js LTS, for the demo:

```bash
npm install
npm run dev
```

Open `http://localhost:1420` and click **Open the demo dashboard**. No Genie,
Lich or Ruby needed.

Live WebSocket path without the game:

```bash
npm install ws --no-save
npm run mock-lich
```

Then switch the bridge to **Live Lich** in Settings.

The native window needs Rust and the Visual Studio C++ build tools.
`npm run tauri:build` produces an NSIS installer and a standalone exe.
See [docs/PACKAGING.md](docs/PACKAGING.md).

The setup wizard looks for Ruby, Lich, Genie, plugins and maps, and offers to
install what is missing. It asks first. It will not modify a Ruby you already
have. [docs/SETUP-POLICY.md](docs/SETUP-POLICY.md).

## Dependencies that package.json will not mention

Someone tidying this machine uninstalled Ruby, reasonably, because nothing in
the repo said the project needed it.

The live list is [DEPENDENCIES.md](DEPENDENCIES.md), generated from a shared
database. A table copied into this file goes stale. This one already did — it
claimed a model was on disk an hour after the file was deleted.

Short version: Ruby, Lich 5, the Genie 4 map XML, Node 24 or newer, ComfyUI,
and one specific model checkpoint.

That last one is a licensing constraint. `flux1-schnell-fp8.safetensors` is
Apache 2.0 and puts no conditions on output, so the art pack can be given away.
`FLUX.1-dev` is the model most guides reach for and is non-commercial: one
image from it would make the pack legally unusable. The pin lives in
`tools/art-daemon.mjs` and `tools/art-run.mjs`.

Tests need Ruby on PATH:

```
export PATH="/c/Ruby4Lich5/4.0.6/bin:$PATH"
npm test
```

Trust the exit code, not the output. Without Ruby the run stops early with 313
passing assertions, zero failures, and 90 assertions never run.

## Scope

Game mechanics come from Elanthipedia and from play. This repo contains no
copied script text and does not bundle, launch or reimplement anyone else's
product. [docs/GAME_KNOWLEDGE.md](docs/GAME_KNOWLEDGE.md).

## Licence

MIT. See [LICENSE](LICENSE).
