# DR Companion

DR Companion is a full desktop MUD client for DragonRealms built around Lich 5 rather than a thin overlay on top of another client.

It combines a Tauri 2 desktop shell, React UI, a Ruby/Lich bridge, map and travel tooling, scripting, configurable game-text presentation, sound, room and creature art, combat information, character state, and automation controls in one client.

The project started as a companion panel. That description is now obsolete; the repository has grown into the client itself.

## Current direction and documentation authority

The visual direction is a fixed-view, orthographic isometric RTS-style board over the authoritative MUD graph. Rooms and region groupings appear as nodes; typed tethers represent real transitions. Reusable isometric tile and structure kits supply the scenery. Actors are rigged from the start, with animation deferred until the static board and live-state projection are proven.

Start with [the world-board strategy](docs/THREE_D_WORLD_STRATEGY.md) for the design contract, [the implementation handoff](docs/THREE_D_REBUILD_HANDOFF.md) for integration boundaries, and [the working plan to 1.0](docs/PLAN_TO_1_0.md) for tracked implementation and acceptance gates. The board presents confirmed game state; it does not simulate DragonRealms outcomes.

This is the current target, not a claim that every board feature has shipped. Older panel, separate-map, and battlespace documents are labeled where their product direction has been superseded. Preserve their useful implementation and regression evidence without treating them as current design authority.

## What is here

The exact feature set changes quickly, but the major systems are now represented directly in the repository and its test suite:

- live game-state and stream handling through Lich;
- full text-client presentation, including highlights, aliases, macros, variables, substitutes and gags;
- map data, paths, pins, trail state, quick travel and room/place handling;
- room and creature art pipelines and indexes;
- sound, ambient audio and alerts;
- combat/status presentation and safety controls;
- per-character profiles and persistent UI/layout state;
- user scripting in Ruby, Python and TypeScript;
- a setup/install path for the external DragonRealms/Lich dependencies;
- Windows desktop packaging through Tauri.

`package.json` is also a useful map of the implemented surfaces: most important client subsystems have a named regression test rather than relying on the UI merely looking plausible.

## Architecture

```text
DragonRealms
    |
  Lich 5
    |   localhost WebSocket / companion bridge
    |
DR Companion
    |-- React / TypeScript UI
    |-- Tauri 2 / Rust desktop layer
    |-- maps, art, sound and client state
    |-- Python and TypeScript task runners
    `-- Ruby/Lich scripts
```

The bridge contract is documented in [`docs/BRIDGE_CONTRACT.md`](docs/BRIDGE_CONTRACT.md). Safety-sensitive actions are deliberately treated differently from ordinary automation; a stale capability signal must not make Stop unavailable.

## Development

Node 24 or newer is the supported JavaScript runtime.

```bash
npm install
npm run dev
```

The browser development build is useful for UI work and mock-state testing. The native application additionally needs Rust and the Windows C++ build tools.

On a fresh clone, before Rust-side development or tests:

```bash
npm run vendor:stub
```

Tauri validates bundled resources even in development. `vendor:stub` creates placeholders for large release-only vendor files so ordinary Rust work does not require downloading them. Release packaging refuses those placeholders and fetches the real, hash-verified resources instead.

Build the Windows application with:

```bash
npm run tauri:build
```

Packaging details live in [`docs/PACKAGING.md`](docs/PACKAGING.md).

## Tests

The project has a broad regression suite covering both client behavior and the bridge/task layers.

```bash
npm test
```

There are also focused scripts such as:

```bash
npm run test:map
npm run test:bridge
npm run test:stream
npm run test:layout
npm run test:ambient
npm run test:drtask
npm run test:ts-runner
```

Some tests exercise Ruby/Lich behavior and therefore require the Ruby4Lich5 runtime on `PATH`. Use the exit code as the authority; an interrupted dependency-specific test run can otherwise look deceptively healthy from the assertion count alone.

## User scripting

DR Companion supports three scripting surfaces:

- **Ruby** — Lich's native scripting environment;
- **Python** — user tasks and higher-level task APIs;
- **TypeScript** — user tasks against the same client/task concepts.

Start with:

- [`python/tasks/user/README.md`](python/tasks/user/README.md)
- [`typescript/README.md`](typescript/README.md)
- [`docs/PYTHON_API.md`](docs/PYTHON_API.md)
- [`docs/ENGINE.md`](docs/ENGINE.md)

User task folders are re-read by the client; adding a script does not require registering it in a central list or restarting the application.

## Setup and external dependencies

This repository has important dependencies that are not expressible in `package.json` or `Cargo.toml`, particularly the DragonRealms/Lich runtime and game data.

The maintained list is [`DEPENDENCIES.md`](DEPENDENCIES.md). Do not duplicate that table here; machine-level dependencies change and a copied list becomes false quickly.

The setup wizard detects relevant installed components and asks before changing the machine. Policy and safeguards are documented in [`docs/SETUP-POLICY.md`](docs/SETUP-POLICY.md).

## Maps, art and generated data

Several large data/art systems are generated rather than hand-maintained. Their source scripts and regression tests live under `tools/` and are intentionally separate from runtime presentation code.

The art tooling pins commercially usable model choices rather than assuming a popular model can legally be redistributed or used for shipped assets. When changing that stack, check the model licence rather than inheriting an old assumption.

## Documentation map

The repository contains both user-facing and implementation-facing documentation. Useful starting points include:

- [`docs/BRIDGE_CONTRACT.md`](docs/BRIDGE_CONTRACT.md) — bridge protocol and capability contract
- [`docs/TESTING.md`](docs/TESTING.md) — testing order and live verification
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — desktop packaging
- [`docs/SETUP-POLICY.md`](docs/SETUP-POLICY.md) — installer/setup behavior
- [`docs/GAME_KNOWLEDGE.md`](docs/GAME_KNOWLEDGE.md) — provenance and scope of game knowledge
- [`docs/LOCAL_AI_BACKGROUND_WORKER.md`](docs/LOCAL_AI_BACKGROUND_WORKER.md) — interruptible local-AI monitoring, alerts, and evidence-backed background work
- [`docs/ENGINE.md`](docs/ENGINE.md) — scripting/task-engine design
- [`DEPENDENCIES.md`](DEPENDENCIES.md) — external dependencies not captured by manifests

## Scope

Game mechanics and factual game data come from public community references and play/testing. The client does not depend on copied third-party script source to implement its own systems. See [`docs/GAME_KNOWLEDGE.md`](docs/GAME_KNOWLEDGE.md).

## Licence

MIT. See [`LICENSE`](LICENSE).
