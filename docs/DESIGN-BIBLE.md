# Design bible

Written after building four layout mechanisms in one afternoon — a panel
stack, a column flow, a free canvas, a docking model — each invented on the
spot to fix the last one, none of them designed. The result rendered the map
twice, let rooms bleed past their own boundary, and left half the window empty.

This document exists so that stops. It is not a style guide to admire; it is
the set of decisions that are already made, so that the next change is an
application of them rather than a fresh invention.

---

## 1. What this thing is

**A companion, not a client.** The player already has Genie or Wrayth showing
the game text. That window is where they live. This one sits beside it.

Three consequences, and everything else follows from them:

- **Every pixel here is a pixel not showing game text.** Space must be earned
  by showing what the text stream cannot: where you are, what state your body
  is in, what is in the room, what your scripts are doing.
- **It is glanced at, not read.** The player is looking at the game. They flick
  their eyes here and back. Anything that requires hunting has failed.
- **It never scrolls to reach something important.** Scrolling means looking
  away and searching. If it does not fit, it folds into something smaller that
  still says it is there.

## 2. One layout mechanism

**Regions with shared boundaries, folding into decks.** That is the mechanism.
There is not a second one.

- Space is **divided**, never negotiated. A region owns its rectangle. Panels
  do not each measure themselves and decide independently — that is what made
  the old build feel sticky, six observers all reacting to a resize by changing
  a layout the others were mid-measurement of.
- Boundaries are **shared**. Dragging one takes from one side and gives to the
  other. The total never changes.
- When a region can no longer hold a panel, it **folds**: the panel joins a
  neighbour's deck as a tab. Folding degrades one thing visibly and reversibly.
  Squeezing degrades everything at once and silently.
- **Something is always on screen.** The last region never folds away.

**No automatic column flow.** A browser-like grid that silently rearranges
things under the player is not a layout contract. The client *does* use
purposeful columns: Map, Battle, Game/Scripts, room/inventory, and Skills have
stable jobs and shared splitters. At width those regions earn their space;
they do not become arbitrary wider cards.

So: two modes, docked and free, and no third. Docked regions may sit beside
one another when that keeps a tactical fact visible. They fold only at a named
breakpoint, never because an individual panel guessed it needed more room.

**Free placement is supported**, as a mode the player turns on by dragging a
panel out of its region. Overruled here after this document first banned it:
the objection was that placement freedom produces a desk nobody tidied, and the
answer is that it is the player's desk. They arrange a game window beside a
game client and they know where they want things.

Docked is the default because it needs no arrangement. Free is one drag away
and one control back, and in free mode the same two rules still hold: nothing
leaves the window, and nothing overlaps anything else.

## 3. The map is a first-class workspace

The map is a durable docked region, normally at the left of the workspace, and
can be popped out into its own window. It is not a disposable drawer. Travel,
gateway choices, landmarks, pinning, and the player's position are all facts a
player may need while reading the battle and game stream beside it.

It earns its full measured viewport: no empty priority panel may borrow its
width, and the chart never preserves a fake natural aspect ratio that leaves a
dead black half-column. The docked and popped-out maps share the same toolbar,
pin rail, keyboard navigation, and map state. The map is drawn once per window;
two charts in one surface remain a bug, not a feature.

### Drawing rooms

- The cartography has a **native 10px grid**: authored geometry is retained in
  map coordinates and transformed by one measured viewport. Fit, zoom, drag,
  touch, and resize may never write competing transforms.
- **Rooms never overlap and never cross their container.** A room box is
  smaller than the grid step so neighbours cannot touch.
- Draw the **full verified zone** by default. The player can fit the whole
  world area, then zoom and grab-scroll to a local route without throwing away
  genuine exits or landmarks. Unresolved topology is visibly unresolved; it is
  never guessed into the map.

## 4. Say what things are, in the game's words

**"Service" is not a word DragonRealms uses.** Neither is "component",
"entity", or "item type". The game has banks, healers, guilds, temples,
gates, forges, and the Empaths' Guild specifically.

- A room that is a bank says **bank**.
- A creature is a **kobold**, not an "entity".
- A wound is **minor, serious, severe** — three levels, because that is what
  the game's severity range gives.
- Never invent a category word when the game already has one.

The audience has played this for twenty years. Generic software vocabulary
tells them a programmer wrote the label without looking at the game.

## 5. Colour

Dark, because it sits beside a black game window at two in the morning. But
dark is not the same as grey, and everything being grey is the current failure.

| Token | Use |
|---|---|
| `surface` | the window ground |
| `surface-raised` | a region that holds content |
| `surface-overlay` | something on top of that, briefly |
| `ink` / `ink-muted` / `ink-faint` | text, in descending importance |
| `accent` | **you** — your room, your character, your turn |
| `good` | safe, healed, trained, present |
| `warn` | costly, slow, watch it |
| `danger` | hostile, wounded, stop |
| `info` | a place or a fact, neutral |

Rules:

- **Colour never carries meaning alone.** Roughly one man in twelve has a
  colour vision deficiency and this audience skews male and over forty. Shape,
  position or a number carries it too.
- **Accent means you.** Not "primary button". If it is amber it is about the
  player.
- **Danger is spent, not sprinkled.** If everything is red, nothing is.

## 6. Borders and space

The current build has huge borders and huge margins. Both are wrong.

- **One border per boundary.** A region has an edge. The thing inside it does
  not also have an edge. Nested boxes are the visual signature of a UI nobody
  designed.
- **Hairlines, not frames.** A boundary is 1px. If it needs to be grabbable, the
  hit area is larger than the line.
- **Padding is 8px inside a region, 4px inside a row.** Not 24.
- **No centred max-width columns.** That is a reading-page habit. This is a
  panel; it uses the width it was given.
- **Nothing is labelled twice.** A region with one panel does not need a tab
  saying what it is, a header saying what it is, and a title inside it.

## 7. Type

- **12px floor, no exceptions.** Presbyopia starts in the forties and this
  audience is past it. This has been broken twice; the contrast test now fails
  the build over it.
- Body 13–14px, labels 12px, headings 16–18px. Numbers tabular, so a health
  value does not jitter as it changes.
- **Room for one more line beats one more font size.**

## 8. What the player controls

- Two modes, **basic** and **power**, not a settings tree.
- Boundaries drag. Decks pin their density. Panels tear off into their own
  window. All of it persists per mode.
- A compact disclosure is allowed when it prevents an unbounded row: saved
  pins, large item piles, and container contents may open a named, keyboard
  reachable list. A disclosure must say what it contains and return focus when
  closed; it is not a hiding place for a second control system.

## 9. Ownership and overflow

Every player-visible region has one owner and one failure mode. A component may
contribute data or an action, but it does not get to create a rival header,
command bar, or scroll surface. The current ownership table lives in
[`INFORMATION-OWNERSHIP.md`](./INFORMATION-OWNERSHIP.md) and is part of this
contract: changes to a region's responsibility update that table and its
behavioral test together.

## 10. The test for any new element

Before adding anything, answer: **what question does this answer, at the moment
the player glances at it?**

- "How close am I to dying" — yes, that is the vitals cluster.
- "What is in the room and is it dangerous" — yes, that is the battle deck.
- "Where am I and how do I get out" — yes, that is the map.
- "Here is some advice about training" — no. That is a checklist nobody asked
  for, and it was rightly deleted.

If the answer is a paragraph, the element is wrong. If the answer is "it is
nice to have", it is decoration and this window has no room for decoration.
