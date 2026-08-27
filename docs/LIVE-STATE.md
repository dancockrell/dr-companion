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

## Known broken on live

Checked against the running client, not inferred. Fix or claim these by telling
prime first.

**1. Lich has no map database.** The room panel is dead and the game pane
floods with `--- Lich: error: no map database found`.

```bash
ls /c/Ruby4Lich5/Lich5/data/DR/map-*.json 2>/dev/null || echo "MISSING"
```

Lich searches `DATA_DIR/<game>/map-<digits>.json` (`lib/common/map/map_base.rb`,
`json_map_files`). `scripts/download-prime-map.lic` is the official downloader;
invoking it as `;download-prime-map` did not produce a file, and the reason is
not yet established.

**2. Channel tabs stay empty on live** despite `--stormfront` declaring the
`streams` capability. `isTaggedStream()` in `gameLink.ts` is the discriminator
— if that is false, tagged output is not arriving at all.

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
