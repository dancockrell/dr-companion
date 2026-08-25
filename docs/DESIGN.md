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
3. **Room panel.** *Done when:* what is in the room is visible without
   scrolling and matches `look`.
4. **Body panel.** Paperdoll from `injuries`.
5. **Scripts + watchdog panel.** *Done when:* a player sees uber has died and
   restarts it without typing, and can see every script's version.
6. **Gear panel and profiles.** *Done when:* a profile can be defined, applied
   and verified — drowning and box-popping both work with no bespoke button.
7. **YAML assistant.** Scan character → propose → form → write → `;validate`.
8. **Workflow editor** over `coordinator_*` keys. Ships with a few prebuilt
   workflows; building your own is the same editor, not a lesser path.
9. **Map to a side dock**, following the character, `go2` as the action.
10. **Situation read-out**, starting with route crossings where `travel.cmd`
    has already published the thresholds.

Steps 1–5 need no new game knowledge. 6–8 are where this becomes a tool people
would choose over typing.

---

## 9. Open questions

1. **Whose thresholds?** `travel.cmd` ships conservative numbers and lets you
   lower them. Ship the same, read theirs, or ask?
2. **Risk appetite** — one global setting or per situation?
3. **How much should it try to see uber?** Genie's uber is not a Lich script, so
   we cannot see it through `Script.list` at all. Do we care about Genie users
   beyond the frontend, or is the Lich suite the audience?
4. **Does the YAML assistant own the file, or propose into it?** Owning it is
   simpler and would overwrite hand-tuning that took someone months.
