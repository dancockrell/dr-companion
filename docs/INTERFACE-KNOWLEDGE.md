# Interface knowledge, harvested before the rebuild

Written 3 Sep 2026, before any UI code is deleted.

## Why this document exists

The React interface is being replaced, and the 2D art it renders is being
deleted. Most of that code is disposable. **The reasoning inside it is not.**

These panels were not designed at a whiteboard. Nearly every decision recorded
below is a *correction* — a first version that looked reasonable, shipped, and
turned out to be wrong for a reason that is only visible while playing. That
class of knowledge cannot be re-derived by reading the game's documentation or
by asking a model to design a MUD client. It costs a year of play to learn and
an afternoon to lose.

The rebuild also changes platform, not just code. Anything written down only as
a React component is gone twice over. So this is deliberately stated as
**principles and findings, in prose, with the source file named** so the
original reasoning is recoverable until the moment the file is deleted.

Each item is tagged:

- **[universal]** — holds for any MUD. Belongs in the skin's design language.
- **[game-fact]** — true of DragonRealms specifically. Belongs in an adapter or
  its manifest, never in the skin.

---

## 1. The organising insight: a companion you have to *search* is one you look away from the game to use

**[universal]** This is the sentence the whole interface is downstream of
(`MindstateBoard.tsx`). A MUD client competes for attention with the MUD. Any
panel that requires reading rather than glancing has already lost, because the
player's eyes are on the text stream and the fight is continuing while they
look away.

Practical consequences, all of which held up:

- **Everything visible at once beats everything reachable.** Forty cells in a
  grid is a glance; forty rows in a list is a search.
- **A widget that argues for its own importance is a widget that failed.** The
  vitals cluster was once tall mixer columns with dashed danger notches and
  percentage caps — "ceremony" that spent ink asserting significance while
  failing to say which vital was which. One thin line each, word, bar, number,
  was strictly better.
- **Colour is the scarcest channel. Do not spend it on identity.** The vitals
  bars use *one* ramp across all five pools — green, amber, red — rather than a
  hue per vital. A hue per vital is decoration, because the label already says
  which one it is, and it consumes the only channel that could answer the one
  question anybody asks: *which pool is running out.* A wall of green means
  nothing needs you; one red line is findable without reading a word.

## 2. Redundant encoding, because players are not all the same

**[universal]** Wound severity on the paperdoll is carried by **three**
channels, so none carries it alone: colour (warn → danger), opacity and outline
weight (so it survives colour-vision deficiency), and a severity *word* in the
hover/focus text. Anything safety-critical should encode at least twice, with
at least one non-colour channel.

Related, and easy to lose: **there is a legibility floor.** This interface set
it at 12px and treated it as inviolable, which is why nothing on the paperdoll
is labelled directly — a label would have to break the floor. The information
moved to hover and focus instead of shrinking. *Shrink the set of things shown,
never the type.*

## 3. Anything that counts down must be computed locally, not displayed as received

**[universal]** The single best bug in the codebase (`RoundtimeMeter.tsx`). The
server sends "roundtime: 4.0s", measured when the payload was built. Status
pushes are seconds apart. So the display sat at 4.0 while the real timer ran
out, then jumped. **The one field whose entire value is that it shrinks was the
one field shown standing still.**

The fix generalises to every gate, cooldown, balance or lag timer in any MUD:
store *value plus arrival time*, render *value minus elapsed*, redraw ~10×/sec,
stop at zero. A whole-second tick reads as frozen — a 3-second timer spends a
third of its life on each number. One decimal moving is unmistakably alive.

This is why `ActionGate` in `src/domain/model.ts` carries an absolute `until`
rather than a duration. A duration is the shape that caused this bug.

## 4. Colour must mean one thing across the whole interface

**[universal]** Roundtime is styled `warn`, deliberately never `danger`, because
**red in this app means health**. Confusing "wait two seconds" with "you are
dying" is worse than either signal alone. Before the rebuild, fix the meaning of
each tone once — danger = you are being hurt, warn = you are blocked but fine,
good = headroom — and never let a panel borrow a tone for a different axis.

## 5. Invert the progress bar when full is bad

**[game-fact]**, but the *pattern* is **[universal]**. DragonRealms mindstate
runs 0–34, and 34 means that skill's pool will absorb no more; training it is
wasted time. So the board is inverted against normal progress-bar thinking: a
full bar is a **warning**, and what the eye should catch is the **dark** cells,
because those are the ones worth filling.

The general rule: before choosing a visual encoding, ask *which state is the
one the player must act on*, and make that the salient one. Do not assume full
is good. Any MUD with a capped-pool learning model has this shape.

## 6. Ordering inside a cramped card is a ranking of volatility

**[universal]** In the collapsed creature card (`CreatureCard.tsx`) the order is:
band, then alive/dead, then stunned, then as much of the name as fits. Level is
deliberately excluded — **it cannot change during a fight, so it loses to
status.**

That is a reusable rule for every constrained display: *what changes fastest and
matters most wins the space.* Static attributes belong in the expanded view.

## 7. A roster is where a confidently wrong answer is worse than a gap

**[universal]** The stream parser refuses to pair creature names to their status
records unless the two counts match, and omits creatures entirely rather than
risk a wrong pairing (`src/types/stream.ts`). The reasoning: a room roster is
what combat and threat awareness read from, so an honest gap is safe and a
plausible error is not.

Same principle as the epoch rule in the domain model, and the same principle
behind the stale-link work. **State it once in the skin's design language:
absence is renderable; wrongness is not.**

## 8. Show the denominator, always

**[universal]** Recurring across `game_link.rs`, the backlog buffer and the
combat radar: a pane that is empty because nothing arrived is indistinguishable
from one that is empty because everything was dropped. So the client counts what
it received and what it discarded, and shows it. Every "nothing here" state
should be able to say *why* it is empty.

## 9. Risk panels should answer the question a player actually asks

**[game-fact]**, pattern **[universal]**. `RiskBar.tsx` shows favors (consumed on
death to reduce the penalty), contested room occupancy, and encumbrance —
because the real question before a hard hunt is *"can I afford to die right
now, and is someone already here?"*, not "what are my stats".

The general move: find the **decision** the player repeats most often, and build
the panel around that question rather than around the available data. The
available data is what produced the tall mixer columns.

## 10. Findings that read as bugs but are design constraints

**[universal]** Worth carrying because each was found the expensive way:

- Two panes labelled with the same word one pipe apart is worse than either
  alone — group captions are mandatory when two vocabularies share a row
  (`streamLabels.ts`).
- Overlapping a secondary indicator on a primary one at identical coordinates
  makes it permanently invisible and nothing errors. The paperdoll's `back`
  was drawn exactly on top of `chest` for months.
- An indicator too thin to compete for attention is too thin to read at all;
  widening it turns it into a different thing. Some concepts do not have a
  small visual form and belong elsewhere entirely — nerve damage moved off the
  doll to an icon that could carry graduated severity legibly.

## 11. What must NOT be carried over

Named explicitly, because these are the parts that feel like design and are
game vocabulary:

- Body-part wound taxonomies. GemStone models wounds *and* scars per location
  with severity ranks; DragonRealms differs; most MUDs have one number.
- Mindstate, guilds, societies, account tiers, favors, encumbrance levels,
  circles, crit ranks.
- The five-vital set. Even the two Simutronics games disagree.
- Any assumption that a room has a stable id, or that exits are compass points.

All of these belong to an adapter and reach the skin only as manifest-declared
extensions. The *design principles* above survive; the *nouns* do not.

---

## 12. Source files, until they are deleted

`Paperdoll.tsx`, `MindstateBoard.tsx`, `RoundtimeMeter.tsx`, `RiskBar.tsx`,
`VitalCluster.tsx`, `CreatureCard.tsx`, `CombatRadar.tsx`, `StatusBoard.tsx`,
`RoomCards.tsx`, plus `lib/cards.ts`, `lib/vitals.ts`, `lib/body.ts`,
`lib/combatRadarLogic.ts` and `docs/DESIGN.md` (S1.5 type floor, S4 art pack,
S6 card tiers).

Read the file-header comments before deleting. They are where the reasoning
lives, and this document is a distillation, not a replacement.
