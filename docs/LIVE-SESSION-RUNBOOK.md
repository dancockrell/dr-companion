# Live-session runbook

Dan's logins are the scarcest resource this project has — one so far tonight,
a few minutes, mostly in mock mode. `docs/LIVE-STATE.md`'s "For whoever gets
the next live session" is a list of four open questions. A list is not a
runbook: whoever is present when the next login happens should not have to
decide an order, remember what each answer needs, or work out what a blank
result means. This is that decision, made in advance.

**Whoever is with Dan when he next connects: follow this top to bottom.**
Every step names exactly what to run and exactly what to paste back. If a
step's answer is "nothing happened," read that step's "if empty" line before
concluding the question is still open — for one of these, nothing happening
is the answer.

Total connected time needed: well under the length of tonight's one login.
Steps 1-5 need only the game connection already established. Step 6 needs a
second, fresh connection — see why below.

---

## Before anything: confirm it's actually live

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='rubyw.exe'\" | Select-Object ProcessId,CommandLine | Format-List"
```

Record: the full command line (confirms `--login Phemius`, or whoever). Then:

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess <pid> -State Established | Where-Object { \$_.RemoteAddress -notlike '127.*' }"
```

**If empty:** Lich started but never reached Simutronics. Nothing below can
be answered — stop here and say so rather than running steps against a
process that only looks connected. Do not restart it without asking Dan;
see `LIVE-STATE.md`'s note on why.

---

## Step 1 — grep the log for the settingsInfo marker (do this FIRST, before anything else touches the connection)

This has to happen before any other step because it establishes the
*baseline* — whether this character's very first connection tonight already
carries the marker. Everything downstream about step 6 depends on this
baseline existing.

```bash
grep -n "Invalid settingsInfo XML tags detected" /c/Ruby4Lich5/Lich5/logs/*.log
```

(Adjust the log path/glob to whatever Lich is actually writing to tonight —
confirm with `ls -la /c/Ruby4Lich5/Lich5/logs/ | tail -5` if unsure which
file is current.)

**Record:** present or absent, and if present, the exact line and timestamp.

**If present:** this is the baseline. The marker means this character has
never completed a Wrayth handshake, and Lich is patching a malformed
`settingsInfo` and seeding a client record so the *next* connection gets a
real one. **Go to Step 6 later in this same session** — do not skip it and
do not substitute retrying step 1 again on this same connection; that proves
nothing about the hypothesis (`games.rb:1065-1078`, `gameloader.rb:68-77`).

**If absent:** either the marker already cleared on a prior connection (in
which case Step 6 is not needed — the hypothesis predicts channel tabs
should already work; check that against Step 5's observation) or the
hypothesis is wrong for this character. Either way, still worth one line
back to Prime: "no marker on connect N" is real information, not a null
result.

---

## Step 2 — kick off `install_mapdb` through the bridge (fire early, it runs in the background)

This is a large network fetch that Lich runs asynchronously and returns from
immediately — see `LIVE-STATE.md`'s "Known broken on live" #1. Firing it now
means the download has time to finish while you run the other steps, instead
of sitting and waiting on it alone at the end.

From inside the running app (`node tools/app-eyes.mjs eval "..."`, same
pattern as `LIVE-STATE.md`'s bridge probe):

```js
(async () => {
  const token = await window.__TAURI_INTERNALS__.invoke('read_bridge_token');
  const ws = new WebSocket('ws://127.0.0.1:7415/companion');
  const out = [];
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = (m) => out.push(String(m.data).slice(0, 200));
  ws.onopen = () => setTimeout(() => ws.send(JSON.stringify({ type: 'intent', intent: 'install_mapdb' })), 500);
  return new Promise(r => setTimeout(() => r(JSON.stringify(out, null, 1)), 3000));
})()
```

**Record:** the `intent_ack` reply (ok/detail) and any `log` lines mentioning
the map download. Then, near the end of the session (after Step 5), check:

```bash
ls /c/Ruby4Lich5/Lich5/data/DR/map-*.json
```

**If still missing after several minutes:** the intent fired but the
download didn't land. Capture whatever Lich's own log printed for it in the
meantime — the open question was never "does `install_mapdb` exist," it's
"what happens when it runs," so any output at all (error, timeout, partial
file) is the answer, even a failing one.

---

## Step 3 — capture `PLAY USAGE` (only needs 30 seconds, do it whenever convenient in the game window)

Type directly in the game (Phemius is a Bard, so this works for the
character already logged in):

```
PLAY USAGE
```

**Record:** the full raw output, verbatim, pasted back exactly as printed —
not summarized, not retyped from memory. `src/data/performance.ts` was built
from Elanthipedia (32 songs, 18 moods, cited there), and this is the first
chance to check that against the game itself rather than a wiki. If it
differs even slightly (an added song, a renamed mood, a different easy/hard
framing), that's a real finding, not noise — say so plainly rather than
quietly reconciling it.

**If it doesn't match:** update `data/performance.ts` from the live output,
not the wiki, and say in the commit that it was corrected against a live
`PLAY USAGE` capture with the date.

---

## Step 4 — check the experience-skills race (needs ~15 seconds of wait built in)

`DRInfomon` runs `exp all 0` automatically on login, in a background thread,
before it marks itself `startup_complete?` (`lib/dragonrealms/drinfomon/
startup.rb`). If the bridge's status tick fires before that thread finishes,
`DRSkill.list` is empty and stays looking empty at least once — expected, not
necessarily a bug, but only if it recovers.

Right after confirming the connection (top of this runbook), probe the
bridge immediately:

```js
(async () => {
  const token = await window.__TAURI_INTERNALS__.invoke('read_bridge_token');
  const ws = new WebSocket('ws://127.0.0.1:7415/companion');
  let skillsNow = null;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'status') skillsNow = (msg.payload.skills || []).length;
  };
  return new Promise(r => setTimeout(() => r(JSON.stringify({ skillsAtConnect: skillsNow })), 2000));
})()
```

**Record** that number. Then wait 15-20 seconds (do Step 3 in the meantime —
it overlaps for free) and probe again with the same snippet.

**Record** the second number.

**If it went from 0 (or low) to populated:** the race is real and confirmed
— `DRInfomon.startup_complete?` was still false at the first probe. Worth
noting whether the bridge should wait for that flag before its first status
push, rather than a fixed delay.

**If it's still 0 after 20+ seconds:** check the game pane / Lich's log for
whether `exp all 0` was ever sent at all (it prints a normal EXP report if it
ran). If it never ran, `DRInfomon.watch!`'s trigger condition
(`GameBase::Game.autostarted? && XMLData.name`) may not be met for this
launch path — a different and more useful finding than "the race is real."
If it *did* run and skills are still empty, the bug is in the bridge reading
`DRSkill.list`, not in DRInfomon's timing — check `companion_bridge.lic:351`
next.

**If it was already nonzero at the very first probe:** no race observed this
time; say so rather than leaving the question looking unanswered. A skilled
character (higher circle, more session time before this login) may simply
clear the window DRInfomon needs before the app's first probe ever lands.

---

## Step 5 — read whatever the console already logged

`LIVE-STATE.md`'s "Known broken on live" #3 is just "unread; nobody has
looked." Open the app's Console panel, screenshot or copy anything at
`warn`/`error` level.

**Record:** paste the lines. **If empty:** say "console clean, nothing to
report" — that's a real, useful negative, not a skipped step.

---

## Step 6 — the reconnect (only if Step 1 found the marker)

This is the one step that needs you to deliberately end the game connection
and start a fresh one for the *same character* — not a different login, and
not a Lich restart done for some other reason repurposed as this test. If
Step 1 was negative, skip this step entirely; forcing a reconnect just to
run it anyway spends connected time on a question that already has its
answer.

1. Disconnect Phemius from the game normally (log out through the client, or
   however Dan normally ends a session) — do **not** kill Lich's process
   first; let the game-side logout happen so the server sees a clean
   disconnect.
2. Reconnect the same character through the app's normal launch path (same
   command line as the "Before anything" check at the top of this document).
3. Re-run Step 1's exact grep against the **new** log output (or the same
   file if Lich appends — check the timestamp on the line, not just presence
   of the string, since an old match would otherwise look like a live one).

**Record:** present or absent on this second connection, with the new
timestamp.

**If absent this time:** the hypothesis holds — Lich's seeded client record
took effect and the server sent a proper `settingsInfo` on this connect.
Next: check whether channel tabs populate now (`isTaggedStream()` in
`gameLink.ts`) — that's the actual payoff, not just clearing the log line.

**If still present:** the hypothesis is wrong, or the seed didn't take for
some other reason — worth a note to Prime either way, since it rules out the
current best theory for the channel-tab gap (#31 territory) rather than
leaving it as the untested leading guess.

---

## After the session: where the answers go

Whoever ran this pastes the raw output for each step back to Prime
(`downloads-e7`) or directly transcribes it into `docs/LIVE-STATE.md`,
replacing the "For whoever gets the next live session" list with what was
actually found — including a step that came back empty, with what that
emptiness means per that step's "if empty"/"if absent" line above. An
answered question left sitting in a chat transcript is lost the same way an
unrecorded command result always is; it belongs in the file every session
reads first.
