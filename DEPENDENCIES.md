# External dependencies

What you need, split by what you are trying to do. **Most people need nothing
from this page** — see the first section.

> **Rewritten 3 Sep 2026.** The previous version described one specific
> machine, down to `C:\Users\Admin\...` paths, and told the reader to edit a
> private database they have no access to. It was accurate for its author and
> unusable for anyone else. If something here is still machine-specific, that
> is a bug in this file.

---

## 1. To *run* DR Companion: nothing

The installer bundles what it needs, including Ruby and Lich. There is no
prerequisite to install first, no runtime to set up, and nothing on this page
to read.

If that is not true for you, it is a bug worth reporting — the installer
acquiring its own dependencies is a product requirement, not a convenience.

---

## 2. To *build from source*

| Need | Version | Notes |
|---|---|---|
| **Node.js** | **24 or newer** | Required, not preferred. Parts of the test suite import `.ts` files directly and rely on native type stripping; on an older Node those suites do not run — and, worse, are reported as skipped rather than failed. |
| **Rust toolchain** | stable | For the Tauri shell. Install via [rustup](https://rustup.rs/). |
| **Tauri system deps** | per platform | Follow [Tauri's prerequisites](https://tauri.app/start/prerequisites/) for your OS — WebView2 on Windows, `webkit2gtk` and friends on Linux. |
| **Python** | 3.11+ | Optional. Only for the Python task-API suites (`npm run test:drtask` and neighbours). Skip it and those suites report NOT RUN rather than passing silently. |

Everything else is in `package.json` and `Cargo.toml` and arrives with
`npm install` and `cargo build`.

### First build

```
npm install
node tools/vendor-fetch.mjs --stub    # placeholder vendor files, see below
npm run tauri:dev
```

`--stub` matters on a fresh clone. `tauri.conf.json` declares vendored files
under `bundle.resources` and Tauri validates that list on *every* build,
including a debug one — so without stubs, `cargo build` and `cargo test` both
fail with `resource path vendor\Ruby4Lich5.exe doesn't exist`, gating 59 Rust
unit tests behind a 65 MB download none of them use.

A release build does the real thing automatically: `npm run tauri:build` runs
`vendor-fetch.mjs` and then `--require-real`, which refuses to continue if what
is vendored is still a stub. That guard is the reason the convenience is safe,
and `tools/vendor-stub-test.mjs` proves the guard actually refuses rather than
merely existing.

### A note on Python on Windows

If `python` on PATH resolves to the Microsoft Store stub it fails with
`Permission denied`, which reads exactly like "Python is not installed" when it
is. Use the full interpreter path, or install from python.org and confirm with
`python -V`.

---

## 3. To *develop against a running game*

| Need | Notes |
|---|---|
| **Lich 5 + Ruby** | Bundled in a release build. For a dev build, install [Ruby4Lich5](https://github.com/elanthia-online/lich-5/releases) or point the app at an existing Lich. Lich is BSD-3-Clause; its licence travels with the vendored copy. |
| **A MUD account** | DragonRealms or GemStone IV. Free accounts are enough to exercise most of the client. |

No game account is needed for the test suite. `tools/mock-lich-server.mjs` and
`tools/fake-lich.mjs` stand in for a live Lich, and the `ws` package they use is
a normal devDependency — it installs with everything else.

---

## 4. Maintainer-only: regenerating committed assets

**You do not need any of this to run, build, test, or contribute to the
client.** The generated output is committed. These are the inputs that would
let you *regenerate* it, and they are listed because their absence is a silent
failure discovered months later rather than an error at build time.

### Cartography source — Genie 4 map XML

- **What:** 85 XML files of community cartography — 17,750 rooms, 42,866
  exits, 3,174 named places, 310 zone gateways.
- **Where:** the `Maps` directory of a [Genie](https://genieclient.com/)
  installation. Only that subdirectory matters.
- **Used by:** `tools/build-map.mjs`, which reads them into `src/data/map/`.
- **Verify:** the directory should contain 85 `.xml` files.

**Be honest about what this means.** The built JSON is committed, so a
contributor without these files can run, build and change everything — but
**cannot rebuild or correct the map**, and will not find that out until they
try. This is twenty years of hand cartography that no package manager can
restore. If you have it, do not delete it; if you do not, map regeneration is
not available to you, and a map correction has to go through someone who does.

*This is the one dependency that is genuinely not acquirable on demand, and
reducing that is worth doing — a checked-in intermediate that regeneration
could start from would remove the single hardest blocker on this page.*

### Retired: the local art pipeline

ComfyUI, the FLUX.1-schnell checkpoint and the `tools/art-*.mjs` daemons are
**retired and not wired into any automation.** They are documented here only so
that someone finding ComfyUI installed, or reading those tools, knows they are
reference material rather than a live requirement.

The 2D art they produced is being removed from the project entirely — see
`docs/INTERFACE-KNOWLEDGE.md` for the rebuild that supersedes it. One piece of
that history is worth keeping because it is a live constraint on any future
asset work:

> FLUX.1-**schnell** is Apache 2.0 and places no conditions on its output. That
> is the entire reason it and not **dev**, which is the better-known model most
> guides reach for and is **non-commercial**. A single image rendered with dev
> would make a whole asset pack legally unusable.

The rule generalises past that one model: **check the licence of a generator
before using its output, and record the licence per file.** `data/audio/manifest.json`
is the pattern to copy — a machine-readable licence per asset, a generated
attribution file, and a verification test that fails when one is missing.

---

## 5. If something here is wrong

This file drifts, because it describes things outside every manifest the
tooling checks. If a dependency is missing, stale, or written as though the
reader is on someone else's machine, that is worth a pull request on its own.
