# DR Companion — Lich Bridge Contract

**Version:** 0.1
**Status:** Design + mock implemented; live Ruby side not yet shipped

## Why a bridge exists

This app is the game window. Lich is the automation engine (TCP proxy + Ruby
scripts), started by this app after it performs the account login itself - see
`docs/LICH_NATIVE_LOGIN.md`. There is no third program in the path.

**The Companion does parse the game stream**, and has since `src/lib/gameStream.ts`
shipped: it attaches to Lich's detachable-client port and reads the
Lich-processed XML directly. The line that stood here said the opposite and had
been false for months. What the bridge is for is the part Lich knows and the
stream does not: map nodes, script control, and intents.

A small **Lich script** exposes a **localhost-only** WebSocket so the Companion can:

1. Receive live character / location / situation / inventory status
2. Send high-level **intents** (`go_healer`, `town_run`, `stop_all`, …)
3. Remain policy-safe (attended use; Stop always available)

## Endpoint

| Item | Value |
|------|--------|
| Default URL | `ws://127.0.0.1:7415/companion` |
| Binding | Localhost only |
| Protocol version | `1` (sent in `hello`) |

## Server → Client messages

```ts
{ type: 'hello', protocol: 1, lichVersion: string, bridgeVersion: string }
{ type: 'status', payload: CharacterStatus }
{ type: 'inventory', payload: InventorySummary }
{ type: 'scripts', payload: { name: string, status: string }[] }
{ type: 'log', line: string, level?: 'info' | 'warn' | 'error' }
{ type: 'intent_ack', intent: string, ok: boolean, detail?: string }
{ type: 'error', message: string }

// Map replies (bridge 0.4.0+). map_here/map_path/map_nearest/map_zone are
// read-only. 'map_walk' (bridge 0.10.5+) is the one exception: it starts go2
// walking toward the room and answers over the ordinary intent_ack/log
// channel, not a payload of its own - go2's own progress prints through the
// normal game stream, the same as if the player had typed ;go2 <room>
// themselves.
{ type: 'map_here',    payload: MapRoom & { available: boolean } }
{ type: 'map_path',    payload: { ok, from?, to?, steps?, rooms?, reason? } }
// 'map_nearest' (bridge 0.10.6+): the closest room(s) carrying a tag -
// "nearest bank", "nearest 3 healers" - computed fresh each call, unlike a
// saved pin. args: { tag: string, count?: number }.
{ type: 'map_nearest', payload: { ok, tag?, from?, rooms?: (MapRoom & {steps?})[], reason? } }
```

### Rooms carry two ids, and both matter

```ts
MapRoom = { id, uid, title, location, climate?, terrain?, tags?, exits? }
```

`id` is **Lich's** room number — the one `#goto` takes, and what every Lich
script means by "room". `uid` is the **game's** own room id, the number a
player sees with `FLAGS ShowRoomID ON`.

They are different numbers for the same room. Quoting one when you mean the
other is a documented way to lose an afternoon in a help channel, so the bridge
sends both, always labelled, and never collapses them into one "room number".

Geography comes from Lich, not from anything this project ships. Lich holds the
room graph, the pathing, the tag index and the uid translation; it is already
loaded and already matches the player's own map database. A list frozen into
one of our releases would be a second, worse, staler answer.

`CharacterStatus` includes:

- `name`, `instance` (`Prime` | `Platinum` | `Fallen` | …)
- `location` (title, zone, province, isTown, isSafe, roomId optional)
- `vitals` (health, spirit, fatigue, …)
- `situation` flags (`in_combat`, `low_health`, `stunned`, `bags_full`, …)
- `activity` (human-readable current activity string)
- `connected`

## Client → Server messages

```ts
{ type: 'ping' }
{ type: 'subscribe', channels: ['status', 'inventory', 'scripts', 'log'] }
{ type: 'get_status' }
{ type: 'get_inventory' }
{ type: 'intent', intent: IntentName, args?: object }
```

### Supported intents (v0.1)

**Corrected 10 Sep 2026 (R0).** This table used to list `go_healer`,
`town_run`, `start_training`, `loot` and `buffs` as "Supported" alongside
intents that are actually in `HANDLERS`. They never were: none of the five
has a dispatch entry in `companion_bridge.lic`, `HANDLERS.keys` does not
include them, and `MOCK_UNIMPLEMENTED_INTENTS` in `src/bridge/mockBridge.ts`
lists all five as unimplemented — a stale claim sitting next to the exact
mechanism (`isIntentImplemented`) built to prevent it. Split below into what
`HANDLERS` genuinely dispatches today and what is only planned. The nine
planned ones — the client's activity buttons — get their own contract,
[Activity intents (Lane R)](#activity-intents-lane-r), below.

**Actually implemented** (present in `HANDLERS`, `lich-scripts/companion_bridge.lic`):

| Intent | Meaning |
|--------|---------|
| `stop_all` | Emergency / full stop of Companion-driven scripts |
| `pause` / `resume` | Pause automation — **latching**, see below |
| `escape` | Emergency exit to safety (`flee`) |
| `stow_all` | Stow loose items per rules |
| `run_macro` | Send a sequence of literal game commands |
| `armor_manage`, `check_health`, `check_teaching`, `listen_to`, `stop_listening` | see their own sections below |
| `trace_on` / `trace_off` / `trace_dump`, `reset_runaway` | diagnostics |
| `read_settings`, `check_toggles`, `list_vars` | read the character's dr-scripts settings |
| `map_here`, `map_path`, `map_walk`, `map_nearest`, `map_zone`, `install_mapdb` | map queries; `map_walk` is the one that moves the character |
| `list_scripts`, `start_script` | launch any installed script by name |

**Planned, not yet implemented** — the nine activity intents from
[GAP-2026-09-09.md](GAP-2026-09-09.md), tracked as Lane R (`docs/PLAN_TO_1_0.md`
§6b): `go_healer`, `town_run`, `start_training`, `loot`, `buffs`, `travel`,
`escape_heal`, `start_combat`, `burgle`. `isIntentImplemented` in
`src/store/bridgePolicy.ts` disables their controls honestly today. See
[Activity intents (Lane R)](#activity-intents-lane-r) for the contract each
one implements against, and the existing per-intent research below
("Activity intents batch contract") for which dr-scripts script each starts.

### Pause is latched, not only a snapshot (bridge 0.13.0)

`pause` used to mean one thing: pause every script in `Script.running` **at the
moment the intent arrives**. That is the right thing to do to a route already
under way, and it says nothing at all about one started afterwards. `map_walk`
starts Lich's `go2` as its own script, so pressing Pause and then clicking a
distant tile put an autonomous traveller on the road after the snapshot was
taken — and travel never enters the client's own command lane either, because
it is a bridge intent rather than a game command. Issue #462.

So `pause` now also **latches** (`Intents.@pause_requested`), exactly as
`stop_all` does, and `resume` is the only thing that clears it. While it is up:

| Intent | While paused |
|---|---|
| `map_walk` | refused: *Paused - press Resume before travelling.* |
| `run_macro` | refused: *Paused - press Resume before running a macro.* |
| `start_script` | refused: *Paused - press Resume before starting a script.* |
| anything read-only | unaffected |
| `install_mapdb` | unaffected — it starts a download, not a walker |

A route already walking is **suspended, not cancelled**: `Script.pause` sets the
script's `@paused`, Lich blocks the script inside `Script.current`
(`lib/common/script.rb:1026`), and `resume` unpauses it so the character
finishes the route it was on. Cancelling is what `stop_all` is for, and it
reaches a paused script too (`Script.kill` matches by name regardless).

### Who owns Pause

**The bridge does, and the app mirrors it.** This is a correction: the app used
to be treated as the owner and the latch as a confirmation of the app's
decision, which is issue #487.

The bridge is the process that can actually hold a walker. `map_walk` starts
`go2` *inside Lich*, and a Lich script or a person at the `;` prompt can pause
and unpause it with the app never hearing — the app cannot stop them, so an app
that claims ownership is claiming a decision it cannot enforce. Two consequences
the contract now names:

- **On connect and on every `status`, the client adopts the latch.** If
  `pauseLatched` is `true` and the app is not paused, the app pauses itself
  (`src/lib/bridgePauseRelay.ts`). The bridge's latch is a module ivar in a
  process that outlives every app restart, so without this a relaunched app
  reads "Running" while the bridge refuses travel. Adoption is
  **one-directional**: a latch going `false` never auto-resumes the app, because
  that would release a whole command lane at a live character on the strength of
  somebody unpausing one script. The chip changes colour and the player presses
  Resume.
- **The bridge answers `pauseLatched` by reconciliation, not from a flag**
  (bridge 0.14.0). `pause_all` records which scripts it suspended, and
  `reconcile_pause!` lowers the latch when at least one of them is still running
  and none of the still-running ones is paused any more — which is exactly what
  `;unpause go2` produces. It deliberately does **not** lower the latch when a
  suspended script merely exited (holding what has not started yet is the
  latch's job), and never when the pause suspended nothing. Before this, a
  Lich-side unpause walked the character while the app showed its strongest
  reassurance.

**`status.pauseLatched`** reports the latch back — on `status` only, and not on
`hello`, because a client is sent a full `status` on the same socket immediately
after `hello`, so a copy on the greeting would be one question with two answers.
The client reads the field and its own pause flag as **four** states — every
cell of the two-by-two, because the two facts vary independently and folding one
cell into another is what #487 was:

| app asked | `pauseLatched` | reading |
| --- | --- | --- |
| no | absent / `false` | *Running* — nothing is held |
| yes | `true` | *Paused, bridge confirmed* |
| yes | absent / `false` | *Paused, bridge did not confirm* — either something unpaused it in Lich, or the bridge predates the latch (before 0.13.0). A tile click can still start a walk. |
| no | `true` | *Paused by Lich* — the bridge is holding travel, macros and script starts and this app did not ask for it. Resume lifts it. |

A field that is **absent** must never render as confirmed: that bridge has no
latch at all. Same shape as `auth`/`implementedIntents` on the `hello` frame,
and for the same reason.

`src/bridge/mockBridge.ts` can produce every cell on demand, because a state
the fixture cannot reach is a state nobody sees until a live bridge is the
first place it happens. Two ways in, and they are the same setter:

- **What Lich says about Pause**, a chooser in Settings under Bridge, shown
  only in mock mode.
- `?mock-pause=follow|latched|clear|absent`, read by `selectPauseLatchMode`
  in the same parser as `?bridge=`, for a harness with no hands.

Both reach `bridge.setPauseLatchMode`. Being *on the facade* is not being
reachable and this paragraph used to claim it was: the setter had no caller
anywhere for weeks, so two of the four cells stayed unreachable in
development while a regex over the file that declares it reported them
covered (issue #503).

To see all four rather than read about them:

```
npm run dev
npm run pause:cells -- http://127.0.0.1:1420/
```

That drives each cell through the chooser in a real browser, reads the footer
chip back, and writes `docs/verification/pause-cells-*.png`. Where this table
and that run disagree, the run is right and the table is stale.

`tools/pause-reaches-travel-test.mjs` derives the set of intents that
must be held from the bridge's own `HANDLERS` table, so a new intent that starts
a script or sends player-supplied commands fails the build unless it is in the
refusal set; `tools/pause-reaches-travel-break-check.mjs` breaks the latch three
ways and requires named checks to go red.

---

## Reconnect, and the state replay (implemented — issue #479)

Two transports reach Lich and they drop independently: the companion bridge on
7415 (this document's subject) and the `--detachable-client` game socket
`src-tauri/src/game_link.rs` holds. Both now reconnect on a **bounded**
exponential backoff, and both report **three** states rather than two.

### Three states, not two

| State | Means | What a player should do |
|---|---|---|
| connected | a socket is open | nothing |
| reconnecting *(N of M)* | a re-dial is under way | wait |
| gave up *(after N)* | the bound was spent, with the reason | go and look at Lich |

Folding the last two together is what this replaced. They are both "not
connected" and they ask opposite things, so one badge for both tells half its
readers the wrong thing — and an *unbounded* retry, which is what the bridge
did before, has no third state at all: a bridge that is gone and one mid-restart
produce the same permanent spinner, and a spinner that never resolves is one
people learn to ignore.

The counts are structured fields, not prose. The game link publishes
`reconnecting`, `attempt` and `maxAttempts` on `game:state`; the bridge answers
`getAttempt()` / `getMaxAttempts()` beside its status. Both are read through one
classifier each — `linkPhase` in `src/lib/gameLink.ts` and `storeBridgeStatus`
in `src/store/bridgeStatus.ts` — so `GameConnectionBar` and `SafetyFooter`
cannot reach different conclusions about the same state.

| | game socket | bridge (7415) |
|---|---|---|
| schedule | 0.5s doubling, capped at 8s | 1s doubling, capped at 30s |
| bound | 6 attempts | 8 attempts |
| dialler | `game_link::dial_with_retry`, one dial per attempt | `new WebSocket` |
| gives up early | Lich has exited (the dialler says so) | — |

The game link reuses `dial_with_retry` (#458/#475) with a zero wait rather than
growing a second dialler: that function already owns the single-dial semantics,
the "Lich exited" branch and the launch-file rules, and the *schedule* belongs
to the reconnect run. A dialler with its own internal wait would give the link
two stacked backoffs, neither of which the state it publishes would describe.

### The lane refuses while the link is down. It never queues into a dead socket

`game_send` calls `game_link::attached` **before** `gate.submit`. The lane's
queue outlives every attach and detach on purpose (`command_gate::start`), so
without that check a send during a drop would be accepted, sit in the queue
looking sent, and either fail silently much later or go out into a session that
has moved on. The refusal names which of three things is wrong:

- `Not attached to a game.` — never attached, or detached
- `The connection dropped and is reconnecting - attempt N of 6. Nothing can be
  sent until it is back.`
- `The connection is closed.` — down, and not coming back on its own

Stop and Pause are unchanged by any of this.

### What comes back on a reconnect, and what has to be fetched

**Lich replays part of the state on its own.** A reconnect is a fresh accept,
and every accept runs `detachable_client_send_init`
(`global_defs.rb:2357-2360`). This app is in the branch that receives it — the
gate is a raw ARGV match on the Genie and Saga frontend flags, and this app
passes neither.

**It is not enough, for two read reasons** (both cited in full in
`docs/LICH_NATIVE_LOGIN.md` §4):

- **It is about ten seconds late in DragonRealms.** The replay opens with
  `100.times { sleep 0.1; break if XMLData.indicator['IconJOINED'] }`
  (`global_defs.rb:2307`), and `IconJOINED` is a GemStone indicator that DR
  never sets.
- **It carries vitals, spell, seven indicators and the compass, and nothing
  else.** No room title, no room description, no `component id='room objs'` or
  `'room players'`, no prompt, no roundtime, no script list. The hands / wounds
  / stance / mindstate block is gated behind `XMLData.game =~ /GS/`.

**And it cannot be requested.** The detachable read loop understands
`SET_FRONTEND_PID <n>` and an exit command and treats every other line as
player input (`global_defs.rb:2363-2379`), and
`detachable_client_send_init` has one caller, the accept. There is no verb to
send, and sending something hoping for one would put a stray command into the
game.

So the app does two things on the reconnect edge (`game:reconnected`, an event
rather than a flag, because it must fire once per reconnect):

1. **Drops the tag parser's accumulated state** (`gameLink.ts`). `vitals.ts`
   and `situation.ts` both prefer the stream's answer over the bridge's
   whenever the stream has one, so without this a character's health from
   before the drop keeps being reported as current until the game happens to
   resend every tag.
2. **Asks the bridge for a fresh `status`** (`src/lib/linkReplay.ts`, installed
   once per window from `main.tsx`, same as `bridgePauseRelay.ts`). That
   payload carries the room, occupants, scripts, roundtime and activity that
   Lich's replay does not. This is the synthesis of the half Lich will not
   give back.

The bridge's own reconnect needs no equivalent: `onopen` re-sends `auth`,
`subscribe` and `get_status` on every open, which is already a full replay of
everything the bridge holds. That is asserted rather than assumed —
`tools/link-reconnect-test.mjs` checks the three frames and their order, and
`tools/link-reconnect-break-check.mjs` removes the `get_status` and requires
that check to go red.

### The gap is marked, not hidden (issue #506)

Those two steps leave a window, and it is about ten seconds wide. The tag
parser's state has been dropped on purpose, so `vitals.ts` falls back to the
bridge's copy for every pool the stream has not re-reported yet — and if the
bridge dropped too, that copy is a reading from before the drop. The bridge and
the game link drop independently; a reconnect of one says nothing about the
other.

So the store keeps a single field, `bridgeStaleSince` (`src/store/staleMark.ts`
decides it, `src/store/bridgeLifecycle.ts` is the only place it is set):

- An **unexpected** drop — `reconnecting`, `gave-up`, `error`, or any status
  that is not feeding — marks `character`, its vitals, `scriptStates` and
  `runningScripts` with the moment the feed stopped. It does **not** clear
  them: the last reading is the best answer available while the socket is down,
  and a blank cluster during a reconnect is strictly less than the truth. The
  panels render the marked values dimmed, with their age.
- A **deliberate** disconnect or mode switch still clears the data outright,
  and clears the mark with it. A detach ends the session, so there is no "last
  known" left to qualify.
- The mark survives the socket coming back and ends when a **payload lands**.
  Those are two different moments, and that is the whole point of the field:
  clearing on `connected` would put full contrast back over pre-drop numbers
  for the entire replay delay above.
- The age never restarts. Six reconnect attempts must not redraw a
  forty-second-old reading as four seconds old.

**The mock bridge cannot produce this state** — `onLiveStatus` is the real
transport's event and the mock has no socket to lose — so the store exposes
`simulateBridgeStatus`, which calls the same `applyLiveStatus` the live
subscription calls. Same rule as the implemented-intents section below: a state
the fixture cannot reach is a state nobody sees until a live bridge is the
first place it happens.

### One reader of the link state (issue #501)

Every component that renders or gates on the game link reads `linkPhase`
(`src/lib/gameLink.ts`). None of them tests `connected` inline. That is not a
convention, it is checked: `tools/link-reconnect-test.mjs` walks the component
tree, takes the files that subscribe to the link as its denominator, and fails
if any of them branches on the boolean.

The rule exists because `GameCommandBar` was not part of the change that
introduced `linkPhase`, and for months it read *Not attached* while the two
bars either side of it read *Reconnecting 3/6* about the same socket. Every
test passed throughout: each file was correct about itself.

The command bar's refusals follow from the same reading. It holds a typed
command only while the phase is `reconnecting` — the text stays in the box, the
state is said out loud, and the player presses Enter again once they can see
where they are; it is never queued and never sent on their behalf, because a
command typed against the room they last saw before the drop is dangerous.
Every other refusal is left to the lane, so `closed_reason()`'s sentences reach
the box they were written for.

### One reader of the bridge state, and no ladder before there is a Lich (issue #532)

The bridge's half of the same two rules, and it was wrong in both until
9 September 2026.

**The reading.** Every component that renders bridge state reads `bridgePhase`
(`src/lib/bridgePhase.ts`), which answers one of `connected`,
`not-connected`, `connecting`, `reconnecting` or `gave-up`. None of them
compares `bridgeStatus` to a literal. Checked the same way the link census is,
over the same walk, and with a second matcher: importing the phase is not
enough, because the footer *did* import it and still kept its own comparison
beside it.

The bit that makes the reading possible is `bridgeEverConnected`, carried from
the transport. It cannot be derived from the status — `disconnected` is what a
fresh app, a failed first probe and a deliberate detach all look like, and
`connecting` is the first dial of a session as well as a re-dial in the middle
of a run.

**The ladder.** `RealBridge.connect()` takes a `ConnectIntent`:

- `probe` — one attempt, no retries. This is what the app makes on startup, and
  its job is to find a Lich that is *already* running. Failing is the ordinary
  case, and it lands on `disconnected` with a reason naming the port and the
  action.
- `expect-lich` — the bounded eight-attempt ladder. Made only when a Lich is
  known to exist, which the app learns from `src/lib/lichStarted.ts`:
  `launchCharacter` publishes on it, `LichLauncher` publishes on it, and
  `App` subscribes and reconnects.

That channel is not decoration. Before it, nothing in the app told the bridge a
Lich had started; sign-in connected only because one of eight blind re-dials
happened to land after Lich bound its port. Removing the blind ladder without
adding the channel would have made sign-in connect nothing at all.

**What was on screen.** Measured in the running app before the fix: an amber
chip reading exactly `Bridge reconnecting`, with no attempt number,
indefinitely, over a screen whose own largest sentence is *Sign in below and
the app starts Lich for you*. No number is the tell — the ladder only publishes
`reconnecting` after incrementing past zero, so the amber came from the
`connecting` arm the footer had folded in with it.

A second, independent cause was measured at the same time and is fixed in
`vite.config.ts`: a session recorder appending to a `.log` and a `.jsonl`
inside the Vite-watched project root made the dev server issue a full page
reload every 2 to 6 seconds (`Page.frameNavigated`, `reason=reload`, same URL).
A reload restarts the mount effect, so the run went back to attempt zero
forever and could never reach its own bound — the ladder was honest about being
bounded and was simply never allowed to finish. Logs and capture files in the
root are ignored by the watcher now.

### Checks

- `cargo test --lib game_link` — the schedule (read, not timed), the bound and
  the give-up message, the fatal "Lich exited" arm, a detach mid-backoff being
  cancellation rather than failure, the lane's three refusals, and the three
  states being mutually exclusive. Positive control: a stand-in that never
  drops connects on attempt 1 and spends no schedule.
- `npm run test:link-reconnect` — the four `linkPhase` states, an older Rust
  binary's field-less state degrading rather than lying, the reconnect edge,
  the bridge's bound and its rising attempt count, a deliberate retry getting a
  fresh budget, and the transport→store mapping being total. Also the two
  sections above: the consumer census, and the stale mark on a fake clock,
  through `applyLiveStatus` rather than a restatement of its rule.
- `npm run test:link-reconnect-break` — a sabotage per branch, across all four
  subject files, each asserting the **exact** set of checks that reddens.
  Restored and verified by sha256. (No count in this line on purpose: a number
  in prose here goes stale the next time a case is added, and a stale number
  teaches the reader the page is out of date.)
- `node tools/reconnect-honesty-shots.mjs <dev-server-url>` — the same two
  fixes asked of a rendered document in a real browser, because every check
  above would pass with the functions correct and nothing on screen changed.
- `npm run bridge-states:shots -- <dev-server-url>` — the four bridge states
  photographed and read off the window: the phase attribute, the words, and the
  computed colour. Its denominator is that the four are four *distinct*
  readings, because a chip stuck on one string satisfies "it does not say
  reconnecting" in three of the four cases.
  Not in the gate: it needs a dev server. See
  `docs/verification/reconnect-2026-09-07.md`.

---

## The outbound command lane (implemented)

Everything above is the *bridge* — the companion-era plugin socket. This
section is the other direction and the other transport: what happens to a
command this client sends to the game, on the `--detachable-client` socket
`game_link.rs` holds.

`src-tauri/src/command_gate.rs` is one lane that every outbound command
enters. `game_link::game_send` is its only entry point and
`game_link::write_command` — crate-private, called from the lane's sender
thread and nowhere else — is the only thing that writes to the socket. Before
it, eight unrelated callers wrote to that socket directly and nothing
arbitrated between them.

### Every command carries a source

`player`, `ui-action`, `keybind`, `macro`, `ai-suggestion`, `script`, in that
priority order. Ties break by submission order.

There is **no default**. Rust refuses an unknown source, because defaulting to
`player` would let unlabelled automation jump the queue and defaulting to
`script` would put a real player behind a walk loop — either guess breaks one
of the two invariants. `tools/command-lane-test.mjs` checks that every caller
in `src/` names one, and prints the list with its count.

| Source | Who | Held by Pause | Flushed by Stop |
|---|---|---|---|
| `player` | the command bar | no | no |
| `ui-action` | a room, inventory, combat or exit button; a tile-click walk | yes | yes |
| `keybind` | a key the player bound | yes | yes |
| `macro` | the quick-queue panel | yes | yes |
| `ai-suggestion` | a model proposal, already confirmed through G11's gate | yes | yes |
| `script` | anything on the script API socket | yes | yes |

**A player-typed command is never dropped and never waits behind automation.**
It jumps the queue, Pause does not hold it, Stop does not flush it, and the
queue ceiling sheds the oldest automation entry rather than ever shedding it.

### Roundtime

DragonRealms answers a command sent during roundtime with `...wait N seconds`
and discards it. The lane holds commands until the roundtime ends plus
`RT_MARGIN_MS` (200 ms — the margin `python/drtask.py` uses, because the
reported roundtime is an absolute second and a fast clock otherwise sends a
moment early).

Read in the reader thread of `game_link.rs`, which sees every chunk before the
parser does:

- `<roundTime value='<epoch>'/>` and `<castTime value='<epoch>'/>` — the
  authoritative form. The value is an **absolute epoch second**, not a
  duration; checked against Lich's `xmlparser.rb` by `python/drtask.py`. The
  longer of the two wins when both are present.
- `Roundtime: N sec.` and `...wait N seconds.` — text, a duration from now.
  What appears when the frontend has not claimed the `xml` capability, or when
  the game refuses a command outright.

A roundtime only ever moves the hold forward; a late-arriving older value
cannot shorten one already running.

### Typeahead

`TYPEAHEAD_DEPTH` (1) commands may be released *into* an active roundtime,
because DragonRealms accepts that much and every other client spends it.
The allowance resets when a new roundtime is reported, since a new roundtime
is the game acknowledging the command that caused it.

### Coalescing

A held movement key produces forty `north`s. When a movement command is
submitted and an identical movement command **from the same source** is
already queued and not yet sent, the new one is dropped and counted.

Movement is the twelve compass directions plus `in` and `out`, as a fixed set:
`go` and `climb` take an argument and two `climb wall`s in a row are sometimes
meant. Same source only — a script's `north` must never swallow the player's.
Nothing else coalesces: two identical `appraise sword`s are two things
somebody meant.

### Stop and Pause

Stop (`game_lane_flush`, wired through `flowStop.ts`'s signal from
`src/lib/commandLane.ts`) drops every queued automation entry and leaves the
player's. It already killed both task processes and rejected unconfirmed
suggestions; what it could not reach was commands those producers had already
handed over.

Pause holds automation only, exactly as it did before, and a command held past
`MAX_PAUSE_HOLD_MS` (300 s) is refused **and says so** rather than vanishing.
The flag now lives in the lane, because the lane is what has to consult it on
every pick; `pause.rs` is the two commands that set and read it.

### What the lane deliberately does not do

It does not rewrite commands. Aliases, macros and Lich's semicolon syntax are
the frontend's business; the lane decides *when* and *in what order*, never
*what*.

It does not sit in front of the AI confirmation gate. G11's guards run first
and are untouched: `aiSuggestions.ts` still has exactly one call to
`requestGameAction`, asserted by both `tools/ai-suggestions-test.mjs` and
`tools/command-lane-test.mjs`.

### Reporting

`game:lane` carries `{queued, holdingUntilMs, lastSent, lastSentAtMs, sent,
coalesced, flushed, overflowed, paused}`, and `game_lane_status` answers the
same on demand for a window that opened after a queue formed. `SafetyFooter`
shows the queued count beside the roundtime badge: `RT 3s` says "you cannot
act yet", and `2 queued` says "and two of your commands are waiting on that",
which is the fact a player wants when a key press appears to have done
nothing.

### Checks

| Command | What it establishes |
|---|---|
| `cargo test --lib command_gate` | 15 property tests against a pure scheduler with an explicit clock and a write log |
| `npm run test:command-lane` | every caller in `src/` names a source, N of N, with the list printed |
| `npm run test:command-lane-break` | six sabotages, each reddening exactly the tests it should; the file restored and verified by hash |


## Capability-aware rule (mandatory)

For `go_healer`, `town_run`, travel, and hunting selection, Lich-side logic **must** evaluate:

1. Character needs (wounds, bleeding, dead/dying)
2. Character capabilities (skills, spells, circle, transport, wealth, access)
3. Instance differences
4. Path safety vs combat ability
5. Prefer safe / free / high-quality options; explain when none exist

Never implement “closest healer by room distance only” as the final decision.

## Launch context (research notes)

- Lich 5 acts as a proxy between a frontend and the game server.
- This app's launch pattern is a `.sal` launch file plus a detachable port:
  `ruby lich.rbw <launch file> --headless=11024 --start-scripts=companion_bridge`
  which `arg_normalization.rb:52-53` expands to
  `--without-frontend --detachable-client=11024`. No frontend flag is passed and
  none is wanted; `src-tauri/src/lich.rs`'s `launch_args` has a test asserting
  the absence.
- There is **no** built-in public WebSocket API for external UIs; the Companion bridge script provides that surface.
- Lich 5.20.x's multi-client detach support is what this app attaches through,
  and it is no longer "useful later": `src-tauri/src/game_link.rs` dials that
  port today.

## Security

- Bind to `127.0.0.1` only
- No authentication required for local v0.1 (single-user machine assumption)
- Future: optional token file if multi-user or remote is ever considered (not planned)

## The Lich API this reads

An earlier draft of this document said to push status from "Infomon". That is
GemStone. DragonRealms exposes a different set, and the bridge uses these:

| Source | Provides |
|---|---|
| `DRStats` | health, spirit, fatigue, concentration, mana, guild, race, circle, **favors**, encumbrance |
| `DRSkill` | `getrank(skill)`, **`getxp(skill)` for the 0-34 mindstate**, `list`, `getskillset` |
| `DRRoom` | title, description, npcs, pcs, group_members, room_objs, exits |
| `DRSpells` | active spells |
| `XMLData` | raw parsed state, indicators, roundtime |
| `Room`, `Map` | room id, location, the map graph for travel |
| `GameObj`, `EquipmentManager` | inventory and containers |
| `DRC`, `DRCI`, `DRCM`, `DRCT`, `DRCC` | commons helpers (general, inventory, money, travel, crafting) |

`DRSkill.getxp` is the one that matters most. Mindstate is what makes "what
should I train" answerable, and no other field substitutes for it.

Note that `check_health` in `common-healing.rb` works by *sending* the HEALTH
command and parsing the reply, so wound detail is a poll rather than a passive
read. Do not put it on the status tick.

## Implementation order

1. ✅ TypeScript contract + mock bridge (this repo)
2. ✅ Lich Ruby script: WebSocket server + status push from DRStats / DRSkill / DRRoom
3. ✅ Intent handlers for `stop_all`, `pause`, `resume`; everything else refused explicitly
4. ⬜ Travel, healer and training intents that actually drive the game
5. ⬜ Real `go_healer` capability scoring, with a preferred-heal-city override
6. ⬜ Tauri side: spawn/monitor Lich, detect ports, reconnect

## Account tier (required on status)

`CharacterStatus.accountTier` must be present on every status payload:

`'f2p' | 'basic' | 'premium' | 'platinum' | 'fallen' | 'unknown'`

### Intent gating examples

| Intent | F2P behavior |
|--------|----------------|
| Travel outside Zoluren | Reject with clear reason |
| Vault deposit | Reject / skip (no vault) |
| Town run | Skip vault step; respect bank 10p cap |
| Loot | Prefer selective loot; inventory pressure is tighter |
| Fang Cove / premium hunt | Never offer |
| Healer | NPC healers in Zoluren only; no premium-only facilities |

Detection may come from Lich/Infomon or a user setting; until known, use `unknown` and act conservatively.

## The Fallen

`instance: 'Fallen'` and `accountTier` are independent fields.

- A Platinum account on The Fallen → `instance: 'Fallen'`, `accountTier: 'platinum'`
- A Fallen-only subscription → `instance: 'Fallen'`, `accountTier: 'fallen'`
- Maps, healers, and routes must be instance-scoped; vault/home/private-area features follow accountTier
- Never run Prime navigation data against a Fallen session

## Room contents (bridge 0.5.0)

Added to the status payload:

| Field | Source | Notes |
|---|---|---|
| `roomCreatures` | `DRRoom.npcs` | Living creatures, display names |
| `roomDeadCreatures` | `DRRoom.dead_npcs` | Corpses, kept rather than dropped |

Both are arrays of strings, exactly as the game wrote them. The **noun** used
for art and bestiary lookup is derived client-side rather than sent, because
`DRRoom` gives strings while `GameObj` gives objects and the two can disagree
partway through an update.

There is **no `roomAllies`**, deliberately. Lich has no concept of a creature
fighting on your side. `DRRoom.npcs` is everything the game marked bold,
`GameObj.type` classifies items rather than allegiance, and `fam_npcs` is the
familiar looking at another room. Guessing would put a summon and something
trying to kill you in the same bucket, which is precisely what the three card
decks exist to prevent.

## Injuries contract (spec — not yet implemented, issue #4)

Written by the panels/data session (`downloads-69`) for `companion_bridge.lic`'s
owner to implement, per Prime's ruling: one owner for this file, a contract
written down rather than described in chat. Do not treat this section as done
until the Ruby side actually sends the field — it is a spec, not a changelog.

**The gap today.** `DRCH.check_health` (`lib/dragonrealms/commons/common-healing.rb`)
already sends `HEALTH`, parses the reply, and returns a `HealthResult` with a
real per-part wound list. The bridge's `check_health` intent
(`companion_bridge.lic:1543`) calls it, but only ever turns the result into a
console log line and an ack string — the structured data is thrown away. The
client's `CharacterStatus.injuries` field has existed since before this spec,
the `Paperdoll` component already renders a correct three-state doll (unhurt /
hurt / **could not determine**, via its `known` prop), and both call sites
(`DashboardLayout.tsx`, `BattlePanel.tsx`) already pass
`known={character?.injuries !== undefined}`. **The honest-unknown state Prime
asked to ship first is already live** — that's why the doll reads as
permanently, correctly, dim: nothing has ever populated `injuries`. This spec
is the second half: making it populate with real data.

**Wire format.** Add `injuries` to the existing `status` payload rather than a
new message type — `CharacterStatus.injuries` already has the field and both
consumers already read `character.injuries`, so nothing on the client changes:

```ts
{ type: 'status', payload: CharacterStatus }  // .injuries now populated
```

`injuries` is `Partial<Record<BodyPart, { wound: 0|1|2|3, scar: 0|1|2|3 }>>` —
see `src/lib/body.ts`. Absent field or absent key both mean "not known", same
as today. Once populated, keep it in the bridge's held status state and
resend it on every status tick until the next successful `check_health`
overwrites it — do not blank it back to unknown between polls, and do not
silently invent zeros for parts `check_health` didn't mention this time
(a part not in `HealthResult#wounds` this poll is "still whatever it was last
poll," not "healed").

**Severity mapping, 13 → 4.** `DRCH::WOUND_SEVERITY` is 1 ("insignificant") to
13 ("useless"); the client's `Severity` is `0 | 1 | 2 | 3` and the paperdoll's
three non-zero tones are deliberately coarse (color + opacity + a number, see
`Paperdoll.tsx`'s doc comment). Widening the client type is out of scope for
this fix — it would touch color logic, the severity labels, and every caller.
Bucket instead:

| DRCH severity | 1–4 | 5–8 | 9–13 |
|---|---|---|---|
| Client `Severity` | 1 (minor) | 2 (serious) | 3 (severe) |

A `Wound` with `is_scar: true` and no live wound severity maps to
`{ wound: 0, scar: <bucketed severity> }` — a scar is history, not a current
injury, and the paperdoll already draws the two differently (hatch vs fill).
Where the same body part carries both a live wound and a scar in the same
poll, bucket each independently.

**Body part mapping.** `Wound#body_part` is a downcased free string
(`"head"`, `"neck"`, `"chest"`, `"abdomen"`, `"back"`, `"arm"`/`"hand"`/`"leg"`
with separate left/right laterality carried elsewhere in the matched text,
`"eye"` likewise, plus rarer `"tail"` and generic `"skin"`) — see
`WOUND_BODY_PART_REGEX` and the match table in `common-healing-data.rb`. The
client's `BodyPart` (`src/lib/body.ts`) has no slot for `tail` or a bare
`skin`. **Do not silently drop them and do not silently fold them into the
nearest limb** — that is exactly the "the check reports success on data it
never looked at" failure this codebase has hit before. Log unmapped parts
once per poll (`server.log("unmapped wound body part: #{part}", 'warn')`) so
a Gor'Tog's tail or a skin condition is visible as a gap, not silently eaten,
and flag it back here so the client side can decide whether to add a slot.
`nsys` (nervous system) has no known DR wound source in this file at all —
leave it unset rather than fabricating a mapping; if that's wrong, the
existing dim/`unhurt` rendering is honest until someone corrects it.

**When to poll.** `check_health` sends a real game command and blocks on the
reply — this is not free, and DR has no passive wound stream to subscribe to
instead. Recommend **on-demand only for v1**: keep it behind the existing
`check_health` intent (already exposed to the UI), populate `injuries` in that
same handler, and leave a timed auto-poll for later rather than adding a new
standing command loop as part of this fix — matches Prime's note that a new
command surface should stay minimal until reviewed. If a caller wants fresher
data they press "Check health" (already wired to the intent per
`ActionsPanel`/`InventoryPanel` conventions); the paperdoll simply shows
whatever the last successful poll said, honestly, until the next one.

**Acceptance check, so this can be verified without trusting the diff:** run a
live `check_health` while genuinely injured, confirm the app's paperdoll
lights up the correct body part at the correct rough severity band, and
confirm a part that heals between polls holds its last-known state rather
than flashing to unknown.

### Addendum: bleeding magnitude (issue #10)

`StatusBoard.tsx` deliberately shows no magnitude for `stunned`, `webbed`,
`poisoned` or `diseased` — checked against `DRCH`'s source, all four are real
booleans in DR with no severity behind them, so that's correct as shipped,
not a gap. `bleeding` is the one exception: `HealthResult#bleeders` (same
`check_health` call as the injuries above) carries a real `Wound#bleeding_rate`
per wound — a string like the game's own description, not invented. Piggyback
it on the same payload rather than opening a separate poll: add
`bleeding?: { part: BodyPart | null, rate: string }[]` to the `check_health`
response alongside `injuries`, mapped through the same body-part table above
(same caveats about unmapped parts apply). The client side of this (reading it
into `StatusBoard`'s bleeding chip) is mine to do once the field exists —
nothing to build on the Ruby side beyond exposing what `check_health` already
parsed.

**Correction, from Prime verifying this against `common-healing-data.rb`:**
this is three states, not a toggle. `'clotted'` is `severity: 2, bleeding:
false` — a wound can be present and tended without still bleeding. Send the
rate string as-is (`'clotted'`, `'slight'`, `'light'`, `'moderate'`, …) rather
than pre-collapsing it to a boolean on the Ruby side; the client decides how
to render "wounded but not bleeding" vs "actively bleeding" from the string
and its own `bleeding` flag in the same data, not from a pre-flattened bit
that has already thrown the distinction away.

## Container contents contract (spec — not yet implemented, issue #5)

Same author, same file-ownership rule, same status as the section above: a
spec for `companion_bridge.lic`'s owner, not a description of what already
ships.

**The bug is worse than the filed issue says.** #5 reads as "capacity is
hardcoded to 0" — true against the mock bridge (`mockBridge.ts` invents
plausible `used`/`capacity` pairs for demo purposes), but **on a live bridge
the containers list is not just wrong, it is always empty.**
`companion_bridge.lic:438` calls `DRCI.get_worn_containers`, and that method
does not exist anywhere in Lich, dr-scripts commons, or anything installed on
this machine — confirmed with `grep -rn get_worn_containers` across all of
`/c/Ruby4Lich5/Lich5`, the only two hits are the call site itself and its own
`.bak`. It raises `NoMethodError`, `safe([]) { ... }` on line 437 swallows it,
and every live status tick reports zero containers. This is exactly the "a
check that cannot fail is not a check" trap: `safe` was written for *this*
purpose (never crash the bridge over a cosmetic field) and it is currently
hiding a total feature failure behind a plausible-looking empty state, not a
degraded one.

**There is no `capacity` in Lich for DR, full stop.** Searched
`common-items.rb` and the rest of `lib/dragonrealms` for any container
capacity/weight-limit concept — nothing. DR containers have a real physical
limit in-game but Lich does not compute or expose a number for it anywhere.
Do not invent one (e.g. by guessing from item type) — that reproduces #5 with
extra steps. The client's `InventoryPanel.tsx` has already been changed
(this session) to only draw the used/capacity bar when `capacity > 0`, and to
show "contents unknown" otherwise, so sending real *item counts* without a
capacity is fine and will render honestly — a capacity field is not a
blocker for shipping counts.

**What's actually gettable, and the concrete replacement:**

1. **Discover worn containers.** No enumeration method exists; the nearest
   real primitive is Lich core's `GameObj.inv` (top-level inventory) filtered
   to items that behave as containers. `DRCI.open_container?`/`close_container?`
   already exist and work against a named container, so a reasonable
   approach: take `GameObj.inv`, and for anything not obviously a weapon or
   wearable, probe with `look_in_container` — see `common-items.rb:1631`
   (`look_in_container`) — which already parses "you see nothing" vs a real
   item list without needing a capacity to interpret. Whatever the actual
   detection method ends up being, it needs to run without opening/closing
   things the player is mid-use of — flag the safety question to Prime before
   wiring it into a periodic status tick.
2. **Count contents.** `list_container_contents`/`rummage_container`
   (`common-items.rb:1654`, `1612`) already return the real item list per
   container. `used` should be that list's length — a real, gettable number —
   not a fabricated one.
3. **Send `used` with no `capacity`.** Given point 2 is achievable and point
   1 (capacity) is not, ship `{ name, used, capacity: 0 }` honestly — the
   client already treats `capacity === 0` as "not reported" and hides the bar,
   showing the count differently is a client-side follow-up once real `used`
   values exist, not a blocker here.
4. **`pressure` should be dropped from this payload, not fixed.** The client
   no longer reads `inventory.pressure` — it reads `character.encumbrance`
   (`DRStats.encumbrance`, already sent, already real) for the header
   indicator instead. Leave `pressure` in the wire type for older-client
   compatibility if that matters, but there is no need to compute a real
   value for it; nothing consumes it anymore.

**Cost note, matching the injuries section's caution:** opening/rummaging
every worn container to count contents is a real in-game action with
roundtime and message-log cost, same shape as `check_health`'s `HEALTH`
command. Recommend the same answer: on-demand behind the existing
`get_inventory`/`subscribe inventory` path or a dedicated intent the UI
triggers deliberately (e.g. the existing "Loot pass"/"Stow all" buttons
already touch inventory), not a background poll, until Prime signs off on
the safety surface.

**Acceptance check:** with a live bridge, wear at least two containers with
different known content counts, confirm `inventory.containers` reports the
right names and the right `used` count for each (not `[]`, not `0`), and
confirm the header now shows a real encumbrance word instead of a hardcoded
"Space OK".

## Lane W field specs (types published, not yet implemented)

Written by W0 (`src/types/index.ts`, `src/lib/panelDataContracts.ts`), for
whichever of W1/W3/W4/W6 implements each field on `companion_bridge.lic`'s
side. Same status as the two sections above: a spec, not a changelog — do
not treat any of the four below as done until the Ruby side actually sends
the field. `PANEL_DATA_CONTRACTS['risk']`/`['inventory']` already name these
fields as data the Risk and Inventory panels need; nothing renders them yet.

### Stance readback (gap row 15, W1)

`CharacterStatus.stance?: 'defensive' | 'guarded' | 'offensive'`. The macro
bar already sends `stance defensive|guarded|offensive`
(`src/data/macros.ts:58-66`) and nothing reads it back — `grep -c '\bstance\b'
lich-scripts/companion_bridge.lic` is `0`, and DragonRealms never puts stance
on the XML stream (`pbarStance` is GemStone-only; see `src/types/stream.ts`'s
own header). So the bridge is the only place this can come from: read it off
the game's own confirmation line after a `stance` command, and hold it in
status state exactly the way `pauseLatched` is held, resending the last known
value on every tick rather than blanking it between commands. **Acceptance
check:** change stance from the macro bar and from a typed `stance
<word>` command directly — both must move the readout, not only the first,
or the client is reading its own echo rather than the game.

### Prepared spell / cast cycle (gap row 20, W3)

`CharacterStatus.preparedSpell?: PreparedSpell | null` (`{ name: string |
null, manaCost: number | null, state: 'preparing' | 'held' | 'releasing' }`).
Nothing tracks prep state or mana cost today. Read this from the game's own
cast-cycle messaging (dr-scripts already parses spell names into
`DRSpells.active_spells` for the unrelated `ActiveSpell`/`spells` roster —
the messaging that produces prep/hold/release is a separate, earlier part of
the same cast and is not currently captured anywhere). Send `null` for
`name` rather than omitting the block when a state is known but the name
could not be parsed - an unknown spell must render as unknown, never as no
spell. **Acceptance check:** preparing, holding and releasing a spell are
three distinguishable states in the readout.

### Numeric encumbrance / carried item count (W4)

`CharacterStatus.carriedItemCount?: number | null`, alongside the existing
`encumbrance?: string` word (`DRStats.encumbrance`, unchanged, still real).
DOMAIN.md section 4 gives the real thresholds this answers against: 100
items free-to-play, 75 before junk-room warnings, 300/250 with the Personal
Inventory Upgrade. Lich has no single call that returns this count directly
as far as this spec's author searched; the nearest primitive is a count of
`GameObj.inv` (top-level inventory), the same enumeration point the
container-contents contract above already needs for a different reason -
implement them together if the timing lines up, since both read the same
underlying inventory. Do not derive a fake number from `encumbrance`'s word
value (e.g. mapping "Somewhat Burdened" to a guessed count) - that
reproduces the container-capacity mistake with extra steps. **Acceptance
check:** the readout can answer "can I pick this up," which the word alone
cannot.

### Rezz sickness timer (gap row 25, W6)

`CharacterStatus.rezzSicknessSeconds?: number | null`. DOMAIN.md sections 7
and 17: there is a timed recovery window after dying during which fighting
is a bad idea, and the combat script's own `.uber DEAD` launch mode already
waits it out - so Lich's own tooling already has to know when this window is
running. `situation`'s `dead`/`dying` flags say whether you are currently
dead or dying, not whether you have already come back and are still
recovering; this field is the third, separate fact. Send `null` once the
window ends rather than leaving a stale `0` on screen. **Acceptance check:**
the recovery timer counts down to `null`, and the fight controls can say why
they are refusing to send a combat command while it is running.

## Implemented-intents contract (spec — not yet implemented, issue #30)

Written by the Activities/Battle session (`downloads-ca`) for
`companion_bridge.lic`'s owner (`GUI features 1`) to implement, per Prime's
ruling: one owner for this file, a contract written down rather than
described in chat. Do not treat this section as done until the Ruby side
actually sends the field — it is a spec, not a changelog.

**The gap today.** `IntentName` in `src/bridge/types.ts` declares more intents
than `Intents.handle` in `companion_bridge.lic` implements; anything not
matched falls through to the `else` branch and comes back
`"'<intent>' is not implemented in bridge v0.9.0 yet."` Two of the gaps are
live buttons in the footer today (`start_training`, `town_run`), so the app
ships controls that look live and are not. See issue #30 for the original
reproduction — but do not trust its counts as current. Reproduce fresh instead:

```bash
grep -n "IntentName" -A 40 src/bridge/types.ts | grep -oE "'[a-z_]+'" | tr -d "'" | sort -u > /tmp/declared.txt
grep -oE "when '[a-z_]+'" lich-scripts/companion_bridge.lic | sed "s/when '//;s/'//" | sort -u > /tmp/impl.txt
comm -23 /tmp/declared.txt /tmp/impl.txt
```

This section originally cited "11 of 22 declared." That was already wrong by
the time it was checked: `downloads-69` counted 20 `when` branches against a
live copy of the file, not 11 — map queries, `install_mapdb`, `list_scripts`
and `start_script` all landed in roughly one evening of concurrent work on
this same file. **Any specific count written in prose here will be stale
before the next session reads it. Use the command above, not this paragraph,
to find the current gap.**

**Direction chosen:** stop offering what the bridge cannot do, rather than
racing to implement everything still missing. The bridge advertises what it
actually implements; the UI disables anything absent. That makes a
declared-but-unbuilt intent render disabled instead of shipping as a dead
button — structurally, not by anyone remembering to update a checklist.

**Wire format.** Add one optional field to the existing `hello` frame:

```ts
{ type: 'hello', protocol, lichVersion, bridgeVersion, auth?, authNote?,
  implementedIntents?: string[] }
```

**Correction, 2026-08-27:** this section originally said to derive the list
by having the bridge "collect the `when '...'` labels at load time." That is
not implementable as written — `downloads-69` checked against the live
source: a plain Ruby `case/when` gives the interpreter no runtime reflection
over its own literals, so there is nothing in `Intents.handle` a script could
introspect to build this list. The two real options were (a) have the script
parse its own source text for `when '...'` patterns, or (b) refactor the
dispatch itself into something enumerable at runtime. **(a) is ruled out** —
a script reading its own text to drive safety-adjacent logic is fragile in
exactly the way this field exists to prevent (a `when` pattern sitting in a
comment or a string would lie to it, silently, the same way the original
hand-maintained-list failure mode would). **Prime ruled (b).**

Concretely: replace `Intents.handle`'s `case intent when '...' then ...`
body with a `Hash` mapping each intent name to its handler (a method symbol
dispatched via `send`, or a `proc`/lambda where the existing branch is inline
rather than a named method — implementer's call, this file has one owner).
`implementedIntents` is then that hash's `.keys`, a genuine runtime
enumeration with the same zero-drift property `auth`/`authNote` already have
on this frame: it is impossible for the advertised list and the real dispatch
table to disagree, because they are the same object. This is a bigger change
than "add one field to hello," and that is the point — a hand-maintained
array parked next to the case statement would already have been stale by the
time this correction was written (see the 11-vs-20 count above), and a stale
manifest here does not degrade gracefully: it disables a button that actually
works, which is worse than the enabled-but-broken state issue #30 exists to
fix.

**Three states, not two — this is the same shape as `auth`/`authNote` on this
same frame, and for the same reason:**

- **Field absent** (bridge older than whatever version ships this) → unknown
  whether an intent is implemented. The UI must **not** disable anything on
  this basis. An old bridge that has never advertised its intent set is not
  evidence any given intent is missing, and defaulting absence to "disable
  everything" would brick every control against every bridge shipped before
  this field — a much worse failure than the one being fixed.
- **Field present, intent listed** → implemented. Enable normally.
- **Field present, intent NOT listed** → not implemented. Disable the
  control, and say why in its `title`/tooltip rather than just greying it out
  silently.

Safety intents (`stop_all`, `pause`, `resume`, `escape` — see
`SAFETY_INTENTS` in `useAppStore.ts`) are exempt from disabling on this basis
regardless of what the list says. They already bypass every other gate in the
store for the same reason: a stale signal must never be the thing standing
between a player and Stop.

**The mock bridge must be able to produce every branch of this**, including
the disabled one — a state the fixture cannot reach is a state nobody sees
until a live bridge is the first place it happens. `mockBridge.ts`'s `hello`
emit (shipped alongside this spec, `intentMode: 'current' | 'unknown' |
'all'`, default `'current'`) hand-lists the real bridge's implemented set as
of when it was written.

**Correction, 27 Aug ~22:15: this was not "less costly," it was worse than
the case/when drift above.** `run_macro` sat in the mock's implemented list
from the start while having no handler anywhere in `companion_bridge.lic` —
found by downloads-37's audit, confirmed by prime. Every Task Flow, every
`ActionsPanel` quick-action macro, and `TrainingPanel`'s PLAY picker route
through `run_macro`, so this one stale entry made #30's entire disable
mechanism report "working" for the app's primary way of making the character
*do* anything, in the one environment everyone develops against. A fixture
claiming a capability the real system lacks is the same shape as a check
that cannot fail — it doesn't just fail to catch the bug, it manufactures
confidence that the bug doesn't exist. See #34.

**This is now enforced, not just documented.** `tools/intent-drift-test.mjs`
parses `IntentName`, `Intents.handle`'s real `when` labels, and
`MOCK_UNIMPLEMENTED_INTENTS` from their three source files and fails loudly
on any disagreement between them — wired into `npm run build` (also runnable
directly as `npm run check-intents`), so a stale mock entry breaks the build
instead of shipping a silent lie. **When the Hash-dispatch refactor above
ships, run `npm run check-intents` (or just `npm run build`) — it will tell
you exactly what changed** rather than relying on anyone remembering to
update `MOCK_ALL_INTENTS`/`MOCK_UNIMPLEMENTED_INTENTS` in `mockBridge.ts` by
hand.

**Acceptance check:** connect to a live (or updated mock) bridge, confirm
`start_training` and `town_run` render disabled with a tooltip explaining why
when the bridge is v0.9.0 (no field), confirm they render enabled once the
bridge advertises them, and confirm Stop/Pause/Resume/Escape are never
disabled by this regardless of what the list says or whether it's present at
all.

## Activity intents (Lane R)

R0 (`docs/PLAN_TO_1_0.md` §6b, Lane R), 10 Sep 2026. The section immediately
below this one — "Activity intents batch contract" — already worked out
*which* dr-scripts script each of the nine activity intents starts and what
it needs to know; that research is not repeated here. What was still
missing, and what none of these nine could be implemented from without
asking, is the **shape**: the args each intent's wire message actually
carries, how a caller is told the activity is still running (an activity
takes minutes; `intent_ack`'s ok/detail pair is the wrong shape for that),
how a caller is told the character cannot do this right now, and how Stop
and Pause reach something that runs for minutes rather than milliseconds.
This section is that contract. R1–R7 implement against it; each flips its
own row in the "Status of the nine" table below from "not yet implemented"
to "implemented" in the same commit that adds its `HANDLERS` entry, and that
table is what `tools/activity-intent-contract-test.mjs` reads.

### The rule every one of the nine follows

**Every activity handler's job is to start a named dr-scripts script (or, for
`loot`, compose the existing quick-action) and report — never to reimplement
game logic.** `map_walk` and `install_mapdb` already do this for map/script
control; these nine do it for combat, healing, training and town chores.
`DOMAIN.md:1059-1060`: "A companion that drives `;go2` inherits every fix
anyone makes to it. One that reimplements pathfinding owns every bug
forever." Same argument, nine more times.

### Args

Each intent's args are exactly what its underlying script needs and nothing
the client cannot honestly supply — see each intent's own entry below and in
the batch contract for the specific shape. Two rules that apply across all
nine:

- **Never invent data this repo does not have.** Spell lists, hunting
  grounds and buff sets live in the character's own dr-scripts settings
  (`C:\Ruby4Lich5\Lich5\scripts\data`, `DOMAIN.md:305-325,:1150-1170`) or on
  Lich's side (`go2`'s tag resolution). An intent that needs one of these
  either omits the arg and lets the script use its own configured default,
  or reads it back first with the bridge's existing `read_settings` /
  `map_nearest` and lets the *client* choose — it is never hardcoded here.
- **A destination is a tag, a room id, or a `u<uid>`** — the same three
  forms `go2` itself accepts and this document already distinguishes
  (`id` vs `uid`, above). `travel`, `go_healer` and `escape_heal` all take a
  destination in this form; `town_run` resolves its own stops via `go2`
  internally and takes none.

### Progress

**Request/response (`intent_ack`) is the wrong shape for something that runs
for minutes**, so an activity's progress is not a new message type. It
reuses the two channels that already carry a running script's state:

- **`log`** — the running script's own narration, forwarded the same way
  `map_walk`, `install_mapdb` and `run_macro` already forward theirs
  (`server.log(...)`). "Buffing: fire spirit (2 of 5)", "Walking to 1049
  (12 rooms)", "Selling: 3 skins, 1 gem" are this channel, not a payload of
  their own.
- **`scripts`** — `{ name, status }[]`, already sent by `list_scripts` /
  populated by `Script.running`. Once an activity handler calls
  `Script.start`, the started script appears here exactly like any other
  running script; a client that wants "is my training run still going"
  polls this rather than inventing a per-intent status field.

`status.activity` (already documented above, in `CharacterStatus`) is the
third source a client reads, unchanged by this contract — it is what the
game stream itself says the character is doing, independent of which script
started it.

No activity intent gets a bespoke progress message type. If a future
increment finds these three insufficient for a specific intent, that is a
new spec entry here, not a silent new field on `intent_ack`.

### Refusal

Every activity handler returns the same two-element shape every handler in
`HANDLERS` already returns: `[false, '<reason>']`, surfaced to the client as
`{ type: 'intent_ack', intent, ok: false, detail: '<reason>' }`. Nothing new
here either — the contract is which reasons a *refusal-worthy* state
produces, checked in this order, matching `map_walk`'s and `start_script`'s
existing pattern:

1. **Stop is latched:** `'Stop is still latched - press Resume before <doing the thing>.'`
   (`stop_requested?`, checked first, same as `map_walk`/`start_script`).
2. **Pause is latched:** `pause_refusal(intent)` — each activity intent adds
   its own sentence to `PAUSE_HELD` (below), the way `map_walk`, `run_macro`
   and `start_script` already do; a shared "Paused - press Resume." only
   covers an intent that forgot to add its own line.
3. **The underlying script is not installed:** `'<script> is not installed.
   Install the standard dr-scripts suite to <do the thing>.'`
   (`Script.exists?`), matching `map_walk`'s `go2`-missing message.
4. **The activity is already running:** `'already <doing the thing> (<script>
   is running) - stop it, or wait for it to finish, first'`, matching
   `map_walk`'s already-walking check.
5. **Anything the specific intent's own domain rules refuse for** — e.g.
   `travel`'s unreachable destination, `go_healer`'s expired passport
   (`DOMAIN.md:96-101`) — named in that intent's own entry below.

A refusal never reports success. `install_mapdb`'s own history is the
warning: it used to report "started" for a script that had already exited,
because starting is not the same fact as succeeding — every one of these
nine must confirm the thing it claims, the same correction R3's `travel` and
R4's health check make explicit in their own `verify:` lines
(`docs/PLAN_TO_1_0.md`).

### Stop and Pause reach every one of these, and here is the whole mechanism

`SAFETY_INTENTS` in `src/store/bridgePolicy.ts` — `stop_all`, `pause`,
`resume`, `escape` — is why: those four controls are never disabled by
capability gating, on the client. On the bridge side, `stop_all`/`pause_all`/
`resume_all` already sweep **every** named script in `Script.running`
generically (`companion_bridge.lic`'s own `stop_all`/`pause_all`/
`resume_all`) — so the moment an activity handler calls `Script.start`, Stop
and Pause already reach the running process with **no further plumbing**.
What each of R1–R7 must still add, per intent, because it is per-intent and
cannot be generic:

1. **A pre-start check**, exactly like `map_walk`/`start_script`: refuse to
   start while `stop_requested?` or `pause_refusal(intent)` is truthy. Skip
   this and Stop can be latched while the click that starts the activity
   still lands — the exact bug `map_walk` was fixed for (issue #462).
2. **One line in `PAUSE_HELD`** naming that intent's own refusal sentence,
   so a paused player reads "press Resume before training" rather than the
   generic fallback.

Composed intents (`escape_heal`, `town_run`) are not exempt: each step they
start is itself one of these nine-or-existing scripts, and each step gets
its own pre-start check before it starts the next.

<a id="activity-intents-lane-r"></a>

### Status of the nine, and where each is tracked

| Intent | Increment | Status |
|---|---|---|
| `buffs` | R1 | not yet implemented |
| `loot` | R2 | not yet implemented |
| `travel` | R3 | not yet implemented |
| `escape_heal` | R4 | not yet implemented |
| `go_healer` | R4 | not yet implemented |
| `town_run` | R5 (depends on R3, X1) | not yet implemented |
| `start_training` | R6 | not yet implemented |
| `start_combat` | R7 (depends on R0, W1) | not yet implemented |
| `burgle` | R8 | **deferred** — blocked-on: a product decision only Dan can make (`docs/PLAN_TO_1_0.md` §10; `NEXT-50.md:493-499`) — whether the house-entry feature ships at all, and under what safety contract. `scripts/burgle.lic` is real and complete; it is not being wired up until Dan decides. |

This table is the single source of truth for each intent's status —
nothing else in this document restates it, so there is nothing else for it
to drift against. `tools/activity-intent-contract-test.mjs` reads this table
against `companion_bridge.lic`'s real `HANDLERS` and reports drift: a row
whose status is anything other than "deferred" while `HANDLERS` already has
a matching key (meaning this table fell behind an increment that landed), a
deferred row with no blocker, or one of the nine missing a row entirely. As
each of R1–R7 lands, that row's own commit changes "not yet implemented" to
"implemented" in the same edit that adds the `HANDLERS` entry — the marker
and the fact ship together, the way `docs/PLAN_TO_1_0.md` §0.2 already
requires for the plan's own `[x]` markers.

---

## Activity intents batch contract (spec — not yet implemented)

Written by `downloads-2e` per Prime's ruling, batched deliberately: nine
sequential contract handoffs for one file with one owner would serialise the
rest of the night more than one reviewed batch. `companion_bridge.lic` is
`GUI features 1`'s file; nothing here is implemented and nothing in this
section should be treated as done until the Ruby side has real handlers.
Reproduce the gap fresh rather than trusting a count written here (see the
`comm -23` recipe above) — as of `HEAD` at write time, none of these nine have
a `when` branch in `Intents.handle`: `buffs`, `burgle`, `escape_heal`,
`go_healer`, `loot`, `start_combat`, `start_training`, `town_run`, `travel`.

These are exactly the intents the Activities panel and Task Flows were built
around (`src/data/activities.ts`), so this is the gap between "the app can
read state and stop scripts" and "the app can make the character do things,"
per the existing `else` branch's own honest wording.

**R0 (above) is the args/progress/refusal/Stop-Pause contract every entry
below implements against, and ["Status of the nine"](#activity-intents-lane-r)
is the one place that says whether a given one has landed yet.** What
follows is unchanged research into which script each intent starts and what
it needs to know — read both: this section for the *what*, R0 above for the
*shape*.

**Shape reference, so each entry below doesn't repeat it:** two existing
handlers are the two shapes everything here fits into. `run_macro`
(`companion_bridge.lic:1803`) sends a sequence of raw game commands through
`Cmd.exec`, each waiting real roundtime — the shape for anything that's just
"type these commands." `start_script` (`:1435`) launches a named `.lic` file
with `Script.start(name, *args)` and returns immediately without waiting —
the shape for anything that's a standing loop or multi-minute process a
player would otherwise type `;scriptname` for. Nothing below needs a third
shape.

### `buffs`

**What already does this:** `scripts/buff.lic` (`class Waggle`) — accepts
`set=<name>` (a named spell set from the character's own settings,
`get_settings.waggle_sets`), `force` (recast even if active), `strict` (keep
retrying until it sticks). No enumeration of what a "waggle set" contains is
possible from outside the character's settings file — it's player-configured.

**Shape:** `Script.start`. `Script.start('buff', "set=#{set}")` if an
explicit set name is given, otherwise `Script.start('buff')` and let the
script fall back to its own default set from settings.

**What it needs to know:** an optional `set` argument (string, the set's
configured name). **Cannot verify what a given character's sets are named**
without reading that character's own settings file — this bridge already has
`read_settings`, so the args validation this needs (does the named set
exist?) can reuse that rather than trusting the client to have typed it
correctly. If the client doesn't have a set name to send, don't guess one;
launch with none and let `buff.lic`'s own default apply.

**Safety:** none beyond what casting spells at yourself already carries in
DR. Not flagged.

### `start_training`

**What already does this:** `scripts/training-manager.lic` (`class
TrainingManager`) — hometown-aware (`get_data('town')`, `@settings.hometown`),
handles harvesting/mining, hunting priority, periodic repair
(`@repair_every`), loot selling (`@sell_loot`), and favor-altar use. This is
the settings-driven "go train" loop `src/data/activities.ts`'s `train`
activity describes almost verbatim ("Picks a ground for your ranks and
guild").

**Shape:** `Script.start`. `Script.start('training-manager')`, no args needed
— everything it varies on comes from the character's own settings file, same
as `buffs`.

**What it needs to know:** nothing from the client. It reads its own
settings.

**Safety:** none beyond ordinary attended training. Not flagged.

### `start_combat`

**What already does this:** `scripts/combat-trainer.lic` — `SetupProcess`
handles stance/defense-priority setup from settings
(`stance_override`, `priority_defense`), and the file's whole purpose is an
attended fight/retreat loop, matching `activities.ts`'s description exactly:
"Fights, loots what you allow, and withdraws when your health drops."

**Open question, not resolved here — flag to Prime before building:** the
client already has a working "Hunt cycle" Task Flow (`DashboardLayout`'s
task-flow list) built from `run_macro` steps — attack, loot, skin, tend,
repeated. If `start_combat` is meant to be a *different, more capable*
standing loop (real retreat-on-health-threshold logic, stance management)
rather than the same behavior the Task Flow already provides via macros, say
so explicitly when this ships, because a player will otherwise have two
buttons that both claim to do "fight" with no visible difference. **I'm not
resolving which one this should be** — that's a product call, not something
derivable from source.

**Shape:** `Script.start`. `Script.start('combat-trainer')`.

**What it needs to know:** nothing from the client if settings-driven, same
pattern as training-manager.

**Safety:** a standing combat loop is the highest-consequence thing on this
list short of `burgle`. `combat-trainer.lic` already has its own
health-based retreat logic; the bridge doesn't need to duplicate it, but
Stop must reach it the same way it reaches every other `Script.start`ed
process — confirm this against `State.other_scripts`/`stop_all` before
shipping, don't assume.

### `town_run`

**No single script does all of this — it's a composition, and I could not
find a curated "town run" script under that name.** What exists:

- **Selling:** `scripts/sell-loot.lic` (`class SellLoot`) — accepts an
  optional `town=` override, and `amount=`/`type=` for how many coins of
  which currency to keep. This is the real match for the "sell" step.
- **Banking:** no dedicated script found (`bankbot.lic` is a porter-tip
  ledger, unrelated). Depositing/withdrawing in DR is a single game command
  at a bank window — this is a `run_macro`-shape step (`Cmd.exec('deposit
  all', ...)`), not a script launch.
- **Repair:** `scripts/repair.lic` and `scripts/crossing-repair.lic` exist as
  separate scripts; `training-manager.lic` also has its own internal repair
  logic (`@repair_every`) — worth checking whether reusing
  `training-manager`'s repair path is preferable to launching a third script,
  but that's implementer's call, not something I'm deciding here.
- **Travel between stops:** `scripts/go2.lic` — the curated general movement
  script (`;go2 <tag or destination>`), which already resolves tags like
  `bank`, `general store`, `guild` per-hometown. `DRCT.walk_to`
  (`lib/dragonrealms/commons/common-travel.rb:178`) is the lower-level
  primitive `go2` itself is likely built on, if a script launch per hop is
  too heavy.

**Client-side, this already exists and is real, not a stub:** `mockBridge.ts`
already has account-tier-gated `planTownRun` logic (vault skipped without a
vault, bank 10p cap respected) producing a step list with reasons. That
capability-aware planning is a genuine client-side asset — the Ruby side's
job is to *execute* a plan, not redecide it. Whether the client sends the
already-decided step list as args, or the bridge re-derives the same gating
from `accountTier`/`instance` independently, is a design choice for whoever
implements this; both are defensible, but implementing it twice
independently is how the two silently drift, so pick one and say which.

**Shape:** mixed — `Script.start('sell-loot', ...)` for selling,
`run_macro`-shape `Cmd.exec` for banking, `Script.start` for repair, `go2` for
travel between them. This is the one intent in this batch that is genuinely
several steps chained, not one script or one command sequence.

**Safety:** none beyond ordinary town chores. Not flagged, but see the
tier-gating note above — sending a vault-tier player to try a vault step
that F2P can't use is the exact bug the existing capability-aware rule in
this document was written to prevent.

### `go_healer`

**What already does this, partially:** `scripts/go2.lic` resolves the map
tag `npchealer` (confirmed in its own destination-tag list,
`go2.lic` line ~1008) and there's a parallel `empath` tag for player-Empath
healing. Getting *to* a healer is a solved `go2`/`DRCT.walk_to` problem.
**Choosing *which* healer is not solved anywhere in Lich** — there is no
capability-aware healer-selection logic in dr-scripts or Lich core.

**That scoring already exists, client-side, and is real work worth reusing
rather than re-deriving in Ruby:** `chooseHealer`/`scoreHealers`/
`pickBestHealer` (referenced from `mockBridge.ts`'s `go_healer` handler) are
genuine capability-aware logic — instance, account tier, mobility from
Athletics/burden, `preferredCity` override. **Recommend the bridge not
reimplement this scoring in Ruby at all.** Have the client compute the
destination (it already does, today, in the mock) and send it as an arg —
`args: { destinationTag: 'npchealer' }` or a resolved room/uid via the
existing `map_nearest`/`map_path` read-only intents — and have the Ruby side
do only the travel: `Script.start('go2', tag_or_id)`, or `DRCT.walk_to` if a
resolved room id is sent instead of a tag. Reimplementing the scoring
Ruby-side would be a second copy of logic that already works and is already
tested against the mock; that's the kind of drift this codebase has been
paying for all night in other files.

**What it needs to know:** a destination (tag, room id, or uid — client's
choice, but say which in the implementation, matching the existing
`MapRoom`/`id`-vs-`uid` distinction this doc already documents above).

**Safety:** moves the character while presumably hurt. Ordinary movement
risk, same as any `go2` use; not the `burgle`-class concern.

### `escape_heal`

**This is a composition of two things that already exist separately, not a
new primitive.** `escape` (`companion_bridge.lic:1776`) already sends `flee`
and resets runaway detection. `go_healer` (above, once built) already gets
the character to an appropriate healer. `escape_heal` reads as exactly
"do both, in order" — flee first, then run the same healer-selection-and-
travel path `go_healer` uses.

**Shape:** compose the two existing/spec'd handlers rather than writing a
third implementation: call `escape`'s logic, then `go_healer`'s, sequentially.

**What it needs to know:** same as `go_healer` — an optional destination
preference. Nothing additional for the flee half.

**Safety:** the higher-consequence of the two composed intents is `escape`
itself (fleeing combat), already shipped and presumably already reviewed;
composing it with a travel step doesn't add new risk beyond what `go_healer`
above already carries.

### `travel`

**What already does this:** `scripts/go2.lic`, directly —
`Script.start('go2', destination)` where `destination` is whatever `go2`
itself accepts (a tag, a room id, a `u<uid>`, or a named alias). This is the
most direct mapping in the whole batch; nothing to compose, nothing missing.

**What it needs to know:** the destination string, from `args.destination`
(matches the existing client shape — see `mockBridge.ts`'s `travel` handler,
`(_args?.destination as string)`).

**Safety:** ordinary movement risk. Not flagged. Same capability-aware
caution as `go_healer`/`town_run` applies if the destination is
instance/tier-gated (e.g. a premium-only zone) — `go2` itself does not know
about account tiers, so refusing an out-of-reach destination is either the
client's job (before sending the intent) or needs a check added here; **not
resolved which, flagging rather than guessing.**

### `loot`

**Likely overlaps with something that already works, and I'm not confident
this needs new Ruby code at all.** The `Loot pass`/`Take all` quick actions
(`InventoryPanel.tsx`, `ActionsPanel`) already send `get all` via the
existing macro/quick-action path (the same `run_macro`/`Cmd.exec` shape
everything else in this doc uses). If the `loot` *intent* specifically is
meant to be a standing, selective loot pass — whitelist/blacklist by item,
matching the pattern `burgle.lic`'s `loot_type` option
(`drop`/`keep`/`pawn`/`bin`/`trashcan`) already uses elsewhere in this
library — that's a real, separate thing worth building, but **I could not
find a standalone curated script for "selective loot pass" distinct from the
plain `get all` already wired up.** Flagging this one plainly per the
instruction to say so rather than guess: either (a) `loot` is redundant with
the existing quick action and should be reconsidered rather than
implemented, or (b) it's meant to carry real per-item preferences the client
doesn't currently send anywhere, in which case the wire format needs those
preferences specified before this can be built. Not deciding between them.

### `burgle` — **blocked on Dan, not spec'd**

Per instruction: this is a product/policy decision
([[dr-companion-project]] memory: the house-entry feature "is the feature
that will draw fire in official channels regardless of framing... a
positioning call Dan should make deliberately"), not an engineering gap.

**What exists, for when/if this is unblocked, so the research isn't lost:**
`scripts/burgle.lic` (`class Burgle`) is a real, complete, already-written
script — requires an explicit `start` arg (its own built-in typo/safety
guard), takes `entry` (`lockpick`/`rope`/`cycle`/`prioritylockpick`/
`priorityrope`), `roomid` override, `loot_type`
(`drop`/`keep`/`pawn`/`bin`/`trashcan`), `hometown`, and a `follow` mode. It
already matches `mockBridge.ts`'s `burgle` handler shape (`method`,
`maxSearches`, `hide` args) closely enough that the mock was clearly written
against this real script.

**Do not implement a handler for this intent.** The disabled-with-tooltip
state issue #30 already ships is the correct current behavior. This entry
exists so the next person doesn't re-derive "yes, `burgle.lic` exists and
would work" and mistake that for permission to wire it up.

**Acceptance check for this batch, once any of the above lands:** for each
implemented intent, confirm `implementedIntents` (from the #30 contract
above) includes it, confirm the corresponding button/Task Flow enables, and
confirm Stop reaches whatever `Script.start` process it launched — the same
`State.other_scripts`/`stop_all` path every other standing script already
uses. `burgle` should still read disabled-with-tooltip after this batch
ships, not enabled — its absence from `implementedIntents` is the whole
point.

## `check_health`: the one genuinely dead-data intent, and a live test that can't see the bug

Prime's initial scan of "implemented but no caller in `src/`" also named
`get_favors` and `check_toggles`. Both retracted after closer checking:
`favors` is already live end-to-end (`status.favors`, consumed by
`RiskBar.tsx` and `accountCapabilities.ts`'s "no favors, death costs full
price" gate) — `get_favors` the *intent* has no caller, but the data it
would return is not dead, it already flows through `status` and is read.
**`get_favors` itself has since been deleted** (ratified by prime 1): a
capability nobody could invoke, duplicating a route that already works,
was surface with no upside. If this section is being read as a reason to
re-add it, don't — `status.favors` is the live route, and always was.
`check_toggles` is prime 1's question to resolve (whether `status` already
covers it). Only `check_health` has wound data with no route into the
client by any path — confirmed by checking every occurrence of `wounds` in
`src/`, which turns up a mock comment and unrelated catalogue text, nothing
that consumes it.

```
grep -n "def check_health" -A45 lich-scripts/companion_bridge.lic
```

Calls `DRCH.check_health`, wrapped in `rescue StandardError; nil; end`, then
gates on `data.is_a?(Hash)`.

**That gate is never true against a real Lich install, and this is a bug,
not a documented limitation.** `DRCH.check_health`
(`lib/dragonrealms/commons/common-healing.rb:22`) returns a `HealthResult`
instance on success — a plain class (`grep -n "class HealthResult"
lib/dragonrealms/commons/common-healing.rb` → not `< Hash`, no `Hash`
ancestor), not a `Hash`. `HealthResult#[]` is defined for backward
compatibility (`data['wounds']` would actually resolve, since `[]` forwards
to `send(:wounds)`) — but the bridge's own `unless data.is_a?(Hash)` check
rejects it before that method is ever called. **Every successful
`DRCH.check_health` call is routed into the same fallback branch as a
failed one**, which sends a raw `HEALTH` command and, at best, logs its raw
text with no structured data at all (`[true, 'health read']`, nothing
parsed). The wound/bleeder/poisoned/diseased branch below the `is_a?(Hash)`
check — the one issue #4's injuries spec (above, in this file) is written
against — is currently dead code. `downloads-8a` found the symptom (the
harness always takes the fallback, because `DRCH` was unstubbed); this is
the root cause, and it is not a harness artifact — an unstubbed test and a
real Lich install hit the exact same branch for the same reason.

**`64cd112`'s new "DRCH available" test does not close this, and could not
have caught it.** Read after landing, per prime's instruction that it pins
the behaviour down — it doesn't, for this one specific case, because its
stub returns the wrong shape:

```
grep -n "\$drch_reply = {" -A5 lich-scripts/test/server_test.rb
```

`$drch_reply` is set to a plain Ruby `Hash` literal (`{'wounds' => ...,
'bleeders' => ..., 'poisoned' => false, 'diseased' => false}`). Against
that stub, `data.is_a?(Hash)` is **true**, the bridge takes the real
parsing branch, and the test correctly asserts `'3 wounds, 1 bleeding'`.
The test is well-built — floor included, sabotage-checked — for a
`DRCH.check_health` that returns a `Hash`. It doesn't, so the test is
green for a scenario the real Lich API cannot produce, and the actual
always-false gate has no coverage failing on it: the suite is fully green
and the bug is still there. Same shape as this repo's other instrument-vs-
subject misses tonight (the drift test's parser, the harness's missing
`dothistimeout` stub before `5f71859`), just found on the read-through
this section asked for rather than by running anything new.

**Not fixed here, deliberately**, same reasoning as before this correction:
the one-line fix (`data.respond_to?(:wounds)` in place of
`data.is_a?(Hash)`) is trivial, but issue #4's spec above already claims
this exact code path for a larger piece of work — persisting injuries
across polls, the 13→4 severity bucketing, wiring into `status.injuries`.
Changing the gate in isolation would make `check_health` start logging
real wound text without doing any of that. **Whoever picks up #4 should
also fix `$drch_reply`'s shape in the same pass** — a `HealthResult`-like
double (respond_to `:wounds`/`:bleeders`/etc., not a `Hash`) or the
success test will keep passing for a code path production still can't
reach.

**`HealthResult` also exposes fields the bridge has never read even in the
dead code**: `parasites`, `lodged`, `score`, `dead`, `vitality`, plus
`injured?`/`bleeding?`/`has_tendable_bleeders?` convenience predicates
(`lib/dragonrealms/commons/common-healing.rb:405-439`). Worth having in view
for #4's implementer, not a gap this note is asking anyone to close.
