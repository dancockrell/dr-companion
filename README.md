# DR Companion

Desktop control panel for DragonRealms, built on Lich 5. Common actions are
buttons, and Stop is always on screen.

Pre-alpha. The bridge reads live character state and stops scripts. It does not
drive the game yet.

Two modes: **basic** and **power**. Power shows the scoring, so you can see why
it chose a given healer. Panels are resizable, reorderable by drag, and can be
popped into their own windows.

## Architecture

```
Game server
    |
  Lich 5   ws://127.0.0.1:7415/companion   <- lich-scripts/companion_bridge.lic
    |
DR Companion   Tauri 2 window, React UI
```

Companion never reads the game stream and never sends game commands. It sends
intents (`go_healer`, `town_run`, `stop_all`) over a localhost WebSocket and the
Lich script decides how to carry them out. Protocol:
[docs/BRIDGE_CONTRACT.md](docs/BRIDGE_CONTRACT.md).

Your scripts stay yours. Companion calls them.

## Status

| Piece | State |
|---|---|
| React UI, two modes | Works |
| Mock bridge (simulated character) | Works |
| **`lich-scripts/companion_bridge.lic`** | **Works.** Verified against an independent WebSocket client. |
| Runaway detection | Works. Stops when it repeats without progress. |
| Reading live state from Lich | Works: vitals, guild, circle, favors, burden, room, and per-skill ranks and mindstate |
| Training recommendation from mindstate | Works |
| `stop_all`, `pause`, `resume` | Work, and are never gated on game state |
| Every other intent | Refused, with a reason. |
| Travel: passports and instance scoping | Works |
| Healer / hunting / town-run scoring | Works, on placeholder game data |
| Athletics obstacle thresholds | Data is in, not yet wired into route planning |
| Setup wizard | Works. Detects and installs dependencies. |
| Per-character profiles | Works. Settings follow the character. |
| Tier gating (`intentBlockReason`) | Implemented. Safety intents are never gated. |
| Preferred heal city | Works, with a scored fallback that says why |
| Windows `.exe` and installer | Builds. NSIS, MSI, and a standalone exe. |
| Command layer (roundtime, stun, refusals) | Works, tested against a fake game |
| `check_health`, `stow_all` | Written, untested against a live game |
| Console with command trace | Works. |
| **Driving the game** (travel, hunt, town run) | **Not built.** |

Nothing here has talked to a live game yet.
[docs/TESTING.md](docs/TESTING.md) covers what to try and in what order.

## Running it

Node.js LTS, for the demo:

```bash
npm install
npm run dev
```

Open `http://localhost:1420` and click **Open the demo dashboard**. No Genie,
Lich or Ruby needed; you are driving a simulated character.

To exercise the live WebSocket path without the game:

```bash
npm install ws --no-save
npm run mock-lich
```

Then switch the bridge to **Live Lich** in Settings.

The native window needs Rust and the Visual Studio C++ build tools.
`npm run tauri:build` produces an NSIS installer, an MSI and a standalone exe.
See [docs/PACKAGING.md](docs/PACKAGING.md).

The setup wizard detects Ruby, Lich, Genie, plugins and maps, and offers to
install what is missing. It asks first, downloads nothing without a yes, and
does not modify a Ruby you already have.
[docs/SETUP-POLICY.md](docs/SETUP-POLICY.md).

## What this needs that package.json does not mention

None of the following is an npm dependency, so nothing in the repository
declares them. Written down because someone tidying this machine uninstalled
Ruby, reasonably, having found nothing anywhere saying the project needed it.

| Needs | Where | Why |
|---|---|---|
| **Ruby** | `C:\Ruby4Lich5` | Lich runs on Ruby and this drives Lich. Three test suites are Ruby and fail loudly without it. |
| **Lich 5** | `C:\Ruby4Lich5\Lich5` | The bridge script is a Lich script. |
| **Genie 4 maps** | `C:\Genie4\Maps` | 85 XML files, the community cartography every map in the app is built from. The built JSON is committed, so this is only needed to regenerate. |
| **Node 24+** | | Some suites import TypeScript directly and rely on native type stripping. Older Node silently runs fewer tests. |
| **ComfyUI** | `127.0.0.1:8188` | Only for generating art. The daemon waits for it rather than exiting, so a missing ComfyUI looks like a daemon running and producing nothing. |
| **FLUX.1-schnell fp8** | ComfyUI checkpoints | Apache 2.0, which is the entire reason it and not `dev`. See below. |

The checkpoint is a licensing constraint rather than a preference.
`flux1-schnell-fp8.safetensors` is Apache 2.0 and puts no conditions on what
it produces, so the art pack can be shipped and given away. `FLUX.1-dev` is
non-commercial and is also on this machine. Swapping it in would make the
whole pack legally unusable, so it is pinned in `tools/art-daemon.mjs` and
`tools/art-run.mjs` and must stay pinned.

Running the tests needs Ruby on PATH:

```
export PATH="/c/Ruby4Lich5/4.0.6/bin:$PATH"
npm test
```

Check the **exit code**, not the output. Without Ruby the run stops early with
313 passing assertions, zero failures reported, and 90 assertions never run.

## Scope

Game mechanics come from Elanthipedia and from play. Script code belongs to
whoever wrote it: this repo contains no copied script text and does not bundle,
launch or reimplement anyone's product.
[docs/GAME_KNOWLEDGE.md](docs/GAME_KNOWLEDGE.md).

## Licence

MIT. See [LICENSE](LICENSE).
