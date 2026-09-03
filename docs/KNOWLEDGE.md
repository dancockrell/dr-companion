# The knowledge base, and the working rule that goes with it

> **Rule 0 — never fork.** A problem is to be solved, never dodged. Fix the thing,
> replace it outright, or delete the feature — those are the only three moves.
> Never leave two answers to one question standing side by side, and never route
> a parallel path around something you did not want to touch. That is a noodle to
> nowhere, and it is the most serious thing you can do to this codebase.
> Full rule: [`CLAUDE.md`](../CLAUDE.md).

## Why this exists

This is a correction of how the project has been built, not a feature.

Repeatedly across this work the pattern has been: assert something about
DragonRealms, get corrected, go and research it, fix the code. Every one of
those loops was avoidable, and worse, none of them accumulated — the next
session started as ignorant as the last, so the same class of mistake was
available again.

Examples from a single day, all of them checkable in under a second if there
had been anywhere to check:

- "Lich fetches its map database on first connect." It does not.
- "Genie map node ids can be used for travel." They cannot.
- "npc_status gives rich creature state." It gives `dead` and `stunned`.
- "FLUX dev is fine for the art pack." It is non-commercial.

So: index what is knowable, make it queryable in one command, and record every
correction so it is answered permanently rather than repeatedly.

## The rule

**Query the knowledge base before claiming anything about the game, the API, or
the scripts.** A guess that takes one command to check is not worth making.

That applies to me, and it is the reason the tool is optimised for a
five-second answer rather than for completeness.

## What is indexed

| Source | What | Count |
|---|---|---|
| Lich 5 `lib/` | Ruby modules, their methods, paths | 897 |
| dr-scripts | every `.lic`, header, methods, body | 234 |
| Genie scripts | `uber`, `travel`, `disarm`, `burgle` and includes | 43 |
| Elanthipedia | weapons, armor, materials, creatures, NPCs with SMW properties | pulled separately |

Roughly 19 MB of SQLite, built with `node:sqlite` — no dependency, because a
tool that is awkward to install is a tool that stops being used.

## Asking it things

```
node tools/kb.mjs build                 rebuild from all sources
node tools/kb.mjs api getxp             where in Lich does this live
node tools/kb.mjs script weararmor      which script, what is in it
node tools/kb.mjs search burden         which of 3 MB of code mentions this
node tools/kb.mjs item brigandine       what is this thing, exactly
node tools/kb.mjs noun hauberk          what kind of item is this noun
node tools/kb.mjs creature goblin       what is this
node tools/kb.mjs prop damage           which properties exist about damage
node tools/kb.mjs note add "X -> Y"     record something learned the hard way
node tools/kb.mjs note list             what has already been learned
```

`search` is the one that earns its place most often. "Which script deals with
burden" is not answerable by reading, and it returns `travel.cmd` and
`drvariables.rb` in a second.

## A build note worth keeping

The first version indexed only header comments and method names, reasoning that
full text would bury the signal. Then `search burden` returned nothing — because
burden appears in `travel.cmd`'s *logic* and never in its description.

The question actually being asked is "where in three megabytes of somebody
else's code does this idea live", and that requires the code. Bodies are indexed
now, capped per file so one 77,000-line script cannot dominate.

## Keeping it current

`tools/elanthipedia.mjs` pulls the wiki. It is built to be a good guest, and the
reason is sharper than general politeness: **Elanthipedia runs on Simutronics'
infrastructure** — `elanthipedia.play.net` is their domain and their bill.

It is community-*written*, which is easy to mistake for community-hosted. It is
not. So this is not a stranger's server we should be careful with; it is the
server belonging to the company this project is meant to be handed to. Turning
up in their logs as a traffic spike is the worst possible introduction.

- one request at a time, never parallel
- 350 ms between requests
- `maxlag=5`, so it backs off automatically when their database is struggling
- a User-Agent naming the project and linking to it
- **incremental by default** — `recentchanges` since the last run, which is a
  handful of requests rather than 130

```
node tools/elanthipedia.mjs full       once
node tools/elanthipedia.mjs update     hourly
node tools/kb.mjs build                after either
```

Semantic MediaWiki is what makes this tractable at all: `action=ask` returns
500 items *with their properties* in about 1.8 seconds, so the whole item set is
roughly 130 requests rather than 65,000 page fetches. Scraping the HTML would be
both worse data and an abuse of their bandwidth.

### A trap already hit

Property names come from the wiki, not from intuition. Asking for
`Weapon type is` — which sounds right and does not exist — returns 500 rows of
empty columns rather than an error. The real names are `Noun is`,
`Item type is`, `Puncture damage is number`. `node tools/kb.mjs prop <word>`
exists to answer that before writing a query.

## What this is not

Not a fine-tune. Facts do not survive fine-tuning reliably, and a model that
confidently reports the wrong damage value is worse than no model, because the
error is unfalsifiable to whoever reads it.

The data is already structured and exact. If a language model is ever useful
here it is as an *interface* to this database — turning a sentence into a query,
summarising a page — with the facts still coming from the rows. Never as the
store.
