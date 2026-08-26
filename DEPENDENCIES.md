# dr-companion — external dependencies

**None of this is declared in `package.json`, `Cargo.toml`, or any
other manifest in this repository.** If you are cleaning up this
machine, these look like unrelated clutter and are not.

Generated from the shared memory database. Edit there, not here:
`python C:\Users\Admin\dev\memory-db\mem.py dep dr-companion NAME --why "..."`

## Required

### ComfyUI

- Location: `http://127.0.0.1:8188`
- Source: https://github.com/comfyanonymous/ComfyUI
- Why: The whole art pipeline talks to it over HTTP. tools/art-daemon.mjs waits for it rather than exiting, so a missing ComfyUI looks like a daemon that is running and producing nothing. Needs the ImageScale and SaveImage nodes, which the daemon uses to emit a thumbnail it scores itself on.

### FLUX.1-schnell fp8 checkpoint

- Location: `C:\Users\Admin\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints`
- Source: https://huggingface.co/black-forest-labs/FLUX.1-schnell
- Why: schnell is Apache 2.0 and puts no conditions on its output, which is the entire reason it and not dev: the art pack can be shipped commercially and given to Simutronics. FLUX.1-dev is the trap. It is the better-known model and what most guides reach for, and it is NON-COMMERCIAL: one image rendered with it would make the whole pack legally unusable. It was on this machine and was deleted 26 Aug 2026, so there is nothing to swap in by accident today. The checkpoint is pinned in tools/art-daemon.mjs and tools/art-run.mjs to guard against it being downloaded again, which is now the likely way this goes wrong.

### Genie 4 map XML

- Location: `C:\Genie4\Maps`
- Source: https://www.playdragonrealms.com/
- Why: 85 XML files, the community cartography every map in dr-companion is built from: 17,750 rooms, 42,866 exits, 3,174 named places, and the 310 gateways linking one zone to the next. tools/build-map.mjs reads them into src/data/map. The built JSON is committed, so deleting these breaks nothing today and permanently prevents the map being rebuilt or corrected. Silent failure, months later, the first time someone needs to regenerate.

### Genie4

- Location: `C:/Genie4`
- Why: ONLY the Maps subdirectory matters. dr-companion does not talk to Genie and does not run alongside it; it reads C:\Genie4\Maps, which is 85 XML files of community cartography covering 17,750 rooms and 42,866 exits. The Genie client itself is unused by this project. Deleting Maps breaks nothing on the day you do it, because the built JSON is committed to the repository. It means the map can never be rebuilt or corrected again, and that failure surfaces months later. No package manager can restore these; they ship with the Genie client.

### Node 24 or newer

- Location: `C:\Program Files\nodejs`
- Source: https://nodejs.org/
- Why: The test suite imports TypeScript directly (tools/trail-test.mjs and tools/flow-test.mjs import from src/lib/*.ts) and relies on native type stripping. On an older Node those suites do not run.

### Ruby4Lich5

- Location: `C:/Ruby4Lich5`
- Source: https://github.com/elanthia-online/lich-5/releases
- Why: Lich runs on Ruby and dr-companion drives Lich. Not an npm or Cargo dependency, so no manifest in that project could have declared it. The runtime is in 4.0.6\; Lich itself and companion_bridge.lic are in Lich5\. Three test suites are Ruby and fail loudly without it. Beware how you check: without Ruby on PATH, npm test exits 1 having reported 313 passing assertions and ZERO failures, with ninety assertions never run. Read the exit code. Recoverable: dr-companion's setup wizard reinstalls Ruby, Lich, Genie and maps, and asks before downloading.

## Optional

- **Python 3.13** (`C:\Users\Admin\AppData\Local\Programs\Python\Python313`) — Not used by the app. Recorded because `python` on PATH resolves to the Microsoft Store stub and fails with Permission denied, which reads as "Python is missing" when it is installed. Use the full path.
