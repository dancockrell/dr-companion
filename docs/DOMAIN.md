# How DragonRealms actually works, and what that means for Companion

> **Rule 0 — never fork.** A problem is to be solved, never dodged. Fix the thing,
> replace it outright, or delete the feature — those are the only three moves.
> Never leave two answers to one question standing side by side, and never route
> a parallel path around something you did not want to touch. That is a noodle to
> nowhere, and it is the most serious thing you can do to this codebase.
> Full rule: [`CLAUDE.md`](../CLAUDE.md).

Research pass, 25 Aug 2026. Sources are Elanthipedia, the elanthia-online
GitHub org, and reading community Genie scripts to see which cases they handle.
Script code was read to learn play patterns. None of it was copied, and one of
the scripts read is commercial and licensed, so nothing from it appears here or
anywhere in this repo.

The point of this document is that several of Companion's data modules were
written from plausible assumption rather than from the game. This records what
is actually true, with sources, so the modules can be rebuilt on facts.

---

## 1. Training is driven by mindstate, not by preference

This is the biggest modelling error in the current code and it changes what
"Start Training" means.

Every skill has a **mindstate**, an experience pool on a 34-point scale from
Clear (0/34) to Mind Lock (34/34). Field experience fills the pool. The pool
drains into permanent ranks on pulses, every 40 to 60 minutes for primary
skills, 50 to 80 for secondary, 70 to 100 for tertiary. Once a pool is at Mind
Lock, further training in that skill is wasted until it drains.

So experienced players do not decide what to train by preference. They rotate:
train a skill until its pool is full, switch to one with room, come back later.
Skills pulse in ten groups on a 200-second cycle, which is why rotation
between groups beats grinding one thing.

You can see this decision encoded directly in a community burgle script, which
picks its entry method by comparing learning rates rather than by asking the
player:

```
if (($Locksmithing.Ranks < 1750) && ($Athletics.LearningRate >= $Locksmithing.LearningRate))
  then var method RING
else var method ROPE
```

Lockpick ring teaches Locksmithing, rope teaches Athletics. The script picks
whichever is absorbing better. A commercial combat script has the same idea as
in-game commands `WEAPON SWAP!` and `MAGIC SWAP!`, which rotate to the next
weapon or spell school mid-session.

**What Companion has:** `trainFocus: string[]`, a set of static checkboxes over
six invented categories, plus a single `skillRanks?: number` for the whole
character.

**What it needs:** per-skill `{ ranks, mindstate }`, and a recommendation that
reads "Locksmithing is at 32/34, switch to Athletics" rather than "you ticked
Weapons". `DRSkill` on the Lich side exposes exactly this. The single
`skillRanks` number cannot represent a character at all, since the whole point
is that skills differ.

This also reframes the primary button. "Start Training" is currently a
destination picker. It should be answering "what is absorbing right now".

Source: [Experience](https://elanthipedia.play.net/Experience)

---

## 2. F2P is passport-gated, not Zoluren-locked

Companion models this as `canTravelOutsideZoluren: boolean`, derived from tier.
That is wrong in both directions.

Free accounts start confined to Zoluren, but can leave:

- **Province passports** (30/60/90 day, SimuCoin) unlock Therengia, Ilithi,
  Qi'Reshalia or Forfedhdar individually
- **Temporary visas** from the Citizenship Office in Crossing Town Hall last 24
  hours, one at a time, roughly a two-week cooldown between applications, and
  are not available to Rangers

Passports gate *transport legs*, not destinations, and an expired passport
strands you:

| Leg | Requires |
|---|---|
| Gondola to Shard | Ilithi passport |
| Sea mammoths to Fang Cove | active Ilithi passport |
| Riverhaven ferries, river diving | Therengia passport |
| Barges to Ain Ghazal | Forfedhdar passport |
| Balloon, Langenfirth to M'riss | Qi'Reshalia passport |
| Gear Gate, dark hole to Cragstone Vale | Forfedhdar passport |
| Moongates in Qi'Reshalia | passport |
| Ranger trails | destination province passport |
| Route ships | destination passport, unless same province |

Moon Mage travel spells (Teleport, Moongate, Contingency, Riftal Summons) are
restricted to F2P borders unless unlocked.

"Expired passports prevent re-entry to that province if you leave." A travel
planner that does not check this can strand a character.

**Consequence for the code:** passport state is *runtime state the bridge must
report*, not a static property of a tier. `planTravel` needs a per-leg check.
`capabilitiesFor(tier, instance)` cannot answer this question with the inputs
it has.

Source: [Free accounts](https://elanthipedia.play.net/Free_accounts)

---

## 3. Verified account tiers

| Tier | Price | Chars | Notes |
|---|---|---|---|
| Free to Play | free | 1 | Zoluren + passports, no Empath/Trader/Necromancer |
| Basic | $14.95/mo | 1 | all regions, all guilds, 4h daily exp recovery |
| Premium | $39.95/mo | 16 | home ownership, private hunting, Fang Cove, 6h exp |
| Platinum | $49.95/mo | 257 | Premium plus cross-world portals **after 6 months**, waived vault fees, 750 SimuCoins, 8h exp |
| The Fallen | $19.95/mo | 1 | requires a basic subscription plus $5; Fallen instance only |

**Premium and Estate Holder are the same thing.** Estate Holder is the in-character
term. Elanthipedia uses both, and script authors mostly say Estate Holder.

Things this corrects in the code:

- `travelPath.ts` unconditionally offers a Platinum portal step. Cross-world
  portals require six months of Platinum tenure, which Companion has no field for.
- `AccountTier` treats `'fallen'` as a peer of `'basic'`. A Fallen player also
  holds a basic subscription. `BRIDGE_CONTRACT.md` is right that instance and
  tier are independent; the union is what is wrong.
- **F2P cannot play Empath, Trader or Necromancer.** `GUILD_PROFILES` lists all
  twelve guilds with no tier gate.

Source: [Accounts](https://elanthipedia.play.net/Accounts)

---

## 4. The numbers Companion invented, checked

| Companion value | Verdict |
|---|---|
| `bankCapPlatinum: 10` for F2P | **Correct.** 10 platinum total across all banks. |
| `bankDepositCap: 100000` for F2P | **Correct, and the same cap.** 10 plat = 100,000 copper. Redundant, not wrong. |
| `hasVault: !f2p` | **Roughly right, incomplete.** F2P has no base vault but can buy expansions to 250 items. |
| `vaultApproximateCapacity: 500` | **Invented.** No source found. |
| `expThrottled: boolean` | **Too coarse.** See below. |
| `inventoryPressureTight: boolean` | **Too coarse.** F2P carry cap is 100 items, 75 before junk-room warnings, 300/250 with the Personal Inventory Upgrade. Slots blocked: body (10), over shoulder (2), finger (2), belt (2). |

The currency system, confirmed from a fine-parsing routine in a community
script and consistent with the bank cap:

```
1 platinum = 10 gold = 100 silver = 1,000 bronze = 10,000 copper
```

**The experience throttle is a curve, not a flag:**

- 60% of subscriber rate up to rank 50
- linear decline from 60% down to 30% between ranks 50 and 200
- 30% beyond rank 200
- Experience Booster pass raises it to 90%

That curve matters for exactly the thing Companion is trying to do. Rank-band
hunting advice for a F2P character at rank 180 is a different recommendation
than for a subscriber at rank 180, because the F2P character is absorbing at
roughly a third the rate.

Sources: [Free accounts](https://elanthipedia.play.net/Free_accounts),
[Vaults](https://elanthipedia.play.net/Vaults)

---

## 5. Fang Cove, which I had wrong

An earlier note in `REVIEW.md` said Fang Cove is "really its own premium area".
That is incorrect.

Fang Cove is **in Ilithi**. It is reached by sea mammoth from Ratha and
Acenamacra, by Estate Holder rings and portals, by astral travel via the
Grazhir shard, or by sailing from Hara'jaal. It is primarily an Estate Holder
area, but the docks and the Grazhir shard are open to non-holders, so
`requiresPremium: true` is too blunt. It has a healer (Yrisa) and 40+ merchants.

So of the three contradictory answers in the code, `travelDestinations.ts` is
the correct one:

- `travelDestinations.ts` says `province: 'Ilithi'` — **right**
- the `premium_prime` preset says `province: 'Zoluren'` — wrong
- `healers.ts` says `inZoluren: true` — wrong

It also has Athletics gates: 20+ to enter, 50+ to leave the shark area.

Source: [Fang Cove](https://elanthipedia.play.net/Fang_Cove)

---

## 6. Athletics is the real mobility stat, with published thresholds

Companion has `pathDifficulty: 0|1|2|3` per healer and a `mobilityScore`
hardcoded to `55` in two places. The real mechanic is Athletics ranks against
per-obstacle thresholds. A widely used community travel script publishes its
own conservative numbers:

| Shortcut | Safe | Possible at | Notes |
|---|---|---|---|
| Jantspyre swim, south | 100 | ~90 | much easier of the two |
| Jantspyre swim, north | 200 | ~180 with no burden or armor | |
| Faldesu river, Haven to NTR | 190 | ~160 with no burden or armor | |
| Under-Segoltha | 50 | 35 with zero burden | **Thief only** |
| Under-gondola climb | 515 | ~480 with buffs and rope | script auto-checks for a rope under 620 |
| Segoltha swim, Tiger Clan to STR | 565 | ~540 buffed and strong | "very tough swim, can get stuck" |
| Velaka desert to Muspar'i | 850 | 780 | "hardest shortcut in the game", disabled by default |

Three modifiers matter and none are in Companion's model:

- **Burden and armor reduce effective Athletics.** Every threshold above has a
  lower "possible" figure for an unburdened character.
- **Guild buffs and a climbing rope raise it.** The travel script buffs before
  attempting and checks for a rope.
- **Being in a group forces public transport.** Shortcuts are single-traveller.

Failure is not a retry. The desert shortcut warning is "you WILL die in the
desert if you get lost", and the automapper can lose track when wind moves you.

**Consequence:** `mobilityScore` should be derived from Athletics ranks,
current burden, armor, active buffs and rope possession, all of which the
bridge can read. The static `pathDifficulty` integers should become real
obstacle thresholds.

---

## 7. Healing is several systems, not one ranked list

Companion models healing as one scored list of locations. Play involves at
least four paths, and which one applies depends on wound severity, not distance:

1. **NPC healers / Empath guild.** What Companion models.
2. **Player Empaths**, including dedicated healbot characters parked in a room.
3. **Herbs**, self-applied. There is a whole herb-healing module in the
   commercial script, and `base-healingherbs.yaml` in dr-scripts.
4. **Tending**, binding your own bleeders. Bleeding is a separate condition
   from wounds and kills independently.

DragonRealms wounds are per-body-part with severity and separate bleeding, which
is why dr-scripts ships `base-anatomy-charts.yaml`. `SituationFlag` currently has
a flat `'bleeding'` with no location or severity. A character with a severe
head wound and a character with a scratched leg both read as one bit.

There is also **rezz sickness** after dying, a timed state during which you
should not fight. Companion has `'dead'` and `'dying'` flags but no concept of
the recovery period.

---

## 8. Guards are province-specific, and one of them is a tree

The burgle script's guard list is worth reproducing as a data point about how
much of this game is exceptions:

```
Gwaerd | guard | Shard sentinel | Sentinel | Elven Warden | Riverhaven Warden
| Warden | Baronial guardsman | sickly tree | Muspar'i constable
```

A "sickly tree" is a guard. This is the kind of fact no amount of reasoning
about game design produces, and it is why the data has to come from players
rather than from inference.

Justice has at least two separate systems with different triggers and different
outcomes: town justice, which ends in arrest and a fine, and **clan justice**,
which is handled by a completely different code path. Both need distinct
handling. The script's abort conditions:

- Footsteps warning: `Footsteps nearby make you wonder if you're pushing your luck.`
  Leave immediately, after roundtime.
- Arrest: `Before you really realize what's going on, your hands are firmly
  bound behind you and you are marched off.`
- Clan justice: `After a moment the leader steps forward grimly`

Fines are parsed and can be large. The script's own disclaimer is "NOT
RESPONSIBLE FOR YOUR ASTRONOMICAL FINES."

Companion's `ENTRY_ROOMS` list (kitchen, bedroom, workroom, sanctum, armory,
library) **matches the community data exactly**, so that part is right.

---

## 9. Everything must be retried against three refusals

The single most repeated pattern across every script read:

```
matchre WAIT \.\.\.wait|still stunned|^Sorry, you may only
```

Three distinct ways the game says "not now": roundtime (`...wait`), stun, and a
command-specific refusal. On top of that, roundtime text appears in several
formats, and scripts match all of them:

```
^Roundtime:  ^[Roundtime:  ^(Roundtime:
```

Any Companion intent that issues game commands has to handle all of this on the
Lich side. This is also why "the button did nothing" is the default failure mode
in this game, and why the activity log matters more than it looks.

---

## 10. The real session loop is much larger than six activities

Companion models six activities. A serious player's session, judging by the
module structure of the most-used combat script, includes at minimum:

buff → travel to ground → combat with weapon and spell rotation → wound
tending and bleeder checks → escape and heal → town run → back out.

The town run alone covers selling gems and skins, banking, money exchange
between provinces, repair (including magic repair kits and crafting tool
repair), and pawning.

And then the things Companion has no concept of at all: crafting across
Engineering, Outfitting, Forging, Enchanting and Alchemy; magical research;
scholarship and textbook study; foraging, mining, braiding and climbing runs as
deliberate skill training; Trader commodity runs and appraisal; guild-specific
work such as Cleric rituals, Moon Mage astrolabe use and Thief Khri.

I am not suggesting Companion should do all of this. The point is scope
calibration: six activities is a slice, and the UI should not imply it is the
whole game.

---

## 11. Do not rebuild the data. Read theirs.

`elanthia-online/dr-scripts` already contains the authoritative versions of
several things Companion hand-rolled, maintained by the people who play:

| File | Size | What Companion has |
|---|---|---|
| `base-hunting.yaml` | 89 KB, 200+ zones with rank ranges and room IDs | 17 invented grounds |
| `base-town.yaml` | 26 KB | a 7-step planner |
| `base-healingherbs.yaml` | 10 KB | one `'herb'` healer entry |
| `base-athletics.yaml` | 5.8 KB | `pathDifficulty: 0-3` |
| `base-picking.yaml` | 12 KB | lockpick ring vs rope |
| `base-anatomy-charts.yaml` | 7 KB | one `'bleeding'` flag |
| `base-crafting.yaml`, `base-recipes.yaml` | 227 KB combined | nothing |

There is also `elanthia-online/mapdb-backup-dr`, a git-based backup of the
DragonRealms map database, which is the actual room graph the travel planner
would need.

Anyone running Lich already has these on disk. Reading the user's installed
copy is better than duplicating it: the data stays current, it matches what
their other scripts do, and Companion inherits corrections for free. It also
avoids the licence problem in the next section.

The Lich-side API to read game state, which `BRIDGE_CONTRACT.md` currently gets
wrong, is:

`DRStats` (vitals and stats), `DRSkill` (ranks and mindstate), `DRSpells`
(active spells), `DRRoom` (room contents), `GameObj`, `Room`, `Map`, `XMLData`,
`EquipmentManager`, plus the commons modules `DRC`, `DRCI` (inventory), `DRCM`
(money), `DRCT` (travel), `DRCC` (crafting).

The contract currently says to push status from "Char / Room / XMLData /
Infomon". **Infomon is a GemStone thing, not DragonRealms.** That line needs
fixing before anyone writes the Ruby.

---

## 12. Two licence facts that constrain the project

**`elanthia-online/dr-scripts` is GPL-2.0.** This repo is MIT. GPL-2.0 code
cannot be copied into an MIT project. Reading it to learn, and calling or
reading the *data files* a user has installed, are both fine. Lifting Ruby from
it into `lich-scripts/` is not, and would force this whole repo to GPL.

`elanthia-online/lich-5` carries a non-standard licence that GitHub cannot
identify, so it needs reading directly before any assumption is made about it.

The commercial combat script read during this research is explicitly
"All rights reserved. Not for resale or distribution without author's consent",
with a stated threat of account ban and litigation. It must never be committed
anywhere, and nothing in it should be reimplemented as a clone. Note that these
scripts currently sit in a Downloads folder; keep them out of any repo working
tree.

This also sharpens the point already in `GAME_KNOWLEDGE.md`: mechanics are
facts and are free to use, the arrangement and the code are not.

---

## 13. The failure taxonomy, which no wiki documents

A 130-line watchdog script exists purely to keep a combat script alive. Its
trigger list is the most useful thing I read all session, because it is a
catalogue of everything that goes wrong in practice.

**Disconnects come in at least eleven distinguishable forms:**

```
Connection lost | ConnectionAborted | Socket Error | ReceiveCallback Exception
Unable to contact Genie Key server | Unable to get login key.
(ConnectionTimedOut) | Connection closed. | Reconnect aborted
No user input since last connect | YOU HAVE BEEN IDLE TOO LONG
```

**The game kicks you for being idle.** `YOU HAVE BEEN IDLE TOO LONG` and a
`$useridle` flag. Any tool that sits and waits has to account for this.

**A live socket does not mean a live game.** The watchdog's cleverest trick:
record the in-game clock, wait 35 seconds, and compare. If game time has not
advanced, the connection is dead no matter what the socket says. Only then does
it send `look` and wait for any known room-description pattern:

```
Please check NEWS NEXT | Welcome to DragonRealms | Obvious (paths|exits)
It's pitch | ^You also see | ^Also here | ^Sorry | ^You can only
```

**Companion should steal this.** `RealBridge` currently treats "WebSocket is
open" as "connected", which is exactly the assumption this probe exists to
defeat. The bridge should carry a liveness heartbeat sourced from game state,
not from the transport.

**Reconnect uses backoff.** Four attempts, then a five minute pause, then
repeat. Companion retries every 3 seconds forever with no cap, which is worse
than what the community settled on years ago. (See review finding 8.)

**The frontend itself desyncs.** There is a recovery path named `GENIE_DESYNC`,
triggered when `Your worn items are:` shows up unprompted, meaning Genie's
parser has lost the plot. Recovery is to restart the frontend entirely. A tool
built beside Genie should assume Genie can be the broken component.

**Scripts die silently.** The watchdog polls the running-script list and
restarts the main script if it has vanished. So "is it still running" is a real
question with a real answer, and Companion's `runningScripts` should be
verified against Lich rather than remembered from the last message received.

---

## 14. Auto-progression already exists, and its taxonomy is better than ours

The dominant combat script has this setting:

> `AUTO-PROGRESS? (ON or OFF) - ON WILL CHOOSE YOUR COMBAT CREATURE
> AUTOMATICALLY BASED ON YOUR RANKS - YOU DO NOT NEED TO SET IT!`

This is the same thing `rankHuntingGrounds` is trying to do, which is good news:
the premise is validated, and players clearly want it. Its progression *types*
are a much better vocabulary than Companion's six invented focus categories:

```
NORMAL | LOCKPICK | SKIN | F2P | F2PLOCK | EMPATH | NECRO | MM | CLERIC
| UNDEAD | SHARD | THEREN
```

Read that as three orthogonal things Companion currently mashes into one list:

- **What you are training alongside combat**: LOCKPICK (creatures that drop
  boxes), SKIN (skinnable creatures), NORMAL
- **Guild ladder**: EMPATH, NECRO, MM, CLERIC, UNDEAD
- **Access constraint**: F2P, F2PLOCK, SHARD, THEREN

**F2P having its own progression ladder** is the notable one. It is not the
normal ladder with entries filtered out, it is a different route. Companion
currently filters the same list, which will produce gaps rather than a path.

Companion's `prefersUndead` on Cleric and Paladin maps onto UNDEAD and is right.

---

## 15. Players pick a home healer. They do not find the nearest one.

Review finding 5 said healer scoring ignores location and should become
distance-aware. Reading real configs complicates that:

```
HEAL.CITY  ( NULL or CROSS/LETH/HIB/RIVER/THEREN/SHARD )
           Will run to this town for HEALING no matter where you are
HOME.CITY  Will attempt to return to your home city after a heal run
SAFE ROOM  MUST tie into HOME.CITY. The room ID to script in during town run
```

"No matter where you are" is the player explicitly rejecting proximity. They
know their healer, they know the route, and they want the predictable one.

So the design should be: **a preferred heal city that wins by default**, with
scoring as the fallback when none is set or the preferred one is unreachable.
That is a smaller and more useful feature than the multi-factor scorer, and it
matches how people actually play. The scorer stays for the "I do not know this
area" case, which is exactly the new-player case Companion is aimed at.

Note `HOME.CITY` "ONLY SUPPORTS MAINLAND CITIES", so the island cities (Ratha,
Aesry, M'riss, Mer'Kresh) are a special case even in mature tooling.

---

## 16. Hunting grounds are contested, and nothing in Companion knows it

```
ALTERNATE CRITTER - PICK A ALTERNATE CRITTER TO HUNT
                    IF YOUR MAIN HUNTING GROUND IS FULL!
PRIORITY.ROOMS    - move your favorite hunting rooms to the top of the list
```

Hunting grounds are a shared resource. Another player being there is a normal,
expected condition with a normal, expected response: go somewhere else.

There is also a **global friends list** for "people you are OK hunting with /
sharing rooms with", and separately a blacklist. Room sharing is a social
negotiation with real etiquette, and automation has to participate in it.

`rankHuntingGrounds` scores grounds as though the character is alone in the
world. A recommendation engine that cannot say "your first pick is busy, try
this" is missing the most common reason a plan fails.

---

## 17. Favors are death insurance, and should be a pre-hunt check

Favors are accumulated with the gods and consumed when you die, reducing the
penalty. There is a dedicated script for farming them, which tells you how
routine the concern is.

Companion has `'dead'` and `'dying'` situation flags but no concept of favor
count, which means it cannot answer the question a player actually asks before
a risky hunt: *can I afford to die right now?*

That is a good candidate for the Simple-mode dashboard, since it is one number
with a clear meaning, and getting it wrong is expensive. The god/guild/race
affinities are public reference data (Chadatru/Paladins, Damaris/Thieves,
Hodierna/Empaths and Clerics, Kertigen/Traders and Thieves, Meraud/Mages,
Truffenyi/Clerics, and so on).

Related: **rezz sickness** after dying is a timed state during which fighting is
a bad idea, and the combat script has a dedicated `.uber DEAD` launch mode that
waits it out.

---

## 18. Configuration is the pain, and it is worse than I thought

The main combat script's variables file is **930 KB** and contains **61
per-character blocks**. The burgle script's is 28 KB with 12. Each block repeats
the same fifteen-odd settings, gated on:

```
if ("$charactername" = "%CHARACTER1") then { ... }
```

Adding a character means copying a block and editing it by hand. Changing a
default across characters means editing it 61 times.

There are also sharp edges that exist only because config is text:

- Variables can be **at most two words**, unless hyphenated
- Weapon names must be specific, because the script scans the ground for
  anything matching them and picks it up. Name your weapon `blade` and, in the
  file's own words, "IF YOU HAPPEN TO FIND 40 RANDOM BLADES IN YOUR BAG AFTER A
  HUNTING RUN, YOU WILL KNOW WHY"
- Character names must match the game exactly, capitalised correctly

None of this is a criticism of the scripts. It is what configuration looks like
when your only surface is a text file the interpreter also reads. It is the
clearest possible statement of what a GUI is for, and it is the single strongest
argument for this project existing.

---

## 19. What Companion is actually for

Worth stating, because the research clarified it.

The dominant combat script advertises itself as "SUPER AFK FRIENDLY". Its
control surface is typing `TOWN RUN!` or `SKIP!` into the game window while a
script runs, and its configuration is a variables file where the same
fifteen-line block is repeated once per character, twelve times, gated on
`if ("$charactername" = "%CHARACTER1")`.

That is the gap. Not automation, which exists and is mature and is better than
anything this project will write soon. What does not exist is a way to see
what is happening and change your mind, without memorising in-game trigger
words or hand-editing a config file per character.

So the things worth building are the ones the scripts are bad at:

- **Per-character profiles as a first-class object**, rather than 61 repeated
  if-blocks in a 930 KB text file
- **Showing mindstate**, so "what should I train" has a visible answer
- **Showing why**, which the scoring modules already do and which nothing else
  in this ecosystem does
- **Showing the numbers that decide whether to risk it**: favors, Athletics
  against the next obstacle's threshold, passport expiry, bank headroom
- **Interop rather than replacement.** Community scripts already emit signals to
  coordinate with, such as travel printing `YOU ARRIVED!` for other scripts to
  wait on. Companion can drive and observe existing tools instead of
  reimplementing them.

The ranking on that list is not the order they appear in the current UI. The
config problem is the one that is unambiguously worth solving, needs no game
knowledge Companion does not already have, and would be useful on day one even
if every automation feature were removed.

Attended use is a real differentiator here, not just a compliance posture. A
panel that shows you what is happening is worth something to a player sitting
at the keyboard. It is worth nothing to someone who is AFK, and that is fine.

---

## 20. What real bug reports look like, and what they teach

Dan supplied a run of actual support traffic from the community: debug logs
plus the Discord threads around them. The technical findings are useful. The
shape of the support process is more useful still.

### The support loop, as it actually runs

One representative thread, spanning six days:

```
user:  [383 KB debug.txt]
dev:   "wait a second... the line numbers in your debug don't line up with
        the script.. that's an older version of the script"
user:  "So update everything I don't always update all of them"
dev:   "with this version.."
user:  [another debug]
dev:   "and that's still not 10.7.1 posted here.. you're still on 10.7"
```

Two full round trips, days apart, spent discovering the user was running an old
file. Another thread opens with the maintainer's entire first reply being the
single word `debug`. A third ends `pastebin merked the debug`, and several
Discord attachments read `(333 KB left)` where the platform truncated them.

Four things cost the most time, in order:

1. **Version mismatch.** By far the largest. Diagnosed late, after the log has
   already been read.
2. **Getting a debug at all**, and at the right verbosity. `Debug 5 then`,
   `start debug 10 AFTER the variables load`.
3. **Truncation.** Debugs are hundreds of kilobytes; pastebin mangles them and
   Discord cuts them off.
4. **Configuration interactions that look like bugs.** One user spent a thread
   on a "bug" that was `SELLGEMS ON` combined with tied pouches, sending the
   character to Shard as designed.

Every one of those is preventable by the tool rather than by the human. The app
ships the bridge script, so it knows what version should be installed and says
so on connect. It captures its own trace, so nobody has to know a verbosity
flag. It keeps the report small enough not to be truncated. And it reports
config state alongside the failure.

### Wounds: the summary line contradicts the wound list

A player set their heal city to Fang Cove, travelled there correctly, and then
herb-healed instead of visiting the healer. The log:

```
health
Your body feels at full strength.
Your spirit feels full of life.
You have some minor abrasions to the left arm, some minor abrasions to the
left hand, some minor abrasions to the chest.
You have no significant injuries.
```

Three wounds listed, and then a summary line saying there are no significant
injuries. The script trusted the summary, decided nothing needed healing, and
went on. The player, having turned "heal all" on, expected a healer visit.

Neither is wrong. `HEALTH` gives both a wound list and a severity summary, and
which one a tool trusts is a **policy decision that belongs to the player**,
not a threshold buried in a script. `check_health` should report both, and any
"go heal" decision should expose the threshold it used.

### Multi-hop transport needs an arrival check on every hop

A Platinum character asked to travel to Crossing and looped through the portal
network nine times:

```
* Starting ZoneID:67  RoomID:455
* Starting ZoneID:107 RoomID:273
* Starting ZoneID:30  RoomID:331
* Starting ZoneID:90  RoomID:468
* Starting ZoneID:40  RoomID:254
* Starting ZoneID:47  RoomID:97
* Starting ZoneID:116 RoomID:188
* Starting ZoneID:1   RoomID:484     <- zone 1 is Crossing. It arrived.
* Starting ZoneID:99  RoomID:115
```

It reached the destination on the eighth hop and kept going. The same bug was
reported in July, fixed, and reported again in August, which is what happens
when arrival is inferred from control flow rather than checked.

The lesson for `planTravel`: every hop needs an explicit "am I there yet"
against the actual destination, evaluated after the move completes. This is
also why the Athletics thresholds in `obstacles.ts` matter less than they look:
knowing you *can* make a crossing is worth much less than knowing whether you
just did.

### Creature names carry post-strings that break parsing

> "when critters are under the effect of shadow web, they have a post string of
> being webbed which is messing up the appraisal (its trying to
> `appraise web quick`)"

and later, the same for `(flying)`. Anything that parses a creature name out of
room text has to strip trailing state markers first, or it will build commands
out of them.

### Game text does not always break where you expect

> "It looks like the action within uber is expecting the second sentence to be
> on a new line, but it isn't."

A two-sentence backlash message arrived on one line, so a pattern anchored with
`^` on the second sentence never fired, and the character stayed in combat
through a spell backlash. Anchoring to line starts is a real hazard when the
game concatenates.

### Fang Cove: `go meeting portal`, not `go portal`

> "uber goes to wyvern trials when attempting to go to fang cove at times.
> Need to change go portal to go meeting portal."

A bare `go portal` in a room with more than one portal picks the wrong one.
Worth remembering that DR room nouns are frequently ambiguous and the fix is
almost always a longer noun phrase.

---

## 21. Lessons from the wider scripting channel

A second run of community traffic, this time from the general Genie/Lich/Wrayth
help channel rather than one script's bug queue.

### The rule is that you monitor it, and the failure mode is a script running wild

> "You're aware that this is not a private discord with a restricted invite, so
> GMs can and DO lurk in here right? So maybe immediately coming to an
> effectively public area and going 'Hey guyz, how do I afk script better and
> not get caught?' after JUST getting popped for AFK scripting isn't the
> smartest move?"

An earlier draft of this section read that as a warning about surveillance and
built a conclusion about self-incrimination on top of it. That was wrong, and
the correction matters because it points at a different and better feature.

The actual advice is: do not be obnoxious and obvious. Enforcement is mostly
reactive. Unattended play draws action when a script becomes *visible*, usually
by getting out of control. Otherwise a GM is more likely to drop an invasion
into a suspiciously quiet room, or to leave it alone.

**The rule itself is simple and not in dispute: on Prime and on Platinum the
script must be monitored.** That obligation belongs to the person at the
keyboard. This app is built to make attending easy rather than to argue about
it.

What that means for design is more useful than any warning could be. What gets
a player noticed is a script doing something visibly stupid for a long time.
Section 20 has a perfect specimen: a character teleporting through the portal
network nine times, passing through its own destination on hop eight and
carrying on. Another player in the same channel sat "endlessly looking at the
ferry and never getting on".

So the feature this argues for is **runaway detection**. If the Companion is
repeating itself without making progress, the right response is to stop and say
so. That serves the player directly, since their character is achieving nothing
anyway, and it is the whole difference between automation that is boring and
automation that is conspicuous.

Separately, and for ordinary reasons rather than this one: a GitHub issue is
public and permanent and carries a character name and a slice of play history,
so the report dialog says so before anyone posts one.

### The refusal-handling bug, in the wild

> "sometimes a script issues a command early, and I get the '...wait 1 seconds.'
> text. I tried to add a Matchwait command for '...wait' to attempt to fix
> this, but it doesn't seem to detect it"
>
> "you probably messed up the match... that's an extremely common match"
>
> "the match was there, but placed in the wrong waiting block. face --> palm"

This is exactly the failure `Companion::Cmd` exists to make impossible. Every
script author writes this handling, most of them write it more than once, and
putting it in one place that everything goes through is the whole reason that
module is separate.

### Game display toggles change the text your parser sees

> "okay, gonna delete all that as I finally found the issue & its not related to
> mc at all. Culprit in that blasted invbrief on the toggle list."

A player spent a week on a crafting script that claimed they had no materials.
The cause was `INVBRIEF`, a game setting that shortens inventory output. The
script was parsing text the game had stopped printing.

Anything that parses game output is at the mercy of the player's display
settings. `BRIEF`, `INVBRIEF` and friends silently change the shape of what
arrives. A tool that reads inventory or room text should check these at
startup and either normalise them or say which ones will break it, rather than
letting someone lose a week to a toggle.

### Vitals really are percentages

> ```
> Your body feels at full strength. (100%)
> Your spirit feels full of life. (100%)
> ```

This confirms the assumption behind `healthMax: 100` in the bridge, which was
previously flagged in `TESTING.md` as unverified. It is right.

### The wound summary confusion is common, not a one-off

The same player, running the standard Lich healing scripts:

> "when I run them I'm still left with some boo-boo's:
> `You have minor scarring along the neck, some minor abrasions to the right
> leg, a few nearly invisible scars along the chest`"

That is the second independent report of the same confusion described in
section 20: healing "worked" and wounds remain, because scars and minor
abrasions sit below whatever threshold the script used. Two people confused by
the same thing in two different channels is a design problem, not user error.

It reinforces the conclusion there: report both the wound list and the summary,
and make the threshold visible rather than implicit.

### Lich is our backend, not a migration we are asking anyone to make

Lich runs under **Wrayth** as well as Genie, so frontend detection should not
assume Genie.

More importantly, an earlier draft of this section got the adoption story
badly wrong. It quoted this:

> "I don't lich. I just genie script. It's what I know now, and I'm too GD old
> and tired to learn a new language/system."

and concluded that DR Companion "requires Lich", calling it an adoption
ceiling. That is not what installing Lich does to a player.

Lich is a **proxy** that sits between the frontend and the game server. The
frontend still runs, and everything it does still works. A Genie player who
installs Lich keeps every `.cmd` script they have, keeps their variables files,
keeps their muscle memory. Nothing about their setup is replaced or has to be
rewritten.

So Lich here is **our plumbing, not their new toolchain**. It is how this app
reads character state and stops scripts, and the player does not have to learn
any of it, write any of it, or give anything up to have it there. The person
above can carry on genie scripting exactly as before and still run the panel.

That is worth saying out loud in the setup screen, because "install Lich"
reasonably sounds to a Genie user like "switch to Lich", and that is the
objection to answer rather than accept.

### Free alternatives exist, and matter for positioning

The channel routinely points newcomers at free tooling: `Tirost/DR-Genie-Scripts`
for hunting, `Dasffion/Mastercraft` for crafting. The paid combat script is
described as "pretty slick but super expensive". A free, open, well-documented
tool is landing in a space where free alternatives are already the default
recommendation, which is a good position to be in and an argument for keeping
the licence permissive.

---

## 22. Connecting Genie to Lich, and why people lose days to it

More community traffic, from the Lich help channel. The single clearest
finding: installing both pieces is not the hard part. Making them talk is.

> "Is there anyone that can walk me through installing lich for genie? Im
> seeing everything pointing to wrayth and stormfront but when I try following
> that install instructions I only got it to login with stormfront not genie.
> **Ive been at this for 2 days** and I really want to come back to play again"

> "You can't launch genie with the lich launcher"

> "Lich is installed separately, and then Genie connects to it through the port
> Lich opens."

A setup screen that detects Lich, detects Genie, ticks both, and says nothing
leaves someone at exactly that cliff. So the app now shows the procedure, with
the values filled in for the instance they pick.

From the Genie 4 wiki, "Connecting and Profiles":

| Instance | Lich port | Launch arguments | Profile suffix |
|---|---|---|---|
| Prime | 11024 | `--genie --dragonrealms` | `DR` |
| Platinum | 11124 | `--genie --platinum --dragonrealms` | `DRX` |
| The Fallen | 11324 | `--genie --fallen` | `DRF` |
| Test | 11624 | `--genie --test --dragonrealms` | `DRT` |

The commands, typed into Genie: `#lichsettings` (or `#ls`) to see the current
values, `#config lichport N` and `#config licharguments ...` to change them,
`#config save`, then `#lichconnect CharacterNameDR` (or `#lc`).

Prime is the default, so Prime users usually change nothing. Everyone else has
to, and getting the port or the arguments wrong is exactly the sort of failure
that produces no useful error.

Default paths from the same page, which also improved detection:
`C:\Ruby4Lich5\Lich5\lich.rbw` with Ruby at `C:\Ruby4Lich5\X.X.X\bin\rubyw.exe`.

### Genie 5 is too new to recommend to a newcomer

An earlier pass marked Genie 5 portable as the suggested download, on the
grounds that it is actively developed, checksummed, and unpacks cleanly. Both
the project and the help channel say otherwise. Genie 5's own README opens
with a warning:

> **Beta** — Genie 5 is in active development ... Expect rough edges.

and in the channel:

> "5 5.0.0-alpha.7.11" … "It tells me Unknown Command: ls"
>
> "Ah gotcha, yeah Genie5 is like brand spanking new." … "its baaaaby."

The `#lichsettings` command the connection guide depends on does not exist in
their build. A returning player was steered to Genie 4 and got working. So the
suggestion is now Genie 4, with Genie 5 offered beside it and labelled for what
it is. Genie 4 went free and open source, so this costs nothing.

### Lich does not always notice it has been disconnected

> "It would appear that lich is none the wiser that I was disconnected from the
> game."

> "Anyone else having their connection crap out? It doesn't give an error
> message of any sort; the output from the game just dies, and I have to
> reconnect. Seems to happen 2-4 times a day, minimum."

This is the exact failure the game-clock liveness check in `RealBridge` was
built for, and it is more common than assumed: an open socket, a live-looking
Lich, and no game behind it. Worth keeping, and worth surfacing clearly rather
than as a footnote.

### Config-shaped failures dominate support, everywhere

Three in one afternoon, all in YAML, all presenting as script bugs:

- `loot_delay` left with no value → `can't convert NilClass into an exact number`
- `guilty_plea` nested under another key instead of at the root, so it never applied
- an optional argument accepted at the front of a command list but not the back

None of these are logic errors. They are what happens when configuration is
hand-edited text with no validation, which is the same finding as section 18
from a different direction. Companion's settings being UI-driven and typed
removes this whole category rather than documenting it better.

### Genie scripts and Lich scripts are not interchangeable

> "how likely do genie commands work on a script in lich?"
> "They don't. Lich is written in ruby"

Both true and compatible with section 21: installing Lich does not break the
`.cmd` scripts a Genie user has, because Genie keeps running them. What a user
cannot do is port one to the other. Nobody has to.

### Multi-character players lose their logs

> "with the number of people who multi-character + login rewards, we should
> probably look at sorting debug logs out by character name. Right now they get
> overwritten FAST"

Worth doing here before it bites: the trace and any saved report should carry
the character name, and a saved report filename should include it.

---

## 23. There are many frontends, and we are a GUI for Lich

The clearest framing of what this project is, from Dan: *Lich is a layer on
top, and we are adding a GUI to Lich.* That has consequences the earlier
sections did not draw out, because they treated Genie as near-required.

The community is actively using at least: **Genie 4 and 5**, **Wrayth**
(formerly StormFront), **Frostbite**, **Saga** (Simutronics' own newer client),
**Avalon**, **ProfanityFE**, **Vellum**, and **Warlock 3**. People switch
between them and argue about them cheerfully. Lich sits under all of them.

So the frontend is the user's business, not ours. What we need from it is
nothing at all; what we need from Lich is everything.

### The comma

> "genie uses commas to start lich scripts, every other FE uses semicolon"

Every instruction this app gave said `;companion_bridge`. For a Genie user that
is wrong, and it fails **silently**: Genie passes it to the game as a command,
the game says it does not understand, and the bridge never starts. The most
common frontend, the first instruction, no error worth reading.

That is now in `lib/frontends.ts` with the prefix per frontend, and nothing
in the app hardcodes a punctuation mark any more.

### Which way round the connection goes

The two-day confusion in section 22 has a specific cause:

> "You can't launch genie with the lich launcher"

For most frontends you launch **Lich**, and Lich brings the frontend up:

```
ruby lich.rbw --dragonrealms --frostbite
```

For Genie it is the opposite: Genie launches, and you point it at the port Lich
opened, via `#lichsettings` and `#config`. A guide written for one looks broken
if you are on the other, which is exactly what happened to the person who spent
two days on it. The setup screen now asks which frontend and shows the matching
direction.

### Lich already has travel, and we should probably use it

`;go2` is Lich's own travel script, and `;map` its mapper. Both are in active
use and maintained by people who play the game daily.

This is worth taking seriously before writing more of `travelPath.ts`. The
argument for delegating rather than reimplementing is the same one that made
Ruby4Lich5 the right install route: it is the thing their community supports,
troubleshoots and fixes. A companion that drives `;go2` inherits every fix
anyone makes to it. One that reimplements pathfinding owns every bug forever.

### Room IDs come in two flavours

```
[Tower South, Aether Floor] (88032)
>;go2 88032
[go2: error: room number (88032) was not found in the map database]
```

The number the game displays is a Simutronics room id. Lich's map database uses
its own ids, and `;go2` wants those, or a `u` prefix for the Simu one. So
`Room.current.id` is not the number a player sees on screen, and anything that
shows or accepts a room number has to be clear about which it means.

### More settings that change what automation sees

Section 21 had `BRIEF` and `INVBRIEF`. Add **typeahead**: a player on Saga had
to drop it from 4 to 3 before `;go2` worked properly. Anything that sends
several commands in sequence is at the mercy of it, and `Sorry, you may only
type ahead N commands` is one of the three refusals `Companion::Cmd` already
handles, which is not a coincidence.

### Custom scripts shadow stock ones, and confuse debugging

> "cause it's referencing lines 10, 11, 12 ... as constants but I'm not seeing
> those at that line at all" — "are they in your custom folder?" — "yes"

Lich loads scripts from a `custom` folder in preference to the stock ones. A
debug log then refers to line numbers in a file the maintainer is not reading.
Same family as the version-mismatch problem in section 20: the log and the
source disagree, and nobody notices for a while.

### Lich versions are not always releases

```
;lich5-update --status
  Version: 5.16.2
  Type: Branch (Development)
  Branch: fix/econnreset-spam-and-walk-to-recursion
  Repository: MahtraDR/lich-5
```

People run development branches from forks. Our version reporting should not
assume a release number, and `;lich5-update --status` is worth suggesting in a
bug report rather than asking someone to remember.

---

## 25. The YAML wall, which is the thing worth removing

Reading the documentation rather than the chat logs, as Dan pointed out, puts
the central problem in sharper focus than any bug report did.

To use `dr-scripts`, the main free Lich script suite, their own
"Getting Help With Lich" page asks a newcomer to:

- read the YAML guides: Intro, Part 1, Part 2, Part 3, and Part 4 on anchors
- install **Visual Studio Code with the Red Hat YAML Plugin**
- hand-write a character setup file
- override the right keys without editing `base.yaml`
- run `;validate` and read its output
- "Validate your YAML through an online parser tool"

The sizes are the part that lands:

| File | Size | Who writes it |
|---|---|---|
| `base.yaml` | **94 KB** | the project, and you must not edit it |
| `SampleBard-setup.yaml` | **21 KB** | you |
| `SampleBarbarian-setup.yaml` | **16 KB** | you |

And the syntax is not the easy half of YAML:

```yaml
safe_room: &my_safe_room 1234
crossing_training_sorcery_room: *my_safe_room
outfitting_room: *my_safe_room
```

Anchors, aliases and merge keys (`<<: *`), with the documented caveat that
anchors do not cross files. Files load in a fixed order — `base.yaml`, then
`<Character>-setup.yaml`, then `<Character>-<Arg>.yaml` — and **the last one
wins**, which is exactly the mechanism behind the config-shaped failures in
sections 21 and 22: a setting silently overridden by a later file, presenting
as a script bug.

None of this is unreasonable for the people who wrote it. All of it is a wall
for someone who wants to come back to a game and click things.

**And the settings are structured, typed data.** A herb entry is a record with
`name`, `size`, `stackable`, `room`, `price`, `quantity`. A form produces that
correctly every time; a person counting spaces does not.

So the highest-value thing this project can do is not to build another
automation suite. It is to be the interface to the one that already exists and
works. That reframes the roadmap, and it is worth deciding deliberately:

- **As it stands**, Companion has its own settings and its own intents, and
  every game behaviour is ours to write and own.
- **The alternative** is that Companion is a GUI over dr-scripts: settings are
  edited in forms and written as valid YAML, and the playing is done by a
  mature, maintained suite that we drive rather than duplicate.

The second is far more value per unit of work, matches the interop principle
that made Ruby4Lich5 the right install route, and is a much better answer to
"let people have fun without a CS degree". They are not exclusive: the panel,
the console, the safety layer and the setup flow serve either.

### What is built so far

`Companion::Yaml` reads the profiles a character actually loads, in load order,
and parses each one. A syntax error is reported with its **line number**, which
is the thing people are currently pasting into an online parser to discover.
It never writes anything.

Tested (`lich-scripts/test/yaml_test.rb`) against realistic profile content:
anchors resolve to values rather than text, a mis-indented file reports the
right line, an undefined alias is caught, and load order comes back
base-first.

### Documentation worth having read

- `;validate` checks a YAML profile in game
- `;<script> help` works on dr-scripts scripts, e.g. `;alchemy help`
- `;script-watch` lists running scripts
- `;display lichid` controls room-id display
- The settings vocabulary is catalogued on Elanthipedia's
  [Lich script repository](https://elanthipedia.play.net/Lich_script_repository),
  which is the reference a settings GUI would be built from
- Lich itself: scripts live in `Lich/scripts`, are invoked with `;name`, and
  `go2` is described as working "just like Genie's goto"
