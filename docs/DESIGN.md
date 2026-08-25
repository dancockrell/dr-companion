# DR Companion — design

Status: **proposed, not approved.** Nothing here is built yet.

Written after reading the community scripts rather than guessing. Every claim
below is sourced, because the point of this document is that it can be argued
with.

---

## 1. What the evidence says

### The scripts are enormous because the game is exceptional

| Script | Lines | What it is |
|---|---|---|
| `uber.cmd` | 77,867 | combat, hunting, selling, town, invasions |
| `travel.cmd` | 8,248 | routing, ferries, shortcuts |
| `disarm.cmd` | 5,517 | box popping |
| `burgle.cmd` | 944 | house entry |
| `uberwatch.cmd` | ~120 | notices when uber has died |

`uber.cmd` contains **2,008 `action` triggers**. Not 2,008 features — 2,008
things that can happen to you mid-script. They include a Dragon Priest
juggernaut giggling, an ambush choke, arriving aboard the Mammoth, and
*DragonRealms announcing a server shutdown*.

`uberwatch.cmd` exists only because uber dies. It watches for disconnects six
ways, the idle timeout, the script vanishing from `$scriptlist`, an unexplained
`Your worn items are:`, and **the game clock failing to advance**.

**Conclusion: we do not write a better automation engine.** That fight is
already fought, at a scale we will not match, by people who have been at it for
years. What none of those 95,000 lines has is an interface.

### Reading, not copying

Community scripts are the map of the game world and should be used hard —
for their *information*. Shroom's work in particular is not community-licensed.
We read them to learn what the game does. We do not copy code out of them, and
this repo stays MIT.

Everything we *call* is Lich 5, which is BSD 3-Clause
(`C:\Ruby4Lich5\Lich5\LICENSE`) and therefore unencumbered.

### All our automation lives in Lich

The Ruby bridge script is where anything that touches the game goes. Rust is
the installer and the window shell, and it is essentially finished. **If a
feature needs new Rust, that is a signal it is the wrong feature.**

---

## 2. The model

The mistake to avoid is a button called "wear swimming armour". There is no end
to those. Four examples from four different scripts, all the same shape:

| Situation | Requirement | Modifiers | If it fails |
|---|---|---|---|
| Swim the Segoltha | Athletics ~565 | burden, armour, buffs, strength | stuck, possibly dead |
| Pop a box | Appraisal vs trap difficulty | helmet and gloves off | acid, wounds, ruined armour |
| Burgle in town | Stealth vs guards | hidden, buffs, rope | **jail** — a fine and dead time |
| Burgle in a clan | same | same | **maimed** — walk to an empath |

`travel.cmd` states three numbers per crossing, not one: *possible* with no
burden and no armour, *safe*, and a conservative default it ships with. It
carries a player-tunable risk appetite. `disarm.cmd` picks its disarm mode —
Blind, Quick, Normal, Careful — from measured difficulty against your skill, and
throws the box away when the sum is bad.

So the abstraction is:

> **A Situation is a requirement, a set of modifiers you control, a risk band,
> and a consequence with a recovery cost.**

That single model covers swimming, box popping, burgling, travel shortcuts and
hunting-ground choice. It is worth building once.

The burgle case proves the consequence half matters as much as the odds.
`burgle.cmd`'s `JAIL:` handler is a loop that kicks a dust pile forever.
Its `CLANJUSTICE:` handler prints "GO HEAL YOURSELF" and exits cleanly. Same
crime, same chance of being caught, wildly different cost — so *where* you do a
risky thing is a real decision, and nothing in this app currently helps make it.

### What that means for the interface

Not buttons per case. Two things:

1. **Gear profiles** — named sets the player defines: `swimming`, `boxes`,
   `burgle`, `combat`. Lich already has this: `EquipmentManager#wear_equipment_set?`
   takes a set name, and its own docs use `"standard"` and `"swimming"` as the
   examples. We expose it and show what is currently worn so it can be trusted.
2. **A readiness read-out** — for the situation you are in, what the requirement
   is, where you stand against it, what would move the number, and what it costs
   if it goes wrong. Not a decision made for you.

---

## 3. What the app is

**A face for state and control, on top of Lich and whatever scripts the player
already runs.** It does not replace uber. Ideally it can see uber running and
report on it.

Three jobs, in order:

1. **Show me what is happening**, at a glance, without scrolling.
2. **Let me act on it** — gear, movement, stop — without typing.
3. **Tell me when it has gone wrong**, because that is the failure mode of this
   entire genre.

---

## 4. What earns the screen

The window is 520×780 by default. Ranking has to come from what the player is
doing, not from what is easy to draw.

**Tier 1 — always visible, never scrolled to**

- **Room**: creatures with per-creature status, dead ones, other players.
  `GameObj.npcs` + `GameObj.npc_status`, `DRRoom.dead_npcs`, `DRRoom.pcs`.
  This is the biggest current gap and the thing looked at most often.
- **Body**: wounds by location, not a health number. A bleeding head and a
  bleeding leg are different emergencies. `XMLData.injuries` gives 16 parts with
  wound and scar severity 0–3 — a paperdoll, already, in less space than three
  bars.
- **Stop.** Already correct, do not touch.

**Tier 2 — one glance, resizable, dockable**

- **Map**, sized to follow movement, hazards coloured. Not a thumbnail.
- **Hands and worn**, with gear profiles. `GameObj.right_hand`/`left_hand`,
  `GameObj.inv`, `DRCI`, `EquipmentManager`.
- **Watchdog**: is the automation alive? Game clock advancing, `$scriptlist`,
  last command and its reply. Modelled directly on `uberwatch.cmd`.

**Tier 3 — on demand**

- Skills and mindstate, healer scoring, hunting-ground ranking, settings.

Healer rankings and hunt scores currently sit in the middle of the Power view.
They are decisions made once every few hours and they should not outrank the
room you are standing in.

---

## 5. Layout

Both current layouts were arrived at by appending panels in the order they were
written. Rather than defend a guess: every panel moves, resizes, collapses, and
can be docked to a side rail that widens the window instead of covering it.
The arrangement persists per mode.

A crafter wants inventory open and the map small. Someone hunting wants the map
large and watched. Neither is wrong, so the app should not have an opinion.

Two modes only, Basic and Power, differing in density rather than in which
panels exist.

---

## 6. Architecture

```
Lich (Ruby)                     bridge script          panel (React)
  DRStats, DRSkill, DRRoom  ->  reads, never guesses -> renders
  GameObj, XMLData.injuries     one JSON per topic      arranges
  DRCI, EquipmentManager    <-  intents, acked        <- asks
  Map (rooms, Dijkstra, tags)
```

Rules that already earned their place and stay:

- Every read is defensive. Lich's DR objects come from parsing a game stream;
  any of them can be nil right after login.
- Every intent is acked, with a reason when refused. Never a silent no-op.
- "I could not look" and "there is nothing there" must never render the same.
- Stop is never gated on anything.
- Read-only queries are never gated either — lying dead is exactly when you want
  to know where the healer is.

---

## 7. Build order

Each step is one bridge topic plus one panel, and each is shippable alone.

1. **Panels move and resize.** `Panel.tsx` and `lib/layout.ts` exist; almost
   nothing uses them. Highest value, no new game knowledge needed.
   *Done when:* every panel can be moved, resized, collapsed, and the
   arrangement survives a restart.
2. **Room panel.** Creatures, status, dead, players.
   *Done when:* what is in the room is visible without scrolling, and matches
   `look`.
3. **Body panel.** Paperdoll from `injuries`.
   *Done when:* a wound to a specific limb is visible and severity-coloured.
4. **Gear panel and profiles.** Hands, worn, named sets, weapon swap by skill.
   *Done when:* a profile can be defined, applied, and verified from the panel —
   the drowning and box-popping cases both work without a bespoke button.
5. **Map to a side dock**, following the character.
6. **Watchdog panel**, modelled on `uberwatch.cmd`.
7. **Situation read-out** — the model in §2, starting with route crossings,
   where `travel.cmd` has already published the thresholds.

Steps 1–3 need no new game knowledge and no new Rust. Step 4 is where this
becomes a tool people would choose over typing.

---

## 8. Open questions

1. **Should the app read the player's dr-scripts / Genie settings** to learn
   their existing gear sets and containers, rather than asking them to define
   everything again?
2. **How much should it try to see uber?** Reporting on a running script is
   useful and cheap. Driving one is a different product.
3. **Whose thresholds?** `travel.cmd` ships conservative numbers and lets you
   lower them. Do we ship the same numbers, read theirs, or ask?
4. **Where does risk appetite live** — one global setting, or per situation?
