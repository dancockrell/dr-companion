# Tasks and bounties, from sources

Research pass, 10 Sep 2026, for Lane Y0 (`docs/PLAN_TO_1_0.md`). Sources are
Elanthipedia and the vendored Lich scripts at `C:\Ruby4Lich5\Lich5\scripts`
(read only — nothing here was run). This document exists because Lane Y is
**absent from the design corpus as well as from the code**: twelve design
documents mention bounties once, as a stream label
(`docs/WIRING-AUDIT.md:97`), and `docs/DOMAIN.md`'s account of "the real
session loop" (§10) does not mention them at all.

Every claim below carries its source. Where a fact could not be established
from Elanthipedia or the vendored scripts, it is stated as not established and
left out of anything Y1/Y2 would build against — the same discipline
`docs/DOMAIN.md` uses for its own invented numbers (`docs/DOMAIN.md:133`,
"The numbers Companion invented, checked"). Building a bounty panel from
guesswork would be the same defect this repository has already been burned by
twice: an invented portrait fallback (`docs/NEXT-50.md:32`) and a refusal to
invent DR's real Bard song catalogue (`docs/LIVE-STATE.md:281`, "a fabricated
list of songs would be #5's defect in a new panel").

---

## 0. "Bounty" and "Task" are not the same system — and the game calls this "Task"

This is the first and most load-bearing finding, because the client's own
vocabulary (the `bounty` stream label, `docs/WIRING-AUDIT.md:97`, and Lane Y's
own name) all use the word "bounty" for what Elanthipedia documents as the
**Task System**.

- Elanthipedia has a dedicated page, [Task](https://elanthipedia.play.net/Task),
  describing exactly the mechanic Lane Y is scoped to (NPCs hand out work,
  the player accepts, does it, and turns it in for payment). The word
  "bounty" does **not** appear on that page.
- Searching Elanthipedia for "bounty" surfaces a **different, narrower**
  mechanic: the [Assassins game](https://elanthipedia.play.net/Assassins_game),
  a PK minigame where a player collects payment for killing an assigned
  target via `ASK CLERK FOR BOUNTY` at a specific NPC in the Crossing Trader
  Shop Plaza. It also surfaces incidental lore uses of "bounty" (an NPC,
  Elkira Contraire, "has a bounty on her head"; the phrase "bounty hunters"
  used loosely for visa enforcement on `Free accounts`) that are not a game
  mechanic at all.
- In the vendored Lich scripts, `grep -rli "bounty" C:\Ruby4Lich5\Lich5\scripts`
  returns **zero files**, checked across all 236 files in the directory (a
  positive control — the same search for `"task"` returns 21 files, so the
  grep itself is not broken). No script in the player's install automates,
  reads, or mentions a "bounty" of any kind.

So: **what this repository calls "tasks and bounties" is, in the game's own
terms, the Task System.** The `bounty` stream label the client already
recognises (`src/lib/streamLabels.ts`) is very likely a Simutronics XML stream
tag chosen for the Assassins minigame, or for some other narrower thing this
research did not surface a source for — **not established**, and not to be
assumed to carry Task System text. See §5 below; this distinction matters
directly for what Y1 builds.

`docs/BRIDGE_CONTRACT.md` and the client should keep saying "tasks and
bounties" for continuity with the plan and the gap survey, but any new code
(`src/lib/tasks.ts`, panel copy) should use "Task" for the in-game verb and
NPC interaction, because that is the term a player will actually see and the
term the Elanthipedia community documents.

Source: [Task](https://elanthipedia.play.net/Task),
[Assassins game](https://elanthipedia.play.net/Assassins_game),
`docs/WIRING-AUDIT.md:97`, `docs/DOMAIN.md` §10 (silence on the topic).

---

## 1. Who gives tasks

Elanthipedia's Task page states tasks are given by NPCs only — there is no
task board. Named task givers are distributed across many towns: "The
Crossing, Riverhaven, Throne City, Therengia, Shard, Aesry, Ratha, Hara'Jaal,
Mer'Kresh, Hibarnhvidar, Ain Ghazal, and Fang Cove", and the givers include
both guild leaders and specialised NPCs (examples named on the page: Cormyn,
Fara, Daralaendra).

This is confirmed independently by the vendored scripts, which each target a
specific named NPC or set of NPCs:

- `taskmaster.lic:19,20,43` — three named crafting task givers in the
  Crossing, selected by argument: `poltu`, `bradyn`, `zasele`, each tied to a
  specific tool set and a fixed list of room ids (`@rooms`).
- `task-forage.lic` — a foraging task giver, configurable per town
  (`crossing` or `shard`).
- `trade.lic:79` — the Traders' Guild itself is the task giver for trade
  contracts ("concluded your TASK arrangement with the Traders' Guild").
- `ulfhara.lic:129` — a seasonal-event NPC, `zukir`, giving several task
  subtypes at once (see §2).
- `corn-maze.lic:633` — a seasonal-event NPC, a "halfling", giving tasks tied
  to that festival.

Source: [Task](https://elanthipedia.play.net/Task);
`C:\Ruby4Lich5\Lich5\scripts\taskmaster.lic`,
`task-forage.lic`, `trade.lic`, `ulfhara.lic`, `corn-maze.lic` (read only).

---

## 2. What kinds of tasks exist

Elanthipedia's Task page lists nine categories:

| Type | What it involves |
|---|---|
| Boss | Hunt a named boss-variant of a creature in a specified area |
| Crafting | Make a number of high-quality crafted items (mostly festival NPCs); paid in festival tickets, gems, coins, or rare materials |
| Delivery | Transport an item from one NPC to another, sometimes across provinces |
| Foraging | Forage a requested item and deliver it to the task giver |
| Item Recovery | Kill a specified creature at a location until it drops the wanted item |
| Kill | Slay a specified number of a named creature at a given location |
| Searching | Kneel and search specific areas for an item |
| Skinning | Obtain and deliver creature skins |
| Trading | Trader-only contracts completed within a time limit, for bonus pay and experience |

The vendored scripts corroborate three of these directly and add texture the
wiki page does not carry:

- **Crafting** (`taskmaster.lic`): the task names an item, a count, and a
  material base (cloth, bone, stone, yarn, wood, leather, metal), read off
  the "instructions" item the NPC hands over — see §3.
- **Foraging** (`task-forage.lic`): resolves a requested item against a
  per-item location table (`get_data('forage').foragables`) and walks there.
- **Trading** (`trade.lic:79`): the Traders' Guild assigns "contracts across
  the Trade routes", counted down ("asked you to complete 0 more").

`ulfhara.lic:129`, a seasonal (Hollow Eve) task giver, shows several subtypes
being offered from one NPC in one script, matching the wiki's category list
in spirit even though it is a one-off event script rather than the standing
Task System: STUDY (investigation), SEARCH (searching), KILL (kill/boss), and
a "help any of our wounded you encounter" variant not named on the wiki page.
That NPC and its offerings are **festival-specific and not evidence of a
standing mechanic** — noted here for completeness, excluded from what Y1/Y2
should assume is always available.

Source: [Task](https://elanthipedia.play.net/Task);
`taskmaster.lic`, `task-forage.lic`, `trade.lic:79`, `ulfhara.lic:129`.

---

## 3. How a task is accepted

Elanthipedia: the interaction starts with `ASK <person> FOR TASK`. The NPC
offers a task, and the player answers `ACCEPT` or `DECLINE`. A 10-minute
cooldown applies before the player can ask again, whether they accepted,
declined, or the NPC had nothing to offer.

The vendored scripts show the exact in-game text this produces, which the wiki
page does not quote. From `taskmaster.lic:333`, the possible responses to
`ask <npc> for task` (as regex the script matches against real game output):

```
if you agree to (his|her) terms
You may accept by typing ACCEPT TASK
utterly ignoring you
you must wait before I can give you a task
You are already on a task
give you a chance a little later
To whom are you speaking
```

— i.e. the NPC states terms, then tells the player how to accept
(`ACCEPT TASK`); `taskmaster.lic:357-358` shows the accept exchange:

```
"accept task" → "You can check your progress with the TASK verb"
```

`you must wait before I can give you a task` is the 10-minute cooldown the
wiki page describes, confirmed independently by `ulfhara.lic:129`'s identical
phrase. `utterly ignoring you` and `give you a chance a little later` are
additional refusal states the wiki page does not document; `taskmaster.lic`
treats both as "on cooldown or recently canceled a task" and retries after a
pause. `You are already on a task` is the state when the player already holds
one from that NPC.

Cancellation, confirmed by two independent sources: Elanthipedia states a task
can be abandoned with `ASK <person> FOR TASK CANCEL`, with the same cooldown
applying. `corn-maze.lic:635-636` shows the exact command used in a real
script: `ask halfling for task cancel`.

Source: [Task](https://elanthipedia.play.net/Task);
`taskmaster.lic:333,357-358`, `ulfhara.lic:129`, `corn-maze.lic:633-636`.

---

## 4. How progress is reported in the game's own text

This is the part Elanthipedia does not document in reproducible detail — its
Task page describes the Searching subtype's feedback in prose
("you search for a bit, but do not find the item you are looking for" versus
"you don't find anything of interest here" to mean wrong area) but gives no
general progress-check text. The vendored scripts are the source for this,
because they parse real game output with regexes that have to match verbatim
or the script breaks — so what they match against is close to a primary
transcript of the real message.

The **TASK verb** is confirmed (both by Elanthipedia and by `taskmaster.lic`)
as how a player checks an active task's progress. For a crafting task,
`taskmaster.lic:359` matches the TASK verb's output as:

```
wanted you to craft (.*) and indicated that (\d+) would suffice.
So far, you have returned (\d+)
```

i.e. the game states the requested item, the total count needed, and how many
the player has turned in so far, in one sentence. `taskmaster.lic:304`
confirms the no-task state: asking `task` with nothing active returns
`You are not currently on a task`, which the script also uses to distinguish
"nothing accepted yet" from "task in progress" — a real, observed pair of
states, not an assumption.

For trade contracts, `trade.lic:79` matches completion text —
`You are certain you have concluded your TASK arrangement with the Traders'
Guild` — and an in-progress remainder count —
`The clerks responsible for assigning contracts across the Trade routes of
.+ have asked you to complete 0 more` (the script's own comment: this is a
countdown, read live from the game, not computed by the script).

**Not established**: exact progress text for Boss, Delivery, Item Recovery,
Kill, Searching, or Skinning tasks. The wiki's Searching quote above is the
only other subtype with any wording evidence, and even that is prose
paraphrase on the wiki page rather than a script-matched regex. Left out of
what Y1 should assume it can parse for those subtypes.

Source: [Task](https://elanthipedia.play.net/Task);
`taskmaster.lic:304,359`, `trade.lic:79`.

---

## 5. How a task is turned in

Elanthipedia: `GIVE <item> TO <person>`. Confirmed exactly by
`taskmaster.lic:542`, which sends `give my #{item} to #{@npc}` and
distinguishes two outcomes by matching the response:

```
"more .* needed"   → not yet complete (loops back to find_npc and retry)
"hands you a"      → the NPC hands over a reward, task complete
```

For crafting tasks this is a loop — the player may need to make more than
they can carry in one batch — and `taskmaster.lic` retries `give` in a loop
against the same two outcomes until the NPC's response contains
`hands you a`.

Trade contracts are turned in differently: `trade.lic:79`'s completion text
(§4) fires on its own once the last contract crate is delivered along the
route, rather than a single `give` at the end.

**Not established**: turn-in text for Boss, Delivery, Item Recovery, Kill,
Searching, or Skinning tasks beyond the generic `GIVE <item> TO <person>` the
wiki page states applies game-wide.

Source: [Task](https://elanthipedia.play.net/Task); `taskmaster.lic:542`,
`trade.lic:79`.

---

## 6. What a failure or expiry looks like

This is the weakest-sourced section, and it is reported that way rather than
filled in.

**Established**: voluntary abandonment. `ASK <person> FOR TASK CANCEL`
(Elanthipedia), confirmed in real use by `corn-maze.lic:635-636`
(`ask halfling for task cancel`). Cancelling carries the same 10-minute
cooldown as accepting or declining (Elanthipedia). `ulfhara.lic:129` shows the
in-progress refusal a player sees if they try to take on a second task from
the same giver while one is open: `You are already on a task.  Please
complete that task` (note: this exact phrasing is from a festival NPC; the
standing-system phrasing in `taskmaster.lic:336` for the same state is
`You are already on a task`, without the trailing sentence — the two scripts
were not necessarily transcribing the same NPC, so both are recorded rather
than merged into one claim).

**Not established, and left out rather than guessed:**

- Whether a task can **expire on its own** (a timer running out without the
  player cancelling) — no source, wiki or script, describes this. The
  `NEXT-50.md:32` / `LIVE-STATE.md:281` discipline this document follows
  means Y1/Y2 must not assume expiry exists as a state to display.
- What happens if a player logs off mid-task and returns — not covered by
  either source.
- Whether failing the task's underlying activity (e.g. dying while on a Kill
  or Boss task, or the target creature despawning) has a distinct message
  from ordinary cancellation — not covered by either source.
- Progress-loss behaviour: whether partial delivery progress (e.g. some but
  not all crafted items turned in) survives a cancellation and re-accept —
  not covered by either source.

A session building Y1/Y2 should treat "no task" and "task cancelled" and
"task in progress" as the three states this research can support, and should
not add a fourth ("expired", "failed") without a new source.

---

## 7. The `bounty` stream label, and what it means for Y1

Y1's own scope note (`docs/PLAN_TO_1_0.md`, Lane Y) says: "The `bounty` stream
label already exists in `StreamTabs`' vocabulary, so the reading half may
already be arriving unlooked-at — check that before writing a parser, and say
which it was." That check was done as part of this research pass.

**The label exists, but nothing confirms it carries Task System text, and one
source suggests it probably does not.**

- `src/lib/streamLabels.ts` maps `bounty: 'Bounty'` — this is a real,
  committed vocabulary entry, not a guess.
- `src/components/game/StreamTabs.tsx` only creates a tab for a stream id
  once the game has actually pushed a `pushStream id='<id>'` for it
  (`docs/GAP-2026-09-09.md:201`: tabs for "thoughts, death, talk, whispers,
  logons, familiar, group, room, bounty, assess, inv, society... created only
  when the game actually uses one"). So the presence of the label in
  `streamLabels.ts` is evidence someone (a prior session, reading Simutronics'
  own protocol documentation or observing it live) saw the server declare a
  stream literally named `bounty` — it is not invented, but this research
  pass found no citable primary source recording when or how it was captured.
- **`docs/GAP-2026-09-09.md:201`** records that tagged-stream tabs (which
  `bounty` is one of) "stayed empty on the one live session" tested, with
  `isTaggedStream()` in `gameLink.ts` named as the discriminator and "the
  cause is not established" — i.e. on the one live test this client has had,
  no stream tab, including `bounty`, ever received text. `docs/LIVE-STATE.md`
  §"Channel tabs stay empty on live" is the fuller record of that same
  finding.
- Per §0 above, Elanthipedia's Task page (the mechanic Lane Y is actually
  about) never uses the word "bounty", while a real, separate DR mechanic (the
  Assassins minigame) does use it verbatim (`ASK CLERK FOR BOUNTY`). A stream
  tag named `bounty` is at least as likely to belong to the Assassins minigame,
  a court/outlawry system, or something else entirely as it is to belong to
  the Task System — this research found no source establishing which.

**What this means for Y1**: do not assume the `bounty` stream carries Task
progress text. Y1 should establish, against a live character (not
assumed), what actually arrives tagged `bounty` before building a parser
against it — and if nothing does (consistent with the one measurement this
repo already has), Y1's reading half has no channel to read yet and should
say so rather than parsing an untested assumption.

Source: `src/lib/streamLabels.ts`, `src/components/game/StreamTabs.tsx`,
`docs/GAP-2026-09-09.md:201`, `docs/LIVE-STATE.md` ("Channel tabs stay empty
on live"); §0 above for the Task-vs-Assassins-bounty distinction.

---

## 8. Summary table

| Question | Established | Source |
|---|---|---|
| Who gives tasks | NPCs only, no task board; named givers across many towns | Elanthipedia [Task](https://elanthipedia.play.net/Task); `taskmaster.lic`, `task-forage.lic`, `trade.lic`, `ulfhara.lic`, `corn-maze.lic` |
| What kinds exist | 9 categories (Boss, Crafting, Delivery, Foraging, Item Recovery, Kill, Searching, Skinning, Trading) | Elanthipedia [Task](https://elanthipedia.play.net/Task); 3 of 9 corroborated in scripts |
| How accepted | `ASK <person> FOR TASK`, then `ACCEPT`/`DECLINE`/`ACCEPT TASK`; 10-min cooldown; `TASK CANCEL` to abandon | Elanthipedia; `taskmaster.lic:333,357-358`; `corn-maze.lic:635-636` |
| Progress text | Exact regex-matched text for Crafting and Trading only | `taskmaster.lic:304,359`; `trade.lic:79` |
| Turn-in | `GIVE <item> TO <person>`; two outcomes ("more needed" / "hands you a") for Crafting; automatic completion message for Trading | Elanthipedia; `taskmaster.lic:542`; `trade.lic:79` |
| Failure/expiry | Only voluntary cancel is established; auto-expiry, logoff behaviour, and activity-failure text are **not established** | Elanthipedia; `corn-maze.lic:635-636`; `ulfhara.lic:129`; `taskmaster.lic:336` |
| Is "bounty" the same as "Task" | **No** — "bounty" names a separate PK minigame (Assassins) and incidental lore; the mechanic this lane is about is called "Task" everywhere it is documented | Elanthipedia [Task](https://elanthipedia.play.net/Task), [Assassins game](https://elanthipedia.play.net/Assassins_game); zero hits for "bounty" across 236 vendored scripts |
| Does the `bounty` stream carry Task text | **Not established**; one live measurement found it (and every tagged stream) empty | `docs/GAP-2026-09-09.md:201`; `docs/LIVE-STATE.md` |

---

## 9. What Y1/Y2 should not do

- Do not invent progress text, expiry behaviour, or turn-in wording for the
  six task types this research could not source (Boss, Delivery, Item
  Recovery, Kill, Searching, Skinning).
- Do not assume the `bounty` stream carries Task System text without
  confirming it against a live character first.
- Do not build a `bounty` verb/parser as the primary read path for "what task
  am I on" without also considering the `TASK` verb response directly — that
  is the one path this research has real, quoted text for.
- `src/lib/tasks.ts` (Y1) should name its exported type for what it models —
  the DR "Task" system — even where the surrounding UI and file names keep
  saying "bounty" for continuity with the plan and the player-facing gap
  survey.
