# DR Companion — Lich Bridge Contract

**Version:** 0.1  
**Status:** Design + mock implemented; live Ruby side not yet shipped

## Why a bridge exists

Genie is the primary game window. Lich is the automation engine (TCP proxy + Ruby scripts).  
The Companion is a separate desktop UI. It must not parse the game stream itself.

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

// Map replies (bridge 0.4.0+). map_here/map_path/map_zone are read-only.
// 'map_walk' (bridge 0.10.5+) is the one exception: it starts go2 walking
// toward the room and answers over the ordinary intent_ack/log channel, not
// a payload of its own - go2's own progress prints through the normal game
// stream, the same as if the player had typed ;go2 <room> themselves.
{ type: 'map_here',    payload: MapRoom & { available: boolean } }
{ type: 'map_path',    payload: { ok, from?, to?, steps?, rooms?, reason? } }
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

| Intent | Meaning |
|--------|---------|
| `stop_all` | Emergency / full stop of Companion-driven scripts |
| `pause` / `resume` | Pause automation |
| `go_healer` | **Capability-aware** heal path (not “closest only”) |
| `town_run` | Heal → sell/deposit → basic chores |
| `start_training` | Conservative attended training routine |
| `loot` | Loot pass per preferences |
| `buffs` | Buff routine |
| `escape` | Emergency exit to safety |
| `stow_all` | Stow loose items per rules |

## Capability-aware rule (mandatory)

For `go_healer`, `town_run`, travel, and hunting selection, Lich-side logic **must** evaluate:

1. Character needs (wounds, bleeding, dead/dying)
2. Character capabilities (skills, spells, circle, transport, wealth, access)
3. Instance differences
4. Path safety vs combat ability
5. Prefer safe / free / high-quality options; explain when none exist

Never implement “closest healer by room distance only” as the final decision.

## Launch context (research notes)

- Lich 5 acts as a proxy between Genie and the game server.
- Typical Genie launch pattern:  
  `ruby lich.rbw --dragonrealms --genie`  
  (or packaged Ruby4Lich5 equivalents)
- Genie is identified as a frontend with XML + Mono capabilities.
- There is **no** built-in public WebSocket API for external UIs; the Companion bridge script provides that surface.
- Recent Lich 5.20.x adds multi-client detach support and Genie identification for headless launches — useful later for robust attach.

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

**Not fixed here**, deliberately: the one-line fix (`data.respond_to?(:wounds)`
in place of `data.is_a?(Hash)`) is trivial, but issue #4's spec above already
claims this exact code path for a larger piece of work — persisting
injuries across polls, the 13→4 severity bucketing, wiring into
`status.injuries`. Changing the gate in isolation would make `check_health`
start logging real wound text without doing any of that, which is a
different, smaller change than #4 describes and could conflict with
whoever implements it. Recording the finding here so #4's implementer
starts from the right place instead of re-discovering that the primary
path never ran.

**`HealthResult` also exposes fields the bridge has never read even in the
dead code**: `parasites`, `lodged`, `score`, `dead`, `vitality`, plus
`injured?`/`bleeding?`/`has_tendable_bleeders?` convenience predicates
(`lib/dragonrealms/commons/common-healing.rb:405-439`). Worth having in view
for #4's implementer, not a gap this note is asking anyone to close.
