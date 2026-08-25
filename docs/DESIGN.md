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

## 2.35 The objective function, and what the app is actually for

DragonRealms rewards *absorption*, not time. Every skill has a mindstate pool,
0–34. Experience lands there and drains into ranks. A pool at 0 is idle
capacity. A pool at 34 is mind locked and the effort is being discarded. So
growth over weeks is the area under the curve of how many pools are absorbing at
once, not the intensity of any one activity.

**Scripting is not a shortcut around this, it is the only way to play at the
modern scale**, and building good rotations is itself part of the game and part
of the fun. That fact sets the app's posture: it is an instrument for people
whose hobby is tuning their scripts, not a replacement for scripting.

### Correcting my own framing

A first draft of this section said the job was to find dark pools and light
them. That is wrong, and the correction matters:

> A moderately good script already keeps **40-plus skills in mind at once**,
> once it has filled the basic pools over the first hour.

If forty pools are already lit, "which pool is empty" is not the interesting
question — a competent rotation has already solved it. The interesting questions
are the ones nobody can currently see an answer to:

- Is this rotation actually earning more than the one I ran last week?
- Which skills is it *starving* — lit, but barely moving?
- Which are locking, so that portion of the hour is wasted?
- Did that change I made help, or did it just feel better?

That is a measurement problem, and it is unowned. Nothing in the 222-script
suite shows the field or reports throughput. `expreset.lic` resets the baseline
and that is the whole of it.

### Measure, do not model

Drain rates differ by guild. Different guilds need different skills. One player
has a legendary weapon and another does not. Any table of expected rates we
shipped would be wrong for most characters and unmaintainable for the rest.

We do not have to model it, because Lich already measures it:

| What | Call |
|---|---|
| Current pool, 0–34 | `DRSkill.getxp(name)` |
| Ranks, and buffed ranks | `DRSkill.getrank` / `getmodrank` |
| Progress within the rank | `DRSkill.getpercent(name)` |
| **Ranks gained this session** | `DRSkill.gained_exp(name)` |
| Which skills just moved | `DRSkill.gained_skills` |
| Session baseline | `DRSkill.start_time` |
| Rested experience, and whether it is live | `rested_exp_usable`, `rested_active?` |

`gained_exp` against `start_time` is **measured ranks per hour, per skill, for
this character, with this guild and this gear.** No theory required, and it is
automatically right about the legendary weapon.

Rested experience deserves its own line: it is a multiplier with a finite pool,
and spending it on the wrong rotation is a real and invisible loss.

### So the app's contribution is instrumentation, then tuning

1. **The board** — every pool, and for each one whether it is locked, starving
   or healthy. The picture the schedulers already decide over and nobody can
   see.
2. **Throughput** — measured ranks/hour per skill, per rotation, per session.
3. **Comparison** — this rotation against that one, on the same character.
   This is the feature a script-builder would install the app for.
4. **Suggestion, last and optional** — with its arithmetic visible, never an
   automatic decision. The player knows about the legendary weapon, the guild,
   and what they feel like doing tonight.

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

It also gives the workflow editor (§2.2) something worth editing. A coordinator
task list stops being an abstract YAML array and becomes a rotation you can
measure, change, and measure again.

### Mapping activity to skills

The one piece nobody has published as data. It can be built from what scripts
declare and the YAML keys that configure them — `crossing-training.lic`'s
handled skill list, `training_list`, `training_abilities`, `weapon_training`,
`magic_training`, `appraisal_training`, `astrology_training` — and corrected by
observation, since we can watch which pools move while a script runs.

Observation is the honest source: it needs no maintenance and it is right for
*this* character. Ship a starting map, learn the rest, let it be edited.

## 2.36 The curve, and why breadth beats depth

Reaching level 150 is roughly **a year of constant scripting**. The experience
curve hardens as you climb, and drain slows with rank — and slows further for
skills that are secondary or tertiary for your guild.

Which produces the strategy the whole game is played around:

> **Raise every skill your guild can raise, and keep them all in mind.** You
> need them all to survive, and slow movement across forty skills beats fast
> movement across five.

Two consequences for the app.

**The drain rate is a function of rank and of guild tier**, not a constant.
`DRSkill.getskillset` gives the category — Weapon, Armor, Magic, Survival,
Lore — but the primary/secondary/tertiary tier is a property of the *guild*,
and it is what governs how fast a pool empties. We do not have to model it, per
§2.35, but we do have to stop presenting all pools as comparable. A tertiary
skill sitting at 20 is not underperforming; that is what tertiary looks like.

**Crafting is the deliberate exception.** It absorbs so much time that it
suppresses overall skill growth, and the game pushes specialisation there
anyway. So a rotation that trains crafting is making a real trade, and the app
should show that trade rather than treat crafting like any other skillset.

There is a wrinkle worth surfacing rather than hiding: **items exist that keep
crafting moving cheaply, and people pay a great deal for them.** A character who
has one is playing a different optimisation to a character who does not. That is
exactly the kind of thing the player knows and we cannot, which is why §2.35
ends with measurement and suggestion rather than a plan.

## 2.37 What the community knows about items, and where to get it legitimately

Shroom's scripts are where a lot of hard-won item and creature knowledge lives.
It is encoded as recognition vocabulary rather than as tables. From `uber.cmd`:

- a **1,569-character** armour regex that knows bare `plate` is armour while
  `plate gauntlets`, `greaves`, `helm`, `mask` and `balaclava` are separate
  pieces, and lists the adjectives that qualify — `fluted`, `lamellar`,
  `Imperial`, `kiralan`, `jousting`, `icesteel`, `goffered`
- **2,550 characters** of ritual-eligible creatures
- **2,141 characters** of creatures that cannot be skinned
- **1,656 characters** of living versus non-living creatures

That last distinction is not trivia — it decides whether a skinning step or a
ritual step is worth attempting at all.

**We do not copy any of it.** It is not community-licensed. What it gives us for
free is the *shape of the problem*: which categories a player actually needs an
item classified into. Armour piece and type. Skinnable or not. Living or not.
Ritual-eligible or not.

Then we build our own data against a source we may use — Elanthipedia's Semantic
MediaWiki, per §2.4 — and cross-check the two. Where they disagree, the player
decides, and their answer is remembered.

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

### Tooltips must be dynamic, or they are noise

A tooltip that says the same thing forever is telling the player something they
learned the first time and will now read past every time. It has become
decoration that costs a hover.

So a tooltip earns its place only by saying something about **now**:

| Static, therefore useless | Dynamic, therefore worth reading |
|---|---|
| "Mindstate is 0–34." | "Locked for 6 minutes. That is about 40 ranks of nothing." |
| "Athletics affects swimming." | "565 needed here. You have 540, or 580 without the hauberk." |
| "This is a hazard room." | "Two scripts have died here this week." |
| "Shows worn items." | "Brigandine — chain, per Elanthipedia. You have not corrected this." |

The three tiers, then:

- **Status bar** — small, always true, glanceable. Identity, connection, the
  one or two numbers that matter continuously.
- **Panel** — values you are working with right now.
- **Tooltip** — the reasoning, the provenance, the threshold, the history. Only
  if it changes.

And the rule underneath all three: **do not spend space on what we already
know.** If a value never changes and the player has seen it once, it is not
worth a line.

### Suggestions are offered, never enforced

**The player is always right.** They know about the legendary weapon, the guild,
the crafting item they paid a fortune for, and what they feel like doing
tonight. We may suggest, in a tooltip, with the arithmetic visible. We may not
nag, block, or re-suggest something they declined.

---

## 2.6 One player, several characters, several accounts

People run multiple accounts at once — commonly several free ones, so they have
their own healer bot or a mule. That is normal practice, not an edge case, and
it has consequences the app has to answer for.

**Character identity is load-bearing.** It belongs in the status bar, always
visible, because the first question in front of four windows is *which one is
this*. Getting that wrong means sending a command to the wrong character.

What follows:

- **One bridge per Lich instance, on its own port.** The bridge already accepts
  a port argument (`;companion_bridge 7500`), so this works today — but the app
  currently assumes one connection on 7415 and needs to stop.
- **Settings are per character, keyed by name and instance.** Already true of
  profiles; needs to be true of everything, since a healer bot and a hunter
  share almost no configuration.
- **The window should be identifiable at a glance** — character name in the
  title bar, so the taskbar is usable when four are open.
- **A free-account bot is a different shape of player.** It is not levelling; it
  is waiting to be useful. A mindstate board is close to meaningless for it,
  while connection health and "did it die" are everything.

The last point is worth taking seriously rather than dismissing: the person
running four F2P healers is exactly the person for whom the scripts + watchdog
panel is the entire product.

---

## 2.7 The battle view

A combat screen, kept simple, built from data we already have.

- **Enemy cards**, one per creature, beside the character. `GameObj.npcs` with
  `npc_status` gives name and state; `DRRoom.dead_npcs` gives the corpses.
  Eventually a picture per creature type, keyed on the noun.
- **The character**, as a picture the player supplies. Their own art, their own
  character. Cheap to build and it is theirs.
- **Wounds as a separate paperdoll**, not painted on that picture. Sixteen
  locations at severity 0–3 from `XMLData.injuries`, laid out as a body. Keeping
  them separate is the better call: the portrait can be anything, and the wound
  display has to stay readable at a glance.

This is not decoration. Reading "a wolf, a wolf, a badly wounded wolf" out of a
scrolling text feed is the thing players actually struggle with, and three cards
answer it instantly.

## 2.8 Loops: a library, not one big loop

Shroom's model is one enormous loop that does everything. It works, and it is
not the most fun arrangement.

> **One big loop, plus a set of smaller loops you can choose from.**

A survival loop, a lore loop, a gathering loop. And the good part: while running
a lore loop, opportunistically fit in survival — pick up coins, rocks, grass;
branches when grass is unavailable. Small, level-appropriate, and it keeps
another pool absorbing while you are doing something else. That is §2.35's
objective made concrete and playable.

**The starter loops matter most.** Two worth shipping:

- **Branches to Mags**, for a level 0 character. Collect branches, hand them in.
  It is small, it works from nothing, and it teaches the shape of a loop.
- **Donation-shelf gear run**, for under level 20. Visit donation shelves and
  chests, rummage, and assemble a light but decent kit that trains every skill.
  The inverse — a donation loop that gives back — is the same machinery.

Much of this exists already, which is the point of §2.1:

| Loop piece | Script |
|---|---|
| Scavenge a starter kit | **`newbie-gear.lic`**, 167 lines |
| New character setup | `new-character.lic` |
| Foraging | `task-forage.lic` |
| Wood, mining, rummaging | `chop-wood`, `mine`, `mining-buddy`, `rummage` |
| Town skill cycling | `crossing-training.lic` |
| Combat | `combat-trainer.lic` |
| Scheduling | `coordinator`, `taskmaster`, `schedule`, `multi`, `t2` |

So a loop is **a named, ordered set of script calls with conditions** — which
is exactly the `coordinator` task schema from §2.2. The library is a set of
those, shipped, editable, and shareable. Building your own is the same editor.

## 2.9 Direct manipulation

Inventory is a list of things you should be able to click.

- **Ready a weapon** with one click. Swap to the offhand, or put it away.
  `EquipmentManager#wield_weapon?`, `swap_to_skill?`, `stow_weapon`.
- **Shield on, shield off.**
- **Armour pieces on and off, on the fly, from the front page.** Not buried in
  settings — the front page, because this is the thing someone opens the app for
  mid-fight and mid-box.

`weararmor.lic` is **fifteen lines** and takes a gear set name. So the whole
feature is `Script.start('weararmor', set)` plus a list of the sets, and the
per-piece work is `DRCI.wear_item?` / `remove_item?`.

That is worth saying plainly: **the armour panel is nearly free and it might be
the reason people keep the app open.** It is the shortest path from nothing to
something nobody else offers.

## 2.10 The controls

One control to start, one to stop. Everything else is a modifier.

- **Start main loop** / **Stop all.** One button each. Not a menu of eleven
  scripts.
- **Pause.** Keeps position and state; resumes where it was.
- **Snooze** — the one worth designing carefully. It means *I am leaving the
  keyboard*. It is not pause; it is "stay alive without me".

**Snooze has to try to keep you safe**, because that is the entire point:

- watch for danger arriving and leave rather than fight
- retreat to `safe_room` — `gosafe.lic` is fifteen lines and already does this
- heal or tend if hurt — `healme`, `tendme`
- disconnect as the last resort, if it is taking damage and cannot get out

Every one of those is somebody else's script. We sequence them.

**And every part of it gets a toggle**, because "disconnect me automatically" is
a kindness to one player and an outrage to another. The rule: anything the app
does *on the player's behalf without asking* must be switchable off in settings,
and default to the kinder option.

## 2.11 Setup should be a pleasure, not a form

The out-of-box experience is where this is won or lost.

The principle from §2.4 applies hardest here: **we know what is in their
inventory, so never ask them to type it.** When someone fills in their armour
pieces, the field is a dropdown of the armour they are actually wearing and
carrying. When they set a weapon, the list is their weapons. When they pick a
container, it is their containers.

That turns the worst part of dr-scripts — a 625-key YAML and a wiki tab — into
picking from lists of things they recognise, because they own them.

## 2.12 The map has to beat Genie's

Genie's automapper is fifteen years old and it is the incumbent. If ours is
merely present, nobody switches — they already have one that works.

What we have to beat it with:

- **Live position**, following the character without being asked.
- **Hazards visible** — the rooms that break scripts, coloured, because that is
  what a player is watching for.
- **Route preview before committing**, then `go2` to walk it.
- **Tag-based destinations** — every tag in the map is a place you can go, which
  is the vocabulary `go2` already accepts.
- **Sized to be watched**, docked, not a thumbnail and not a window you lose
  behind the game.
- **Both room ids**, labelled, because that is the thing people paste at each
  other in help channels.

That is a beatable target. A fifteen-year-old system is a high bar for polish
and a low one for ideas.

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

Note the console is deliberately not demoted. It is the best thing in the app
already: it shows what was sent and what came back, which is the only honest
answer to "why did it stop". Lean on it rather than inventing status prose.


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
2a. **Mindstate board and throughput.** Every pool with locked and starving
   called out, plus measured ranks/hour per skill from gained_exp against
   start_time. Rotation-to-rotation comparison on the same character. This is
   the reason a script-builder installs the app.
   *Done when:* a player can change their rotation and see whether it earned
   more, rather than whether it felt better.
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
11. **Battle view** — enemy cards beside the wound doll, player portrait.
12. **Loop library** — starter loops shipped, including branches-to-Mags and
    the donation-shelf gear run, all editable in the same editor as step 8.
13. **Snooze**, sequencing gosafe, healme and tendme, every part toggleable.

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
