# The text client, end to end, with no Godot — 9 September 2026

Dan, this morning: *"outside of godot we need to get the build running and
tested as a mud client without godot, all on its own... godot is dessert."*

This is the record of the run that says so, and of what it could not say.

## What runs

```bash
npm run test:mud-client-e2e         # the harness, ~2 s, in npm run test:all
npm run test:mud-client-e2e-break   # proves the harness can go red, ~8 s
npm run dev -- --port 5183 --strictPort false
node tools/mud-client-e2e-shots.mjs http://127.0.0.1:5183/   # the pictures
```

**Where this file and those commands disagree, the commands are right and this
page is stale.** It is a snapshot of one run; they are the check.

## The run

`node --experimental-strip-types --experimental-test-module-mocks
tools/mud-client-e2e.mjs`, on this machine, node v24.19.0:

```
65 checks, all passed
NOT CHECKED: 4 — the .sal launch file is written then shredded;
                 the attach retry dials until Lich is up;
                 the lane actually defers a command until the hold lifts;
                 the removed map panel is not reachable
```

Phase by phase, with the denominator each one prints:

| Phase | Denominator measured | Result |
|---|---|---|
| 1. viewer and AI absent | **0 of 10** modules in `gameLink.ts`'s import closure can reach the viewer, over a closure whose size is asserted first | pass |
| 2. sign in and attach | 3 of 3 characters complete; the fixture listening on 127.0.0.1:11328 | pass, 2 NOT CHECKED |
| 3. play | 29–849 lines through the socket; **6 of 6** panels populated; **3 of 3** commands observed by the fixture; **2 of 2** highlight-named lines painted; **40 of 40** gag candidates hidden; **2 of 2** macro commands fired after a dry run that sent none | pass, 1 NOT CHECKED |
| 4. drop and reconnect | the socket close observed, the phase read as `reconnecting`, the stale mark set and cleared, the session replayed | pass |
| 5. configuration | **7 of 7** domains identical across export → serialize → parse → import → apply | pass |
| 6. honesty | 11 panel ids parsed; the unknown-id guard and its sentence present | pass, 1 NOT CHECKED |

The four skips are not omissions and each names the command that settles it:

- **the `.sal` file** — `sal::write_temp` / `shred_pending_launch_files` are
  Rust. `cd src-tauri && DRC_LICH_DRY_RUN=1 cargo test --lib sal`.
- **the attach retry** — `dial_with_retry` (#458) is Rust and needs the app.
  `cd src-tauri && cargo test --lib game_link`.
- **the lane holding a command through a roundtime** — the queue, the pacing
  and the priority ordering are `src-tauri/src/command_gate.rs`. What the
  harness *does* establish either side of it is that the fixture puts a
  roundtime on the wire in a form that file's own `roundtime_until_ms`
  declares, and that the window shows and clears a hold when the lane reports
  one — the second of which nothing in TypeScript checked before this file.
  `cd src-tauri && cargo test --lib command_gate`, and
  `node tools/command-lane-break-check.mjs`.
- **the removed map panel** — it has not been removed. See below.

## Proving the checks can fail

`npm run test:mud-client-e2e-break`, 16 checks, all passed. It runs the
unsabotaged harness first and refuses to interpret anything until that is green
and has executed a whole suite, then runs three seams and asserts that each
reddens **its own steps and no others**:

| Seam | Steps reddened |
|---|---|
| `bypass-lane` — a caller writes to the socket without entering the outbound path | 1: *and each one entered the outbound path, in order* |
| `early-drop` — the stand-in Lich is never stopped, so there is no drop to notice | 3: the drop, the phase, the placeholder |
| `no-godot-lie` — the play chain's viewer-closure check inverted | 1: *nothing the client needs to play can reach the viewer* |

Note what `bypass-lane` does **not** redden: *every command the player caused
reached the game* still passes, because it did reach the game. Only the claim
that it went through the outbound path fails. That is the discrimination the
check exists for.

These are environment seams in the harness, not damage to tracked source, and
the file says so at length. They prove each check is wired to the thing it
names. They do not prove the app fails when the app is wrong — for the lane
that is `tools/command-lane-break-check.mjs`, which damages `command_gate.rs`
itself and is kept out of `test:all` because several sessions build this tree
at once.

## The pictures

Taken against a dev server on 5183 and a headless Chrome, 11 checks, all
passed. The dev server was killed by the pid that owned port 5183, confirmed by
its command line first.

- `mud-client-e2e-2026-09-09-01-empty-state.png` — nothing connected, no
  invented character, no panel calling the absent viewer an error.
- `mud-client-e2e-2026-09-09-02-sign-in.png` — the form, with the account and
  password typed.
- `mud-client-e2e-2026-09-09-03-characters.png` — after pressing Sign in:
  Phemius, Testwright, Nobody, from the scripted EAccess.
- `mud-client-e2e-2026-09-09-04-panel-window.png` — a real popped-out panel.
- `mud-client-e2e-2026-09-09-05-panel-gone.png` — `?view=panel&id=nosuchpanel`
  → **"No panel called nosuchpanel."** A named state, not a blank window.

The last two are a pair on purpose. Without the first, "the gone state renders"
would be a claim about a route nobody had shown was different from a working
one.

## What this found

1. **The map panel is not removed.** Gate 1's first check clause is
   `grep -c "kind === 'map'" src/App.tsx` → `0`; it is **2** on `main` today,
   `'map'` is still the first `PanelId` in `src/lib/layout.ts`, and
   `?view=panel&id=map` still renders `MapPanel`. Only the standalone map
   *window* route is dead (`MAP_WINDOW_ENABLED = false`).

   This survived #517, which landed while this lane was running: that PR
   cancelled 3D and wrote `docs/NO-3D.md`, whose own words are "**The map is
   gone.** … Do not build new features on the map panel and do not treat its
   survival as evidence it is current." So the decision is made and the code
   has not caught up, and those are different facts. The harness reports NOT
   CHECKED naming the `grep` Gate 1 asks for rather than asserting either way,
   and the guard it does assert — `Object.hasOwn(PANEL_CONTENT, id)` plus the
   named sentence — is what will name the map panel gone the day it is
   removed, with no edit here.

2. **The room header had no structured source in the fixture.** The replay
   printed `[The Crossing, Firulf Vista]` as bold text, which no panel can
   read: `gameStream.ts` takes the title from `<streamWindow id='main'
   subtitle=…>` and commits `roomPresentation` only when a `<component id='room
   desc'>` closes. Both are tags Lich sends and neither was in the fixture, so
   the whole room-header path had never been exercised against a socket. Added
   to `tools/fake-lich.mjs --e2e`; the panel count went from 5 of 6 to 6 of 6.

3. **A sabotage that worked was reported as one that had not.** The
   break-check reads step names back out of the harness's own `FAIL` lines by a
   two-space gap, and `padEnd(46)` leaves exactly one space when the name is
   already that long — so `and each one entered the outbound path, in order`
   arrived as an empty string and the comparison said the seam had missed. The
   harness now always emits two. Worth recording because the failure mode is
   this repository's favourite one wearing a new hat: a parser that finds
   nothing and a world with nothing in it print the same thing.

4. **A check that could never pass.** The first version of the shots tool
   asserted that the sign-in *heading* disappears once a character list
   appears. It does not — it is the section's title and stays through every
   stage — so the check reported a sign-in that had in fact worked. It now
   asserts the picker's own prompt and the three names the scripted account
   carries.

5. **"No Godot is running" was the wrong check, and would have gone red at
   somebody else.** The first version of phase 1 counted Godot processes
   machine-wide and failed if any were up. `tools/gate.mjs` starts engines
   itself, and several lanes gate at once here, so on a busy evening this would
   have reddened because another session's gate was doing its job — a false red
   addressed at a peer, which is the most expensive kind. It was also never the
   claim worth making: a machine with no Godot on it would have passed a client
   that imported the viewer on every screen. It now walks the import closure of
   `gameLink.ts` and requires that nothing in it reaches the viewer, with the
   closure size asserted first. The machine-wide count is still printed, marked
   *for information only*, because what other sessions run is their business.

6. **An unknown panel window offers no way back.** `PanelWindow.tsx`'s gone
   state is one honest sentence on an otherwise empty window, with no control
   on it. Correct as far as it goes and a real dead end for anyone who lands
   there. Filed as #518 rather than fixed here: it is a UI decision, not a defect
   in the chain this lane is proving, and #517 makes `map` the id most likely
   to land there.

## What this cannot tell you

- **Rust is not running.** The harness plays the reader thread's part. Nothing
  here executes `command_gate.rs`, `game_link.rs`, `sal.rs` or `eaccess.rs`;
  `cargo test` does, and the gate runs it.
- **Chrome is not the app.** `isTauri()` is false in the shots, so the sign-in
  runs its `?lichDryRun=1` stand-in and nothing attaches.
- **This is not the recorded play session** Gate 1 also asks for. That covers
  the installer, a real account and a real Lich, and this covers the chain a
  recording cannot re-run. Both are in the gate's check line, and neither
  replaces the other.
