# Live state, and how to check it yourself

Several sessions work this repo at once. This file exists so none of them has
to ask another what is true, and so a session closing does not take the answer
with it.

**Every entry records the command that establishes it, not the answer that
command gave once.** A claim rots the moment the machine moves and looks
exactly as authoritative afterwards; a check tells the truth every time it is
run. Where prose and a command disagree, the command is right and the prose is
stale — fix the prose.

Prime session coordinates. Bring collisions and rulings here rather than
deciding in parallel.

---

## Is the game actually live?

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='rubyw.exe'\" | Select-Object ProcessId,CommandLine | Format-List"
```

A live session looks like:

```
lich.rbw --login Phemius --dragonrealms --stormfront --headless=11024 --start-scripts=companion_bridge
```

Then confirm it reached Simutronics rather than merely started — an outbound
established connection to a non-loopback address is the only proof:

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess <pid> -State Established | Where-Object { \$_.RemoteAddress -notlike '127.*' }"
```

**Do not restart Lich or the app without checking this first.** A live session
is a real character in a real world, and dropping it to fix a display bug is
the wrong trade.

## Are the two sockets up?

```bash
netstat -ano | grep LISTENING | grep -E ":11024|:7415"
```

- **11024** — Lich's detachable client. The game text link. `game_link.rs`.
- **7415** — `companion_bridge.lic`. Everything else: character, vitals, map,
  room, scripts. `realBridge.ts`.

These are independent. The game pane can stream perfectly while every
character panel sits empty, which is exactly the state that looked like a
broken app before `7755abf`. If the dashboard is empty, check 7415 before
suspecting the UI.

## Is the bridge serving real data?

From inside the running app (`node tools/app-eyes.mjs eval "..."`):

```js
(async () => {
  const token = await window.__TAURI_INTERNALS__.invoke('read_bridge_token');
  const ws = new WebSocket('ws://127.0.0.1:7415/companion');
  const out = [];
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = (m) => out.push(String(m.data).slice(0, 120));
  return new Promise(r => setTimeout(() => r(JSON.stringify(out, null, 1)), 3000));
})()
```

A healthy bridge answers `hello` then `status` carrying the character. An
unauthenticated probe is dropped with close code 1006 — that is the bridge
working, not failing.

## Is the installed bridge script current?

```js
window.__TAURI_INTERNALS__.invoke('bridge_install_status')
```

`current: true` matches, `false` differs, `null` means could not check — never
read `null` as either. Compares content, not `BRIDGE_VERSION`: two copies both
declared `0.9.0` while differing by 15 KB, one with the Origin check and token
auth and one without.

## Who owns what

Claimed as of 27 Aug 2026, ~21:45. **Check with prime before taking anything
here** — this table is the one thing in this file that cannot be verified by a
command, so it is the one most likely to be stale.

| Lane | Session | Files |
|---|---|---|
| `list_scripts` / `start_script` intents, raw launcher | GUI features 1 | **owns `lich-scripts/companion_bridge.lic`**, `ScriptLibraryPanel.tsx` |
| Script curation, taxonomy | UX iteration 3 | `src/data/scriptCatalog.ts` |
| Data panels — #4, #5, #6, #10 | downloads-69 | `Paperdoll.tsx`, `InventoryPanel.tsx` |
| Live-vs-demo gaps — channel tabs, experience skills | downloads-8a | `gameLink.ts` (read), diagnosis |
| Cross-panel layout coherence | downloads-37 | `components/layout/`, `components/dashboard/` |
| Activities surface — #30, #11, #12 | downloads-ca | TaskFlow buttons, intent manifest UI |
| Sound verification | downloads-94 | read-only on the corpus |
| Sound authoring, corpus writes | second sounds session | `dr-genie-settings/Config/`, `Sounds/` |
| Art generation | downloads-0f | `data/art/`, `public/rooms/` |
| Map database | prime | — |

### `companion_bridge.lic` has exactly one owner

Three lanes need changes to it — script launching, injury reporting, the
intent manifest. **Only GUI features 1 edits it.** Everyone else writes a
contract and hands it over. Two sessions wrote the installed copy minutes
apart tonight and one silently overwrote the other with an older version;
that file lives outside any git tree and has no collision protection.

When it does change: edit the repo copy, install via the app's own
`install_bridge_script`, verify with `bridge_install_status`.

### This repo is oversubscribed

Nine-plus sessions have been pointed at one small app, several with the same
brief verbatim. There is not enough distinct non-colliding work for all of
them, and inventing lanes to keep everyone busy produces collisions rather
than throughput.

If you arrive and every lane above is taken, **the useful thing is not to find
a new corner to build in.** In rough order of value:

1. **Verify somebody else's work against the fixture.** Read-only, collides
   with nothing, and this repo's recurring defect is checks that cannot fail.
2. **Take an unclaimed issue** — #7 (Gor'Tog ears), #8 (art distribution,
   `needs-decision`), #12 (PLAY two-axis model).
3. **Say you are idle.** That is a real answer and more useful than a
   plausible-looking edit nobody asked for.

## Known broken on live

Checked against the running client, not inferred. Fix or claim these by telling
prime first.

**1. Lich has no map database.** The room panel is dead and the game pane
floods with `--- Lich: error: no map database found`.

```bash
ls /c/Ruby4Lich5/Lich5/data/DR/map-*.json 2>/dev/null || echo "MISSING"
```

Established, so nobody re-derives it:

- Lich searches `DATA_DIR/<game>/map-<digits>.json` — `lib/common/map/map_base.rb`,
  `json_map_files`. `data/DR/` exists and holds only `Phemius/`.
- `scripts/download-prime-map.lic` is the official downloader: TLS to
  `repo.lichproject.org:7157` with a pinned CA. It is Lich's own, not ours.
- **The bridge already has an `install_mapdb` intent** (`companion_bridge.lic`,
  `def install_mapdb`). It runs the same script through Lich's internal
  `Script.start` and returns immediately without waiting, on purpose — it is a
  large network fetch and blocking the bridge thread would freeze every panel.
  **This is the path to use.** It is more reliable than sending a command down
  the client socket, because it does not depend on how client input is parsed.

Ruled out, with the evidence:

- **Not a wrong command character.** `main.rb:58` sets
  `$clean_lich_char = Frontend.client.eql?('genie') ? ',' : ';'`, and this app
  declares `--stormfront`, so `;` is correct.
- **Not the trust system.** Trust is automatic — `script.rb:148` sets it from
  `script_obj.labels.length <= 1` rather than requiring a manual `;trust`.

**Still open:** invoking `;download-prime-map` through the client socket
produced no file and no visible error, and the reason is not established. It
cannot be chased without a live Lich, because the script only runs inside one.
Next person with a live session: call `install_mapdb` through the bridge rather
than repeating the socket command, and watch for what it logs.

**2. Channel tabs stay empty on live.** `isTaggedStream()` in `gameLink.ts` is
the discriminator — if false, tagged output is not arriving at all.

**Correction, 27 Aug ~22:00.** This file previously said "despite `--stormfront`
declaring the `streams` capability", and prime repeated that to several
sessions. **It is not what happens.** `login_helpers.rb:578`
`resolve_headless_frontend` only special-cases `--saga` and `--genie`; our
launch falls through to the `'profanity'` default, so `Frontend.client` is
`profanity` on every session this app starts. Filed as **#31**.

`profanity` also carries `:streams`, so this is not by itself the explanation —
worth stating plainly, because it looks like a smoking gun and is not. What is
actually lost is `:room_window` and `:mono`.

The current best hypothesis for the channel gap is `games.rb:1065-1078` plus
`gameloader.rb:68-77`: Lich patches a malformed `settingsInfo` for characters
that have never logged in with a Wrayth client, and seeds a client record so
the server sends a proper one *on future connects*. **Test next live session:**
grep Lich's log for `Invalid settingsInfo XML tags detected`. If present, the
meaningful test is a **second** connection — retrying on the same one proves
nothing.

**3. Console reports problems.** Unread; nobody has looked.

**4. Experience skills read 0.** May be correct — Phemius is a Bard and trains
Performance. Verify against the game before "fixing" it.

## Do not redo

- **Python scripting API** — `python/dr_companion.py`, `docs/PYTHON_API.md`.
  Out-of-process, token-authed. `python/_play.py` drives the game with it.
- **Bridge staleness detection** — `bridge_install_status`, wired into the
  setup screen's bridge row.
- **Vendored Ruby4Lich5** — `tools/vendor-fetch.mjs`, gitignored, re-verified
  at runtime.
- **Fixture port** — `tools/fake-lich.mjs` defaults to **11124**, not 11024.
  Passing `--port 11024` makes it squat the real Lich port, which cost real
  debugging time once already. Kill any fixture the moment you are done.

## Working agreements that earned their place here

- **Stage by path.** `git add -A` has swept another session's work more than
  once in this repo. Check `git status --short` before every commit.
- **Verify before writing to a shared install target.** `C:\Ruby4Lich5\Lich5\scripts`
  is outside any git tree and two sessions have collided on it. Re-check
  immediately before the write, not from a reading taken minutes earlier.
- **A zero is a claim about your instrument first.** Shell escaping through the
  Bash tool mangles `\r`; `grep -c $'\r'` silently counts the letter `r`. Count
  bytes in Node or Python with a positive control.
