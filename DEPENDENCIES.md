# dr-companion — external dependencies

**None of this is declared in `package.json`, `Cargo.toml`, or any
other manifest in this repository.** If you are cleaning up this
machine, these look like unrelated clutter and are not.

Generated from the shared memory database. Edit there, not here:
`python C:\Users\Admin\dev\memory-db\mem.py dep dr-companion NAME --why "..."`

## Required

### ComfyUI

- Location: `http://127.0.0.1:8188`
- Why: The whole art pipeline talks to it over HTTP. Its scheduling/scoring loop was ported from tools/art-daemon.mjs into quartermaster (src/art/), verified with a real parity gate against the JS on the real corpus/manifest before the switch on 2026-09-02; run via 'qm art-daemon' now, not node. It waits for ComfyUI rather than exiting, so a missing ComfyUI looks like a daemon that is running and producing nothing. Needs the ImageScale and SaveImage nodes, which it uses to emit a thumbnail it scores itself on.
- Verify: `curl -s -m 3 http://127.0.0.1:8188/system_stats`

### FLUX.1-schnell fp8 checkpoint

- Location: `C:\Users\Admin\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints`
- Why: schnell is Apache 2.0 and puts no conditions on its output, which is the entire reason it and not dev: the art pack can be shipped commercially and given to Simutronics. FLUX.1-dev is the trap: better-known, what most guides reach for, and NON-COMMERCIAL -- one image rendered with it would make the whole pack legally unusable. It was on this machine and was deleted 26 Aug 2026. The checkpoint is pinned as a literal string (with this same explanation carried in a comment) in tools/art-run.mjs and in quartermaster's src/art/daemon.rs, which is what tools/art-daemon.mjs's own pinning was ported into on 2026-09-02.
- Verify: `Test-Path 'C:\Users\Admin\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints\flux1-schnell-fp8.safetensors'`

### Genie 4 map XML

- Location: `C:\Genie4\Maps`
- Source: https://www.playdragonrealms.com/
- Why: 85 XML files, the community cartography every map in dr-companion is built from: 17,750 rooms, 42,866 exits, 3,174 named places, and the 310 gateways linking one zone to the next. tools/build-map.mjs reads them into src/data/map. The built JSON is committed, so deleting these breaks nothing today and permanently prevents the map being rebuilt or corrected. Silent failure, months later, the first time someone needs to regenerate.

### Genie4

- Location: `C:/Genie4/Maps`
- Why: ONLY the Maps subdirectory matters: 85 XML files of twenty years of hand cartography that no package manager can restore. Deleting it breaks nothing today because the built JSON is committed - it means the map can never be rebuilt or corrected. Silent, months later.
- Verify: `ls "C:/Genie4/Maps"/*.xml | wc -l   # expect 85`

### Node 24 or newer

- Location: `C:\Program Files\nodejs`
- Source: https://nodejs.org/
- Why: The test suite imports TypeScript directly (tools/trail-test.mjs and tools/flow-test.mjs import from src/lib/*.ts) and relies on native type stripping. On an older Node those suites do not run.

### Ruby4Lich5

- Location: `C:/Ruby4Lich5`
- Source: https://github.com/elanthia-online/lich-5/releases
- Why: Lich runs on Ruby; dr-companion automates Lich. Captured in no manifest.
- Verify: `ls "C:/Ruby4Lich5/4.0.6/bin/ruby.exe" && echo PRESENT`

### ws (npm)

- Location: `C:/Users/Admin/dev/dr-companion/node_modules/ws`
- Why: tools/mock-lich-server.mjs imports it and it is NOT in package.json - unlisted optional dep named only in that file's header. Absent as of 27 Aug 2026: npm run mock-lich dies on ERR_MODULE_NOT_FOUND before executing a line.
- Verify: `cd C:/Users/Admin/dev/dr-companion && node -e "require.resolve('ws');console.log('present')"`

## Optional

- **Python 3.13** (`C:\Users\Admin\AppData\Local\Programs\Python\Python313`) — Not used by the app. Recorded because `python` on PATH resolves to the Microsoft Store stub and fails with Permission denied, which reads as "Python is missing" when it is installed. Use the full path.
