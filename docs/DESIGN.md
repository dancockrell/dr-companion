# DR Companion — design

> **Historical design — superseded for new work (5 September 2026).** This is the original companion-panel proposal. Its scope and implementation-status claims are historical. Use the [current world-board strategy](THREE_D_WORLD_STRATEGY.md) and [working implementation plan](PLAN_TO_1_0.md). The body is retained for design rationale and regression evidence; historical claims of completion do not certify the current build.

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

## 1.5 Who this is for

Mid-forties to sixty. Highly educated. At least moderately technical and
usually very. They are here for the depth — there has still never been anything
close — or for the reading, or for the scripting itself. And it is an open
source community: they will read the source, and some of them wrote the scripts
we are calling.

That is an unusually specific audience and it settles several arguments.

### They will read the code, so the code is the pitch

No marketing voice anywhere. No "seamlessly", no "powerful", no exclamation
marks. Say what a thing does and what it costs. This document is written that
way on purpose and the codebase should match: comments that explain the decision
rather than restate the line, commit messages that give the reasoning.

The corollary is that **the repository is the work sample**, and a good one in
this community is worth more than any description of it.

### Do not hide the knobs

This is not an audience that needs a wizard standing between them and a
setting. They are the people who hand-write 625-key YAML today. Defaults and
autofill are welcome because typing item nouns is tedious, not because the
detail is beyond them.

So: sensible defaults, everything visible, everything editable, nothing locked
behind "advanced". And when we make a choice for them, show the arithmetic.

### Type size is an accessibility requirement here, not a preference

Presbyopia starts around forty and is near-universal by the mid-fifties. This
audience is squarely in that band, and they are reading at desk distance on
high-resolution monitors, next to a game window they have already had to size up.

Measured across the current UI:

| Size | Declarations |
|---|---|
| 10px | 47 |
| 11px | 53 |
| 12px (`text-xs`) | 73 |
| 14px (`text-sm`) | 19 |
| 16px+ | 4 |

**173 of 196 are 12px or smaller.** That is not dense, it is unreadable for a
large share of the people it is aimed at, and it is the kind of thing that gets
an app closed and never reopened without the reason ever being stated.

Rules from here:

- **12px is the floor**, not the default. Anything below that is a bug.
- **14px for anything read continuously** — values, names, numbers that matter.
- **Type scale is a setting**, because eyes differ and this audience knows it.
  One control, applied globally, remembered.
- **Contrast is checked, not eyeballed.** The palette already runs muted greys
  on near-black; `--color-ink-faint` on `--color-surface` needs measuring
  against WCAG AA and fixing where it fails.

This costs screen space, which §2.115 says is competitive. That tension is real
and resolves in favour of legibility: space we cannot read is not worth having.

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
the wrong place for them: prose is paid for in space taken from the game window
next to us, which is the space the actual thing needed. See §2.115.

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

## 2.115 Screen space is competitive, and it is earned

Genie is resizable. So is every frontend. The app does not sit alone on a
monitor — it sits *next to the game*, and every pixel it takes is a pixel the
game window does not have.

> **The better we are, the more screen real estate we are worth against Genie.**
> That is the honest arrangement, and it is continuous rather than settled once.

This corrects a framing used throughout earlier drafts of this document.
"520×780" is not a constraint to design within. It is the width a player gives
an app they are not yet sure about, and it should grow when we earn it.

What follows:

- **No layout may assume a width.** Not 520, not anything. A narrow strip beside
  a maximised Genie and a half-screen panel are both normal.
- **Density adapts.** Narrow: vitals, room, stop. Wide: the map big, enemy cards
  beside the doll, the mindstate board readable. Same panels, different
  allocation — not a separate "wide mode" to maintain.
- **Every panel is optional and movable**, because the player decides what is
  worth their pixels, and two players will not agree. Someone wants the map at
  the top; someone else never looks at it and wants gear there.
- **Dead space is a bug.** If a panel is not earning its area at the current
  width, it should shrink or go, not sit half-empty.
- **Nothing hides behind a size.** If a feature only works at 1200px it is a
  feature most people will never see.

The practical test for any panel: *would I give up game window for this?* If the
answer is no at any width, it does not belong on the front page.

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

## 2.13 Make it look like a game

The strongest idea in this design and the one most likely to get it installed.

### Every room description is already a prompt

They were written to put a picture in your head — that is their entire job in a
text game. From `Map1_Crossing.xml`, untouched:

> The whitewashed building before you is stark and functional. A sign mounted on
> it is hand painted and carved with cunning skill. White-robed figures and all
> manner of injured and infirm people stream in and out of a double door,
> leaving thin trails of blood on the spotless pavement.

That needs no rewriting to be fed to an image model. Measured across the map
set:

| | |
|---|---|
| Rooms | **18,490** |
| Descriptions | **23,335** |
| Distinct room names | 8,053 |

The name is a label — "The Crossing, Magen Road" repeats down a whole street.
**The description is the scene.** There are 23,335 of them, but only **16,395
are distinct**: 4,863 are day and night variants of a room already counted, and
2,077 rooms simply repeat prose another room already uses. So
the art is keyed to descriptions, not names.

The gap between 18,490 and 23,335 is mostly day and night variants, already in the map
data. Roughly 4,800 rooms come with two descriptions, which means **the art can
change with time of day for free.**

### Three tiers of image, in order of cost

1. **Enemy cards.** A few hundred creature types — one of Shroom's three tables
   alone holds 166. Bounded, reusable, and the highest value per image, because
   "what is in this room" is the question being asked constantly.
2. **Character portrait.** Supplied by the player. Zero generation, entirely
   theirs, and people care more about their own character than about anything we
   could draw.
3. **Room art.** 18,490 images, or 16,413 if rooms sharing identical prose
   share an image. The big one, and the one nobody has done.

### Why this is not decoration

The argument is not that graphics are nice. It is:

> There is a great deal of text flying past, and keeping aware of it is hard
> work. Images make awareness cheap. Cheap awareness frees attention. Freed
> attention gets spent on talking to people — and talking to people is what
> keeps anyone in a MUD for thirty years.

That is a retention argument, and it is the one that matters. It also happens to
be the honest answer to the demographic problem: this game has never had
anything close to it for depth, and its audience is ageing. Something that feels
like a minimally graphical game — not a picture window, but close — is how the
depth reaches people who will not start with a wall of prose.

### What has to be got right

**Consistency.** The same room must look the same for everyone, or two players
comparing screenshots see different worlds. That means a fixed seed derived from
the room, and ideally a shared pack rather than everyone generating their own.

**Quality.** Bad generated art is worse than none. It needs curation, a way to
regenerate a room you dislike, and a switch that turns the whole thing off.

**Scale.** 18,490 images is a real job even on good hardware. It runs once,
offline, and ships as a downloadable pack like the map database — which is
already the pattern players know from `;repository download-mapdb`.

### Who this goes to

An earlier draft of this section treated the art as a rights problem. It is not
one, on two counts.

An image generated from a description is not a derivative of that text in any
meaningful sense — it is a different medium and an independent expression, not a
translation or an adaptation of the prose.

And more decisively: **the intended recipient is Simutronics, for free.** They
own the source text. Art made from their descriptions and handed to them is
theirs to distribute, sell, ship in a client, or ignore. There is no permission
to seek from the party you are giving it to.

So the design question is not "may we", it is **"is this in a state they could
actually take"**, which is a more demanding standard and a better one:

- **The pipeline must be reproducible**, not a one-off run on one machine.
  Prompt construction, model, seed and settings documented well enough that
  somebody else can regenerate the whole set and get the same images.
- **Seeds derive from the room**, so regeneration is deterministic and a
  handover does not mean re-curating 18,490 images.
- **The generation step is separable** from the app. A pack that only works
  inside our panel is worth less to them than a pack.
- **Local generation still ships**, because it makes the app work on day one
  without waiting on anybody, and because a player who wants their own look
  should have it.

That last point is the practical default regardless of what Simutronics does:
generate locally, cache permanently, and treat a shared pack as an optimisation.

## 2.14 Help that fades

Two audiences at once: people who have played for thirty years, and people we
want to bring in who have never seen a MUD. The current answer — the same
explanatory sentence under every panel, forever — serves neither.

**People learn.** Guidance that was welcome on day one is clutter on day thirty,
and it is still occupying the space §2.115 says we have to earn.

So help decays:

- **Basic and Power** is the coarse control, and it is genuinely useful for
  onboarding rather than being a density preference. Basic explains; Power
  assumes.
- **Within Basic, hints retire themselves.** A hint attached to a control the
  player has used a dozen times has done its job. Stop showing it.
- **Anything retired stays available on hover**, per §2.5, so nothing is lost —
  it just stops taking vertical space from someone who no longer needs it.
- **Nothing important is only a hint.** If it matters, it is a value or a
  control, not a sentence that will one day disappear.

The new-to-DragonRealms case deserves its own path rather than a longer version
of the same screen: the first hour is about not being lost, and §2.8's starter
loops — branches to Mags, the donation-shelf gear run — are a better tutorial
than any text, because they are the game.

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

Ranking comes from what a player does, not from what is easy to draw — and it
has to hold at any width, because the window is only as wide as we have earned
(§2.115).

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

Note this is now a three-way test, with §7.5: a script if it stands alone, the
bridge if it is only plumbing for our UI, and neither if somebody has already
written it.

By that test the bridge legitimately owns: reading state into one shape;
the runaway detector, because nothing else stops a loop the player cannot see;
roundtime, stun and refusal handling on anything we do send; reading dr-scripts
YAML; and writing YAML the player approved in a form.

---

## 7.5 What we write, we write as scripts, and publish

`companion_bridge.lic` must not grow into a second monolith. Anything with a
life of its own becomes its own script, called by the bridge and published
separately.

**The test:** *would this be worth installing if the panel did not exist?*
If yes, it is a script. If it only makes sense as plumbing for our UI, it stays
in the bridge.

By that test, three things are scripts rather than bridge code:

| Script | Why it stands alone | Status in the ecosystem |
|---|---|---|
| **exp / throughput tracker** | measured ranks per hour per skill, §2.35 | nothing does this; `expreset` only resets a baseline |
| **safe AFK / snooze** | leave the keyboard without dying, §2.10 | pieces exist (`gosafe`, `healme`, `tendme`); the sequencing does not |
| **YAML generator** | scan a character, propose a profile, §2.3 | `validate` checks and `edityaml` edits; nothing *writes* one for you |

Each is useful to a Lich player who never installs our panel. That is the
point. It keeps the work maintainable, it puts each piece in front of people who
know more about this game than we do, and it means the useful parts survive even
if the panel does not.

### How they ship: reach decides, not licence

Lich installs from arbitrary repositories. `add_custom_repo('owner/repo')`
fetches from GitHub and installs into `scripts/custom/owner-repo/`, through the
same update path players already use.

Two routes, and the licence follows from whichever puts the script in front of
more players:

- **Upstream into `elanthia-online/dr-scripts`** — GPL-2.0, their repo and their
  terms. 58 stars, **193 forks**, and already installed on every machine running
  the DR suite. Far the widest reach.
- **Our own repo as a custom repo** — MIT, installs the same way, but the player
  has to hear about it first.

**Default: offer it upstream, and their licence is fine.** See §7.6 — the goal
is adoption and attribution rather than control, so a GPL-2.0 script sitting in
the suite everyone already has beats an MIT script nobody finds.

Our own repo is the fallback for anything that does not fit their suite or that
they would rather not carry.

### Why this is worth the extra work

Lich was chosen because it has the best community support in this game. Taking
from that and giving nothing back would be a poor trade and a worse look.
Publishing small, genuinely useful scripts is how anyone earns standing here,
and it happens to be the same act as making the codebase maintainable.

It also sets the quality bar. These will be read by people who have maintained
DR scripts for years. That is the audience to write for.

---

## 7.6 Give it away, and be visible doing it

The licensing questions above all resolve the same way, so they are settled here
once rather than argued per-artifact.

**The goal is adoption and attribution, not control.** Give the software away.
Give the art to Simutronics. Take whatever licence the receiving project prefers.
None of that costs anything worth keeping, and all of it increases the number of
people who use the work and know who wrote it.

That inverts the usual tradeoff. Normally a licence protects the author's
position; here the author's position *is* how widely it spreads.

### What that actually requires

Giving work away only pays if it stays attached to a name, which means
attribution is a technical task and not a modesty question.

**Follow the community's own header convention**, which Lich parses and which is
how this ecosystem has always credited people. From `go2.lic`:

```
            author: Tillmen (tillmen@lichproject.org)
   original author: Shaelun
      contributors: Deysh, Doug, Gildaren, Sarvatt, Tysong, Xanlin, ...
              game: any
              tags: core, movement
           version: 2.3.3
          required: Lich >= 5.12.0
```

`Script.version` reads `version:` out of that block, so the header is required
anyway — and the same block carries the author line. Every script we publish
uses it, filled in properly.

The same applies to the repository: a README that says who built it and why, and
commit messages that show the reasoning. §1.5 already said the repo is the work
sample; this is the part that makes the sample legible as *someone's*.

### And it changes what "finished" means

If the repository is the artifact, **ten things done well beat forty half-built
ones.** A reader who opens this and finds a working, tested, documented mindstate
tracker learns more than one who finds sketches of eleven features.

So the build order is a commitment rather than a wish list: finish a step, prove
it, ship it, then start the next. Anything abandoned half-done should be removed
rather than left as evidence of abandoning things.

That is also the only part of the outcome this document can affect. Whether it
leads anywhere is not something a design decides; whether the work is worth
finding is.

---

## 8. Build order

Each step is one bridge topic plus one panel, shippable alone.

0. **Type and contrast pass.** 12px floor, 14px for anything read continuously,
   a global type-scale setting, and a contrast audit against WCAG AA.
   *Done when:* nothing renders below 12px and the scale control works.
1. **Panels move and resize, at any window width.** `Panel.tsx` and
   `lib/layout.ts` exist and almost nothing uses them.
   *Done when:* every panel moves, resizes, collapses, the arrangement survives
   a restart, and the layout is usable from a narrow strip beside a maximised
   Genie up to half a screen — with no dead space at either end.
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
11a. **Creature art** for the enemy cards. A few hundred images, bounded, the
    highest value per image because "what is in this room" is asked constantly.
11b. **Room art** from descriptions, generated locally and cached. 23,335
    prompts already written, day and night variants included.
    *Done when:* the pipeline is reproducible from documented prompt, model and
    per-room seed, so the whole set can be regenerated by someone else — which
    is what makes it handover-ready.
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
---

# Part II — Panel specifications

The sections above decide what to build and why. These decide *exactly* what
each panel shows, where every value comes from, and what it does when the value
is missing — because the cost of vagueness here is a build-and-revise cycle, and
the cost of precision is a paragraph.

Every field below was checked against Lich 5.20.1 on disk. Where something is
not available, that is stated rather than left to be discovered later.

## S1. Room panel — enemy cards

### Where the data comes from, exactly

Two sources, and they are not interchangeable.

| Source | Shape | Use it for |
|---|---|---|
| `DRRoom.npcs` | `Array<String>` — cleaned display names | living creatures, in room order |
| `DRRoom.dead_npcs` | `Array<String>` | corpses |
| `DRRoom.pcs` | `Array<String>` | other players |
| `DRRoom.pcs_prone` / `pcs_sitting` | `Array<String>` | posture of those players |
| `DRRoom.group_members` | `Array<String>` | who is with you |
| `GameObj.npcs` | `Array<GameObj>` — `id`, `noun`, `name`, `status`, `type` | the noun, for art keying |

`DRRoom` gives strings. `GameObj` gives objects. The card needs both: the
display name comes from `DRRoom`, the **noun** — `goblin` out of
`a snarling goblin` — comes from `GameObj` and is what art is keyed on.

### How Lich decides something is a creature

`extract_npcs` in `drinfomon/drdefs.rb`. Creatures are the room objects the game
marked with a `pushBold` tag; dead ones match
`/which appears dead|\(dead\)/`; names are then normalised and HTML-stripped.

That is worth knowing because it sets the limit: **if the game did not bold it,
Lich does not think it is a creature**, and no amount of work on our side
changes that.

### What status is actually available, and what is not

This is the finding that shapes the panel. Searching the whole of Lich for
values assigned to `npc_status` turns up **`dead` and `stunned`**. That is it.

So an honest card carries:

- **name** — from `DRRoom.npcs`
- **noun** — from the matching `GameObj`, for the picture
- **dead** — membership of `dead_npcs` rather than a status flag
- **stunned** — when `GameObj#status` says so
- **count** — several of the same noun collapse to one card with a multiplier,
  because six identical goblins as six cards is a wall, not information

There is **no health, no wounded state, and no "it is fleeing"** available. Any
of that would mean parsing combat text ourselves, which is the 2,008-trigger
problem the design refuses in §1. The card does not pretend otherwise: it shows
what is there, not a health bar it cannot fill.

### Edge cases, decided here rather than during the build

- **Empty room.** Show nothing, not "no creatures". An empty panel is already
  the message.
- **No bridge.** Different from an empty room: say the bridge is down, once.
- **Duplicate nouns with different names** — `a snarling goblin` and
  `a wounded goblin` — group on the *noun* for art, but keep the names, since
  the difference is the interesting part.
- **Very many creatures.** An invasion is real. Cap the cards, show the count,
  and say it is capped, per the no-silent-truncation rule.
- **Dead ones** go after the living, dimmed, and collapse to a count once past
  three. Corpses matter for skinning, not for threat.

### Layout

Cards in a wrapping grid, sized by the space they get. Narrow: name and count
only. Wider: room for the picture when creature art exists (§2.13). The panel
must be legible at both without a second component.

## S2. Body panel — the paperdoll

### The data is already complete

`XMLData.injuries` (`common/xmlparser.rb:137`) is a hash of **sixteen** body
parts, each `{ 'scar' => 0..3, 'wound' => 0..3 }`:

```
head  neck  chest  abdomen  back
leftArm  rightArm  leftHand  rightHand
leftLeg  rightLeg  leftFoot  rightFoot
leftEye  rightEye  nsys
```

`nsys` is the nervous system, which has no location on a body and is the reason
the doll needs one off-body indicator.

Severity is 0-3 and Lich packs it two bits per part into `wound_gsl`, which
confirms the range. Lich carries no severity *labels*, so we supply them and
they are ours to get right: **1 minor, 2 serious, 3 severe.**

### Why a doll rather than a number

A single health percentage cannot say that the damage is in a leg. A bleeding
head and a bleeding leg are different emergencies with different answers, and
players already think in body parts because the game does.

### What it shows

- Sixteen positions, coloured by wound severity, scars indicated separately and
  more quietly — a scar is history, a wound is now.
- `nsys` as its own indicator, since it has nowhere to sit on a body.
- Hover gives the part, the wound severity, the scar severity. Nothing is
  written on the doll itself: labels at that size would be unreadable and
  §1.5 sets a 12px floor.

### Edge cases

- **All zeroes** is the common case and must look calm, not blank-because-broken.
- **Right after login** the parse may not have run. Absent is not uninjured, and
  they must not render the same.
- **Scar 3 with wound 0** is a healed cripple and is normal. It is not an alert.

## S3. Scripts panel and watchdog

### Available API, checked

```
Script.running       -> Array<Script>, hidden ones already excluded
Script.list          -> all known
Script.running?(name)
Script.paused?(name)
Script.version(name) -> parsed from the =begin header's `version:` line
Script.exists?(name)
Script.start(name, *args) / pause / unpause / kill
```

`Script.running` filters `hidden` itself, which matters: `script-watch.lic` and
our own bridge call `hide_me` and would otherwise clutter the list.

### What the panel shows per script

Name, version, and state — running, paused, or installed-and-idle. Start, pause
and stop per row. Version is on the row rather than behind a hover, because
version mismatch is the single largest time sink in this ecosystem's support
traffic and the whole point is to make it answerable at a glance.

### The watchdog half

Modelled directly on what `uberwatch.cmd` watches, since that script is the
distilled experience of everything that goes wrong:

| Signal | Source | Means |
|---|---|---|
| Game clock not advancing | `gameTime` on the status payload | the game has hung or disconnected |
| A script vanished | `Script.running` no longer lists it | it died |
| No command reply | our own `Cmd` layer | roundtime, stun, or a refusal |
| Bridge socket closed | the transport | Lich or the game went away |

The stale-clock check already exists in `realBridge.ts` at 90 seconds. The
others are new and belong in this panel.

### Why this panel matters more than it looks

For someone running four free accounts as healer bots, this **is** the product.
They are not levelling, so the mindstate board is close to meaningless to them;
what they need is to know a bot has died and to restart it without typing.

### Edge case that is easy to get wrong

`script-watch.lic` already exists and does a version of this in a GTK window.
That is validation, and a warning: being right about a feature is not the same
as it being usable. Ours has to be better than a list in a grey box or there is
no reason for it.

---

## S4. Art: model, style, resolution, pack

Decisions, not options. Style consistency is a stated reject condition, so
every knob that could vary between two images is pinned here.

### The model is FLUX.1 **schnell**, and the licence is the reason

Available locally, checked:

| Model | Licence | Verdict |
|---|---|---|
| `flux1-schnell-fp8` | **Apache 2.0** | **use this** |
| `flux1-dev-fp8` | FLUX.1 non-commercial | cannot ship outputs |
| `sd_xl_base_1.0` | OpenRAIL++-M | usable, but weaker prose comprehension |

This is not a quality-first choice, it is a rights-first one. The pack is meant
to be **given to Simutronics**, who may ship it in a client or sell it. Anything
generated with `dev` carries a non-commercial licence and would make that
impossible — a gift they legally cannot use is not a gift. Apache 2.0 puts no
conditions on outputs at all.

Schnell also happens to be the fast one: four steps rather than twenty-plus,
which is the difference between a job that finishes and one that does not.

### Resolution, reasoned from where it is actually displayed

The panel is resizable, so the honest question is how large a room image can
plausibly get. On a 4K screen with a generous panel, roughly 1200px wide; on
1080p, nearer 600. Images are cheap next to video, and quality is the point.

| Asset | Generated at | Why |
|---|---|---|
| Room scene | **1344 × 768** | 16:9, a FLUX-native size, crisp at 1200px and downscales cleanly to 600 |
| Creature card | **832 × 1216** | portrait, reads as a card, sharp at typical card widths |
| Player portrait | **1024 × 1024** | square, framed by the player, uploaded not generated |

Stored as WebP at high quality, roughly 180 KB each. Never upscaled at runtime
past their native size, because a soft image is worse than a smaller one.

### Style: fixed, and deliberately not Simutronics

The house style is thirty years old and is not the target. What is specified
here is a single consistent look, applied to every image, defined by a fixed
suffix that never varies:

> painterly digital illustration, muted naturalistic palette, soft directional
> light, atmospheric depth, painted texture, no text, no watermark, no people
> unless described, consistent fantasy realism

Fixed alongside it, and equally load-bearing for consistency:

- **Model** — `flux1-schnell-fp8`, one file, never swapped mid-pack
- **Steps and guidance** — one setting for the whole run
- **Seed** — derived from the room, so the same room is the same image forever
  and a regeneration reproduces rather than reinvents
- **No LoRAs, no per-image tweaking.** One knob turned once is the difference
  between a set and a collection.

If two images sat side by side and looked like different artists, the run is
wrong and gets thrown away rather than patched.

### Racial descriptions have to be exact

Eleven playable races. This list is `Category:Races` on Elanthipedia,
checked rather than recalled:

```
Human   Elf   Dwarf   Halfling   Gnome   Gor'Tog
S'Kra Mur   Prydaen   Rakash   Kaldar   Elothean
```

An earlier draft of this section listed thirteen and named Half-Elf and Aelotoi,
saying both were confirmed against Elanthipedia. Neither is a DragonRealms race.
Both are GemStone IV, and the wiki search for Aelotoi returns nothing at all.
The claim of having checked was the actual error; the wrong names were only its
symptom.

These are not generic fantasy races and must not be rendered as them. S'Kra Mur
are reptilian and tailed, Prydaen feline and furred, Rakash human until Katamba
waxes full and lupine after, Gor'Tog large and powerfully built. Getting one
wrong is worse than shipping no portrait, because it tells thirty-year players
nobody looked.

The source for each is the **Character Creation** section of that race's
`Concept:` page, which is the in-game creation prose and describes what the
race physically looks like. The Play.net Description section is lore and culture
and is almost useless for this: for Prydaen it never mentions fur.

Each race gets a written descriptor block, sourced from Elanthipedia, reviewed
before any generation. **That work happens before the run, not during it.**

### The pack, and what actually ships

Measured from the map data: 18,490 rooms, 23,335 descriptions. Not all of it is
worth generating first.

| Scope | Rooms | Pack size |
|---|---|---|
| Top 10 zones | 7,339 | ~1.3 GB |
| Top 20 zones | 11,201 | ~1.9 GB |
| Everything | 18,490 | ~3.2 GB |

The top ten zones are Crossing, Ratha, the Northern Trade Road, Shard and its
approaches, Boar Clan, Riverhaven, Muspar'i and the Crossing West Gate — which
is where players actually spend their time.

So: **ship the top zones as the starter pack, generate outward from there.**
A 1.3 GB download is defensible; a 3.2 GB one on first run is not, and most of
that tail is rooms a given player will never stand in.


### A keying problem to settle before any room art is generated

The room prompts are built from `C:\Genie4\Maps`, because **there is no Lich map
database on this machine**: `Lich5/maps` does not exist and `Lich5/data` holds
only `effect-list.xml`. The mapdb arrives from `;repository download-mapdb`,
which has not been run here.

So the 18,490 rooms are currently keyed `zone-node` in Genie's numbering, and
the app navigates in Lich's. Those are different id spaces, which is the
distinction that matters: **Companion uses Lich's map, not Genie's.**

This is recoverable rather than wasted. Lich's room records carry `genie_zone`
and `genie_id`, and `Lich::Common::Map` exposes `by_genie_ref`, so the
translation exists in exactly the direction needed. But it only exists once the
mapdb is on disk.

**Therefore: download the mapdb, re-key the prompt file through
`by_genie_ref`, and only then generate.** Generating 18,490 images against
Genie ids and translating afterwards would work, but any room where the
translation fails becomes an orphaned image nobody can look up, and finding
those after the fact means auditing the whole pack rather than the prompt file.

The prompts themselves are unaffected: the description text is the same
cartography either way, and the seed is derived from the key, so re-keying
changes which seed a room gets but not the style or the content.

### Where generation happens

Centrally, here, not on the player's machine. They are not being asked to own a
GPU or wait, and a shared pack is the only way every player sees the same world
— two people comparing screenshots of the same room must see the same room.

Local generation stays available for anyone who wants their own look, and the
player portrait is theirs entirely: uploaded, from anywhere. Point them at a
couple of online generators rather than shipping a generator.

### Order of work

1. **Creature cards first.** A few hundred images, the highest value per image,
   and a small enough set to prove the style on before committing to thousands.
2. **A sample of twenty rooms**, spread across zone types — town street, forest,
   cave, shore, interior — reviewed together for consistency. **Approval gate.**
3. **Top ten zones**, then outward.

Nothing large gets generated before step 2 is signed off, because the failure
mode is 7,000 images in an inconsistent style and no way to tell which are
wrong.

---

## S5. Distribution: who scrapes the wiki, and who pays for it

The requirement is blunt and it is a constraint, not a preference: **nobody is
hosting a server forever.** Any design here that ends in "and then someone keeps
a box alive" has failed, however elegant it looks in the meantime.

There are two separate problems hiding under "data sharing", and they have
different answers because they differ by three orders of magnitude in size.

### Problem one: the item and creature data

Measured, not estimated, from the current pull:

| File | Raw | |
|---|---|---|
| `index.json` | 4.04 MB | 77,067 titles across Item, Weapon and Armor |
| `weapons.json` | 2.29 MB | properties |
| `armor.json` | 0.12 MB | |
| `materials.json` | 0.07 MB | |
| `npcs.json` | 0.08 MB | |
| `creatures.json` | 0.07 MB | |
| **total** | **6.36 MB** | **1.21 MB gzipped** |

The whole of Elanthia's item knowledge is smaller than one photograph off a
modern phone, and the hourly delta is roughly a single page.

**Decision: one scheduled scrape, committed to the repository, fetched over
plain HTTPS.** `.github/workflows/elanthipedia.yml`.

Why this and not the alternatives:

- **Not one scraper per client.** Sixty players independently scraping produces
  sixty times the load for byte-identical results. Elanthipedia runs on
  `elanthipedia.play.net` — Simutronics' domain, Simutronics' bill. It is
  community-*written*, which is easy to misread as community-hosted. Appearing
  in their logs as a traffic spike is the worst possible introduction for a
  project intended as a gift to them.
- **Not a rented host.** Scheduled workflows are free and unlimited on public
  repositories. There is no bill, no renewal, and nothing to keep alive.
- **Not peer to peer.** Considered and rejected below.

The part that actually satisfies "forever":

1. **No server exists to die.** The schedule is GitHub's problem.
2. **No person is required.** The repository is public and MIT. If this project
   is abandoned, a fork keeps scraping on the same schedule with no
   coordination, no handover and no permission needed. That is the same
   reasoning as giving the software away in the first place.
3. **The data survives the scraper.** Every refresh is a commit, so the last
   good dataset is permanently in the repository. If the workflow stops forever,
   the failure mode is *item data gradually goes stale* — not a broken client.
   Nothing in the app blocks on the feed being current.
4. **The handoff is already built.** If Simutronics takes this on, they fork it
   and it becomes theirs, running against their own wiki, with no migration.

Committing the data rather than publishing a build artifact is deliberate: it
makes every change to the game's item set a **diff**. A bad scrape is visible,
attributable and revertable, which matters a great deal for data that will drive
automation decisions.

**A trap worth recording, because it nearly shipped:** `data/elanthipedia/` was
in `.gitignore` as local scratch. The workflow would have run every hour
forever, committed nothing, and gone green every single time. A scheduled job
whose success condition is "the command exited 0" is not verified; the check
must be that the state changed.

**One documented limitation, not designed around:** GitHub disables scheduled
workflows in repositories with no activity for 60 days. For a project under
development this never triggers, and if it ever does the recovery is one click.
Worth knowing rather than being surprised by.

### Problem two: the art pack

This is where the P2P instinct is genuinely pointed at something real. The pack
is **1.3 GB** for the top ten zones and **3.2 GB** for everything (§S4), and
that multiplied by every player is real bandwidth in a way that 1.2 MB is not.

But it is also, precisely, **a large static blob that changes rarely** — the one
distribution problem with a mature off-the-shelf answer. Ranked:

1. **GitHub Releases.** Free bandwidth, 2 GB per file, so the top-zone starter
   pack fits as-is and the full pack splits by zone — which it should anyway,
   because zone-by-zone download is the better experience regardless.
2. **A torrent**, if volume ever makes that insufficient. We publish a
   `.torrent` and build nothing; the swarm is the distribution. This is P2P, but
   it is P2P we do not implement, maintain or support.
3. **Simutronics' own CDN**, if they take the pack. Then it stops being our
   problem entirely, which is the intended endgame.

### Why not peer to peer for the data

The idea is reasonable and the reasons against it are specific:

- **The size does not justify it.** 1.2 MB gzipped, delta of about one page an
  hour. This is a distribution mechanism for gigabytes being aimed at kilobytes.
- **Trust inverts.** P2P means accepting game data from strangers. This data
  feeds automation: which rooms are hazards, what a creature is, what an item
  does. A poisoned dataset that marks a lethal room safe is a real attack with a
  real victim, and defending against it means content addressing, signatures and
  a revocation story — all of which is *more* machinery than the signed static
  file it was meant to replace. Central publishing is both safer and simpler,
  which is rare enough to take when offered.
- **The audience is behind home routers.** NAT traversal, port forwarding and
  firewall prompts land as support burden on people who installed a GUI
  specifically to avoid that class of problem.
- **It does not reduce load on Elanthipedia at all.** That was already solved by
  scraping once centrally. P2P would only change how the published result
  reaches clients, which was never the expensive part.

The general principle it violates is the one running through this whole
document: **do not build what already exists.** An HTTPS GET of a versioned file
exists, works offline-tolerantly, and has no moving parts.

### What the client actually does

```
on launch, and hourly while running:
  GET the published dataset, conditional on ETag
  304  -> nothing to do, which is the usual answer
  200  -> verify, swap in, rebuild the local index
  fail -> keep using what is on disk, say nothing
```

The last line is load-bearing. The feed is an enhancement, never a dependency:
the app must be fully usable with no network beyond the game itself, because a
tool that breaks when a third party is down is a tool nobody trusts.

---

## S6. The card system

Everything in the room that can act is a card. There are exactly three decks and
the deck a card belongs to is never in doubt.

### Why three decks and not one list

| Deck | Contents | The question it answers |
|---|---|---|
| **Hostile** | `DRRoom.npcs`, `dead_npcs` | what is trying to kill me |
| **Allied** | group members' creatures, summons, pets, familiars | what is helping |
| **People** | `DRRoom.pcs`, shopkeepers and other named NPCs | who is here |

Mixing them is the failure mode to design against. In a fight the eye is looking
for one thing, and a friendly summon rendered like a threat costs a beat that
the player does not have. So each deck gets its own band colour **and its own
card silhouette** — square corners for hostile, cut corners for allied, rounded
for people — because colour alone fails for the eight percent of men with a
colour vision deficiency, and this audience skews male and over forty.

Decks keep their order and never interleave. A deck with nothing in it does not
render at all: an empty "Allied" header is wasted space, and wasted space is the
thing this panel exists to avoid.

### Compression, which is the actual idea

Cards behave like a hand of playing cards. When there is room they lie side by
side. When there is not, they slide under each other and fan, and the exposed
sliver of each card carries the information that matters most, exactly the way a
fanned hand shows rank and suit down the left edge and hides the rest.

Five tiers. The panel picks one from its own width and its card count, measured
with a `ResizeObserver` rather than a media query, because the panel is
resizable and pop-outable and the viewport tells you nothing about it.

| Tier | Card | Shows |
|---|---|---|
| **Full** | 168px | art, name, level band, trait chips, actions |
| **Compact** | 112px | small art, name, status chips |
| **Row** | full width, 32px tall | name, status, count |
| **Fan** | 26px exposed | band colour, first line of name, status dot |
| **Count** | one chip per deck | "6 hostile", tap to expand |

**Count is the floor.** However cramped it gets, the deck and its size stay on
screen. A panel that hides the fact that six things are attacking you has failed
at the only job it had.

### The exposed sliver

This is the whole design problem in one measurement. At Fan tier a card shows
26 pixels, and what goes in them, in order of what gets dropped last:

1. **Deck band** — 4px of colour plus the silhouette
2. **Alive or dead** — dead cards desaturate and drop to the back of the deck
3. **Stunned** — a single dot, because it is the one status that changes what
   you do next
4. **First glyph of the name**, then as much of the name as fits

Level is deliberately not in that list. It is on the card at Compact and above,
and it does not change during a fight, so it loses to status.

### Unpacking

Any card expands in place: it grows to Full, its neighbours fan tighter to pay
for it, and nothing reflows outside the deck. Expansion is per-card and more
than one can be open, because comparing two creatures is a real thing players
do and forcing an accordion would make that impossible.

Any card can also be torn off into its own window, which already exists for
panels and costs nothing to extend. That is the answer to "infinitely
unpackable" — the panel compresses to a chip, and any single card can become a
window the size of the screen.

Expansion state is per deck and survives a resize. Shrinking the panel collapses
cards visually but does not forget which were open, so widening it again returns
what was there rather than a reset.

### What a card can honestly say

The card is bounded by what Lich actually knows, which per S1 is name, noun,
dead, and stunned. There is no health bar because there is no health.

The bestiary pull adds the rest, keyed on the noun:

| From | Field |
|---|---|
| `naturallevel`, `MinCap`, `MaxCap` | level band, and whether it is above your ranks |
| `BodyType`, `BodySize` | silhouette and art |
| `Attack Range` | melee or ranged, which decides whether closing helps |
| `Casts Spells`, `Stealthy` | trait chips, both of which change tactics |
| `Skinnable`, `Has Boxes`, `Has Coins`, `Has Gems` | what the corpse is worth |

That last row is why dead cards do not simply vanish. A skinnable corpse with
boxes is a task, not a footnote, and it stays on the card until it is dealt
with.

### The rule this section is really about

Density is not the same as clutter. Every element on a card has to answer a
question the player is actually asking at that moment, and the tiers exist so
that the answer to "how much space does this deserve" is different in a fight
than it is in a shop. Nothing here is decoration, and anything that cannot
justify its pixels at Row tier does not belong on the card at all.
