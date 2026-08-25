# DR Companion — design

Status: **proposed, not approved.** Nothing here is built.

Every number and file path below was read, not remembered. The point of this
document is that it can be checked and argued with.

---

## 1. The evidence

### The scripts are enormous because the game is exceptional

| Script | Lines / bytes | What it is |
|---|---|---|
| `uber.cmd` (Genie) | 77,867 lines | combat, hunting, selling, town, invasions |
| `travel.cmd` (Genie) | 8,248 lines | routing, ferries, shortcuts |
| `disarm.cmd` (Genie) | 5,517 lines | box popping |
| `uberwatch.cmd` (Genie) | ~120 lines | notices when uber has died |
| `combat-trainer.lic` (Lich) | 277 KB | the dr-scripts equivalent of uber |
| **dr-scripts, all of it** | **222 scripts, 2.75 MB** | the DR Lich suite |

`uber.cmd` carries **2,008 `action` triggers** — not features, things that can
happen to you mid-script: a juggernaut giggling, an ambush choke, arriving
aboard the Mammoth, DragonRealms announcing a server shutdown.

`uberwatch.cmd` exists only because uber dies. It watches for disconnects six
ways, the idle timeout, the script vanishing from `$scriptlist`, an unexplained
`Your worn items are:`, and **the game clock failing to advance**.

**We do not write a better automation engine.** That fight is fought, at a
scale we will not match. What none of those scripts has is an interface.

### Reading, not copying

Community scripts are the map of the game world and should be used hard, for
their *information*. Shroom's work in particular is not community-licensed. We
read to learn what the game does; we do not copy code. This repo stays MIT.

What we *call* is Lich 5 (BSD 3-Clause) and the community scripts as scripts —
started, not vendored.

### Everything we build runs inside Lich

The Ruby bridge is where anything touching the game goes. Rust is the installer
and the window shell and is essentially finished. **If a feature needs new
Rust, that is a signal it is the wrong feature.**

---

## 2. The three things I found that change the design

### 2.1 The script library *is* the feature list

222 scripts. Not a dependency — the product surface. `craft`, `forge`,
`workorders`, `healer`, `burgle`, `pick`, `hunting-buddy`, `inventory-manager`,
`appraisal`, `athletics`, `astrology`, `trade`, `crossing-training`.

Almost every feature I have been sketching already exists as a script written by
someone who plays more than I ever will. The app's job is to make them
**findable, startable, watchable and configurable** — not to reimplement them.

`Script` gives the whole lifecycle:

```
Script.list   Script.running   Script.running?(name)   Script.version(name)
Script.start(name, *args)      Script.run_child(name, timeout:)
Script.pause / unpause / kill / exists?
```

**Travel is the worked example.** `go2` is v2.3.3, maintained by Tillmen with
eight contributors. It resolves **any map tag** as a destination, has
profession-aware targets (`;go2 guild`, `;go2 guild shop`, `;go2 locker`), and
confirms trips over twenty rooms. So the tag vocabulary the map already reads
*is* the destination menu, and go2 does the walking. Our route preview stays,
because showing the way before committing is real value; what follows it is
`Script.start('go2', id)`.

### 2.2 Workflows already exist, and they are YAML

`coordinator.lic`, from its own header:

> Task scheduler that runs hunting, town and cleanup tasks in priority order.
> Tasks and their predicates come from `coordinator_hunting_tasks`,
> `coordinator_town_tasks` and `coordinator_hunting_cleanup` in your yaml.
> Predicates are evaluated against skills and timers, and timers persist in
> UserVars.

The task schema, read out of the source:

```
script  args  action  file  town  walk_to  safe_room  buff  play_song
start_on  stop_on  type  default  skip_first_run  no_cleanup
```

`start_on` and `stop_on` are predicates over skills and timers. That is a
workflow engine with a declarative task list, already written, already
maintained, already scheduling real play.

**So the workflow builder and the YAML editor are the same feature.** A visual
task editor that emits `coordinator_*` keys gives prebuilt workflows, user-built
workflows as a first-class thing, and a large chunk of the YAML problem, without
us writing one line of automation.

### 2.3 The YAML is the actual wall

- `base.yaml` — **2,901 lines, 625 top-level keys**
- `base-empty.yaml` — **~130 collection keys** a player is expected to fill
- `validate.lic` — 51 KB of checking, so it is a known problem
- `edityaml.lic` — 11 KB, an in-game editor already exists

The hard keys are the collections, because that is where nesting, anchors and
merge keys bite: `gear`, `gear_sets`, `storage_containers`, `training_list`,
`training_abilities`, `waggle_sets`, `crossing_training`, `weapon_training`,
`priority_weapons`, and seven separate `*_tools` lists for the crafting
disciplines.

**Most of those are derivable from a logged-in character.** That is the answer
to "how will you help people make their yaml":

| YAML key | Read it from |
|---|---|
| `hometown`, `*_town` | `Map.current.location`, room tags |
| `storage_containers` | `GameObj.containers` |
| `gear`, `gear_sets` | `GameObj.inv` + `DRCI.wearing?` + what is in hands |
| `priority_weapons`, `weapon_training` | weapons found in inventory, `DRSkill` |
| `alchemy_tools`, `forging_tools`, … | inventory scan against known tool nouns |
| `training_list`, `training_abilities` | `DRSkill.list` with ranks and mindstate |
| `waggle_sets` | `DRSpells` known spells |
| `crossing_training` | skills below a rank threshold |

So: **scan the character, propose a YAML, let them correct it in a form, write
it, then run `;validate` and show the result.** Never a blank file and a wiki
link. The novel work is the proposal and the form; the checking already exists.

What we cannot read, we default. `gear_sets` gets a shipped `swimming` set
meaning no armour and nothing heavy, because that is right for almost everyone
and wrong harmlessly. What we can neither read nor sensibly default is left
empty and editable rather than guessed at.

---

## 2.35 The objective function: keep every pool absorbing

This is the point of the whole product and it was missing from the last draft.

DragonRealms does not reward time spent, it rewards *absorption*. Every skill
has a mindstate pool, 0–34. Experience lands in the pool and drains into ranks
over time. A pool at 0 is idle capacity: you are gaining nothing there. A pool
at 34 is mind locked: further work on that skill is thrown away.

So the actual goal is not "run a script well". It is:

> **Do as many different activities per hour as possible, so as many pools as
> possible are holding experience at once.** Total growth over weeks is the area
> under that curve, not the intensity of any one activity.

Which means the interesting question a player asks, constantly, is *"what
should I be doing right now"* — and the answer depends on the whole field of 30+
pools, not on one skill.

### The pieces already exist, unassembled

| Piece | Where |
|---|---|
| The pool, per skill | `DRSkill.getxp(name)` → 0–34 |
| Ranks, per skill | `DRSkill.getrank(name)` |
| ~28 skills trainable in town, cycled | `crossing-training.lic`, 881 lines |
| Weapon, armour, survival skills | `combat-trainer.lic`, 277 KB |
| Alternate hunting and town on a check | `training-manager.lic` |
| General scheduler with predicates | `coordinator.lic` |

`training-manager.lic` already runs the loop, but its decision is one line:

```ruby
def priority_skills_low?
  @settings.training_manager_priority_skills.any? { |skill|
    DRSkill.getxp(skill) <= @settings.priority_skills_lower_limit }
end
```

A binary check against a hand-listed set of priority skills. It works, and it is
invisible: the player cannot see the field it is deciding over, cannot see which
pools are locked and wasting effort, and cannot see which are empty and idle.
The scheduling lives in YAML predicates nobody can read at a glance.

### So the app's core contribution is a mindstate board

Not another trainer. **The picture the schedulers are already deciding over.**

- Every skill, its pool, and which way it is moving.
- **Locked** pools called out — that is effort being discarded right now.
- **Empty** pools called out — that is capacity earning nothing.
- Which activity, meaning which script, feeds which skills.
- Therefore: what to run next to light up the most dark pools.

That last line is the recommendation, and it should be a *suggestion with its
reasoning visible*, not an automatic decision. The player knows what gear and
spells they have and what they feel like doing; the app knows the arithmetic.

It also gives the workflow editor (§2.2) something worth editing. A coordinator
task list stops being an abstract YAML array and becomes "this rotation keeps
these eleven pools full, and leaves these four dark."

### Mapping activity to skills

The one piece nobody has published as data. It can be built from what scripts
declare and the YAML keys that configure them — `crossing-training.lic`'s
handled skill list, `training_list`, `training_abilities`, `weapon_training`,
`magic_training`, `appraisal_training`, `astrology_training` — and corrected by
observation, since we can watch which pools move while a script runs.

Observation is the honest source: it needs no maintenance and it is right for
*this* character. Ship a starting map, learn the rest, let it be edited.

## 2.4 Nothing starts blank, and nothing is fixed

Every character's gear is different, new items arrive constantly, and the nouns
are strange. We cannot ship a table that stays right. So every value in the app
has a **provenance** and is **editable**, and the two are separate concerns.

| Source | Example | Shown as |
|---|---|---|
| **Read** from the game | containers, worn items, hands, skills, spells, hometown | a value |
| **Derived** from what we read | "these three are probably your armour" | a value, marked derived |
| **Looked up** on Elanthipedia | an unknown noun classified as chain armour | a value, marked looked-up |
| **Default** we ship | swimming means no armour, no burden | a value, marked default |
| **Player** set it | anything they touched | a value, marked theirs |

The rule is that **a player edit always wins and is never overwritten**, and
that nothing is ever presented as certain when it was guessed. Provenance is not
a warning — it is a small mark, and the detail is on hover.

### Elanthipedia is queryable, which solves the noun problem

Verified against the live site:

- MediaWiki 1.39.12 with a working `api.php`
- **Semantic MediaWiki** is installed, so `action=ask` returns *structured*
  records, not just page text
- `[[Category:Armor]]|?Armor type|?Protection` returns real rows

So when a character is wearing `a rugged brigandine hauberk` and we do not know
what that is, we can ask, get "brigandine, chain armour", and pre-fill
`default_armor_type` and the gear set correctly.

Constraints that come with that, and they are not optional:

- **Cache locally and permanently.** A noun's classification does not change.
- **Batch and rate-limit.** This is a community wiki run for players, not an
  endpoint to hammer on every inventory refresh.
- **Never required.** No network, no lookup, no problem — the field just falls
  back to derived or blank and stays editable.
- **Always overridable.** The wiki can be wrong or the item unique.

## 2.5 Where information goes

The app currently has explanatory sentences baked under half its panels. That is
the wrong place for them: on a 520×780 window, prose is paid for in the space
the actual thing needed.

- **The panel shows values.** Not sentences about values.
- **Hover carries the detail** — where a number came from, what the threshold
  is, what the noun resolved to, why something is marked derived.
- **No scolding, no warnings** for ordinary states. A field we could not fill is
  empty and editable, not an alert.
- **Errors are different** and still earn their line, because "I could not look"
  has to be distinguishable from "there is nothing there".

Concretely, the copy to remove is the kind I have been writing: "Nothing asked
for yet. Press refresh, or move a room and it will arrive on its own." That is
three lines of chat where an empty state and a hover would do.

---

## 3. What the app is

**A face for the Lich script ecosystem.** Find, install, configure, launch,
watch, and chain other people's scripts — and show enough state that a player
can tell what is happening and step in.

Three jobs, in order:

1. **Show me what is happening**, at a glance, without scrolling.
2. **Let me act** — gear, movement, scripts, stop — without typing.
3. **Tell me when it has gone wrong**, which is the failure mode of the genre.

---

## 4. First run: the dependency page

One page, one list, a green tick or a red cross against each, then an offer to
install everything missing. No prose wall.

| Checked | How | Fix |
|---|---|---|
| Ruby 4.0+ | on PATH, then on disk | Ruby4Lich5 installer |
| Lich 5 | `lich.rbw` in the usual places | Ruby4Lich5 or `lich-5.zip` |
| Frontend | Genie / Wrayth / Frostbite / Saga / … | offer Genie 4 |
| **Map database** | `map-*.json` under `DATA_DIR` | **`;repository download-mapdb`** |
| **dr-scripts suite** | scripts present in `scripts/` | `;repository download <name>` |
| **Per-script** | `Script.exists?` + `Script.version` | download or update |
| Bridge script | ours | copy it in |
| Genie plugins / maps | only if Genie | verified bundles |

Two of those are new and both matter. The map database does **not** arrive with
Lich — it comes from `;repository download-mapdb`, which is why there is no
`map-*.json` on this machine and why the map panel has nothing to draw. And the
script check is what turns "install the app" into "install the app and have
everything the community uses".

Consent is unchanged and already documented in `SETUP-POLICY.md`: show what,
from where, how big, and where it lands. Downloading and running stay separate.

---

## 5. What earns the screen

520×780 by default. Ranking comes from what a player does, not what is easy to
draw.

**Tier 1 — always visible**

- **Room** — creatures with per-creature status, dead ones, other players.
  `GameObj.npcs` + `npc_status`, `DRRoom.dead_npcs`, `DRRoom.pcs`. Biggest
  current gap; looked at most often.
- **Body** — wounds by location, not a health number. A bleeding head and a
  bleeding leg are different emergencies. `XMLData.injuries` has 16 parts at
  severity 0–3 — a paperdoll already, in less space than three bars.
- **Stop.**

**Tier 2 — resizable, dockable**

- **Scripts + watchdog** — running, paused, dead, with versions; start, pause,
  stop. Plus the game clock and last command. This is `uberwatch.cmd` as a
  panel, and it is the thing an existing uber user would install this for.
- **Map** — sized to follow movement, hazards coloured, `go2` as the action.
- **Gear** — hands, worn, gear sets, weapon swap by skill.

**Tier 3 — on demand**

- Workflow editor, YAML assistant, skills, healer scoring, hunt ranking.

Healer rankings and hunt scores currently sit mid-screen in Power. They are
decisions made every few hours and should not outrank the room you are in.

---

## 6. The situation model

Avoid a button called "wear swimming armour"; there is no end to those. Four
cases from four scripts share one shape:

| Situation | Requirement | Modifiers | If it fails |
|---|---|---|---|
| Swim the Segoltha | Athletics ~565 | burden, armour, buffs, strength | stuck, possibly dead |
| Pop a box | appraisal vs trap difficulty | helmet and gloves off | acid, wounds, ruined armour |
| Burgle in town | stealth vs guards | hidden, buffs, rope | **jail** — fine and dead time |
| Burgle in a clan | same | same | **maimed** — walk to an empath |

`travel.cmd` publishes three numbers per crossing — *possible* with no burden or
armour, *safe*, and a conservative shipped default — plus a tunable risk
appetite. `disarm.cmd` picks its mode (Blind, Quick, Normal, Careful) from
measured difficulty and bins the box when the sum is bad.

> **A Situation is a requirement, modifiers you control, a risk band, and a
> consequence with a recovery cost.**

The burgle pair proves the consequence half matters as much as the odds:
`burgle.cmd`'s `JAIL:` handler is a loop kicking a dust pile forever, while
`CLANJUSTICE:` prints "go heal yourself" and exits clean. Same crime, same odds,
wildly different cost — so *where* you do a risky thing is a real decision, and
nothing helps make it.

Interface consequence: **gear profiles, not per-case buttons** — Lich already
has `EquipmentManager#wear_equipment_set?` and dr-scripts already has a
`gear_sets` YAML key — plus a **readiness read-out** saying where you stand,
what would move the number, and what being wrong costs.

---

## 7. What we write, and what we call

1. **A script already does it** → start it, watch it, report.
2. **Lich has the primitive** → call it.
3. **Genuinely absent** → `companion_bridge.lic`, and the bar is high.

By that test the bridge legitimately owns: reading state into one shape;
the runaway detector, because nothing else stops a loop the player cannot see;
roundtime, stun and refusal handling on anything we do send; reading dr-scripts
YAML; and writing YAML the player approved in a form.

---

## 8. Build order

Each step is one bridge topic plus one panel, shippable alone.

1. **Panels move and resize.** `Panel.tsx` and `lib/layout.ts` exist and almost
   nothing uses them. *Done when:* every panel moves, resizes, collapses, and
   the arrangement survives a restart.
2. **Dependency page extended to scripts and the map database.**
   *Done when:* a fresh machine reaches a working dr-scripts install without
   the player typing a `;` command.
2a. **Mindstate board.** Every pool, locked and empty called out, and which
   script feeds which skills. This is the reason to install the app.
   *Done when:* a player can see at a glance where growth is being wasted.
3. **Room panel.** *Done when:* what is in the room is visible without
   scrolling and matches `look`.
4. **Body panel.** Paperdoll from `injuries`.
5. **Scripts + watchdog panel.** *Done when:* a player sees a script has died
   and restarts it without typing, and can see every script's version.
6. **Gear panel and profiles.** *Done when:* a profile can be defined, applied
   and verified — drowning and box-popping both work with no bespoke button.
7. **YAML assistant.** Scan character → propose → form → write → `;validate`.
   *Done when:* a new character reaches a valid profile without opening a text
   editor, every proposed value shows where it came from, and every one of them
   can be changed.
7a. **Noun lookup.** Elanthipedia SMW, cached locally, batched, never required.
   *Done when:* an unknown worn item resolves to an armour type without the
   player being asked what it is.
8. **Workflow editor** over `coordinator_*` keys. Ships with a few prebuilt
   workflows; building your own is the same editor, not a lesser path.
9. **Map to a side dock**, following the character, `go2` as the action.
10. **Situation read-out**, starting with route crossings where `travel.cmd`
    has already published the thresholds.

Steps 1–5 need no new game knowledge. 6–8 are where this becomes a tool people
would choose over typing.

---

## 9. Decisions

Settled, no longer open.

1. **Thresholds.** Ship `travel.cmd`'s conservative numbers as defaults. Every
   one of them gets a field in settings. The defaults live in a script settings
   file with the blanks already filled, so nobody starts from nothing and
   anybody can change anything.
2. **Risk is per situation, and the player chooses.** Not one global dial. They
   know what gear, spells and buffs they have; we do not, and a single number
   would pretend otherwise.
3. **Lich scripts only.** Genie's uber is not a Lich script and we will not try
   to see or drive it. Genie remains supported as a *frontend* — that is the
   comma-prefix work, which stays — but the script ecosystem we integrate with
   is Lich's.
4. **YAML owns the profile.** The assistant proposes and writes into it; the
   file is the source of truth and dr-scripts keeps reading it. We do not
   maintain a parallel store that could disagree with what the scripts run on.

### What is still genuinely unknown

- The activity-to-skill map (§2.35). Nobody has published it as data. Plan is to
  ship a starting map from what the scripts declare, then correct it by watching
  which pools actually move.
- Whether the mindstate board should ever *act* on its recommendation, or only
  ever suggest. Starting position: suggest, with the reasoning visible.
