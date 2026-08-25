# How DragonRealms actually works, and what that means for Companion

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

**The frontend itself desyncs.** There is a recovery path named `GENIE_FUCKUP`,
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
