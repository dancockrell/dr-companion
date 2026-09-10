# The scene pane becomes the main window, not a corner tile

10 September 2026. Dan, reacting to Lane O's build (`docs/verification/layout-2026-09-09.md`, PR #548/#549, merged as 884806d):

> I am quite sure I said to put the main window to the right. you need to
> figure out your art situation...you are going to get a godot screen with
> basically a modern ui...everything else you need to figure out on your own,
> because it still needs to be a good mud interface without that...right now
> you are random and broken...don't be random and broken.

## Reading the correction

Lane O measured itself carefully and reported a real win: game text went from
17.9% of the window to 52.9%. What it did not measure was the thing that
mattered to Dan's second message - the scene pane's own default state was
`minimap`, drawn at 380px, 10.2% of a 1997px window once combat growth is
backed out (measured then as 489px only because the demo character happened
to be in combat). A panel that small cannot read as "the main window"
whatever chrome Godot eventually brings into it, and treating it as a
corner-tile preview by default is exactly what "random and broken" describes:
a scene pane sized like an afterthought sitting next to a fully-featured MUD
column, with no coherent visual language tying the two together.

This is not a reversal of Lane O's placement. The right corner was correct
and stays; the bottom icon bar was correct and stays; the left text column
staying primary for MUD purposes was correct and stays - Dan's second message
does not touch any of those. What it corrects is the *size and default state*
of the right-hand pane, and, once that pane is meant to carry real visual
weight, the inconsistent chrome around it that a small preview had been able
to get away with.

## What actually changed

### 1. A fourth pane state: `docked`, and it is now the default

`src/lib/scenePane.ts` had three states (`minimap`, `popped`, `hidden`).
Demoting `minimap`'s old *default* behaviour without deleting the small
preview it still describes needed a state of its own rather than redefining
what `minimap` means out from under anyone still choosing it deliberately
(CLAUDE.md section 0 - build on it, don't fork a second implementation
beside it). So:

| state | what it draws | who chooses it |
|---|---|---|
| `docked` | the primary panel, sized like a real panel | the default, every window wide enough to hold one |
| `minimap` | the old small corner tile | a player who wants the text wider than `docked` leaves it |
| `popped` | a window of its own (unchanged) | either |
| `hidden` | nothing; the text gets the width back (unchanged) | either |

The cycling control on the bottom bar now moves through all four:
`docked -> minimap -> popped -> hidden -> docked`. One control, one state at a
time, same as before - see `IconBar.tsx`'s `SceneButton`.

### 2. The default width: 380px -> a real panel

`DOCKED_RAIL_W` (`src/lib/scenePane.ts`) replaces the old `SCENE_RAIL_W` as
the width the rail asks for by default. It is a share of the window, not a
fixed pixel count, for the same reason `columns.ts` stores every other
column preference as a share: a fixed pixel default is only ever the right
proportion on the screen it was measured on. Chosen so the game text still
clears `TEXT_WIDTH_FLOOR` (0.55, `tools/play-first-layout-test.mjs`) with
real margin at every supported size - measured, not guessed:

| size | text share (before, Lane O default) | text share (after, `docked` default) |
|---|---|---|
| 1180x820 | ~28% asked of the rail (text ~72% of window measured with combat growth pulled in) | 63.7% |
| 1366x768 | ~28% | 63.8% |
| 1997x935 | ~19% | 64.0% |

(The "before" column is Lane O's own default-width arithmetic; its measured
verification doc used a combat-widened demo character, which is why the
raw percentages differ from `docs/verification/layout-2026-09-09.md`'s
table - the comparison here is against the same non-combat default the new
number replaces.)

At the app's own 1180px default window this is about 480px for the pane,
against Lane O's 380px default - both wider in absolute terms and, unlike
that default, a large enough fraction of the window to read as "the main
window" rather than a preview. The divider still drags either way; this is a
default, not a rule, exactly as `SCENE_RAIL_W` was.

`MINIMAP_RAIL_W` keeps Lane O's old 380px number and reasoning, now serving
the `minimap` state alone.

Combat growth (`COMBAT_GROWTH`, 1.3x) now applies to `minimap` only, not
`docked`. Measured directly: applying it to both pushed the text share under
55% at every size from 1180px up, because `docked`'s own larger base width
plus a 30% combat multiplier crowds out the text column the same way Lane O's
arrangement did before the fix. `docked` is already sized to be the primary
panel; `minimap`, the small preview, is where the temporary growth still
earns its keep.

### 3. Forcing the fix to actually reach existing state

`SCENE_PANE_KEY` bumped `v1` -> `v2`, and `RAIL_KEY` (`App.tsx`) bumped
`v1` -> `v2`. Without this, an install that had never touched the scene-pane
control was already sitting on a stored `minimap` value and a rail share
derived from the old 380px default - the exact smallness being corrected -
and would have kept it under the new code, because a stored preference wins
over a default. This is CLAUDE.md section 12's "old data under a new
meaning" trap: `minimap` used to mean "the pane, at its only size" and now
means "the pane, deliberately shrunk," and a value written under the old
meaning is not evidence of the new one. Bumping both keys re-defaults every
install once, fresh and existing alike; a player who really does want the
small preview chooses it again in one press.

### 4. Visual consistency, read off the actual components rather than guessed

Dan's complaint named "random and broken" without specifying which pixels -
so before touching styling, the components that stack in the right rail
were read side by side: `StatsPanel.tsx`, `RiskBar.tsx`, `AiWorkerPanel.tsx`,
`BattleColumn.tsx`, `GameChatColumn.tsx`, `IconBar.tsx`. Two concrete,
verifiable mismatches, not invented ones:

- **Corner radius.** Every card-shaped box in the app uses Tailwind's
  `rounded` (0.25rem) - `GameChatColumn`'s outer frame, every box inside
  `BattleColumn`, every row in `AiWorkerPanel`, every button on `IconBar`.
  Two boxes in the same right rail did not: `StatsPanel`'s TDP chip used
  `rounded-lg` and `RiskBar`'s outer box used `rounded-xl`. Both now use
  `rounded`.
- **Background weight.** `RiskBar`'s box used `bg-surface-raised`, the tone
  reserved elsewhere for an outer panel frame (`GameChatColumn`,
  `BattleColumn`'s sub-boxes); its neighbours in the same rail column
  (`StatsPanel`'s stat chips, every row in `AiWorkerPanel`) use the lighter
  `bg-surface` for a chip that sits directly in an already-framed column.
  `RiskBar` now matches them.
- **A frame around the pane itself.** The scene-pane mount point in
  `App.tsx` had no outer border at all - `BattleColumn`'s internal boxes
  floated with a gap between them and the rail's own `border-l`, so the
  primary panel did not read as one coherent panel the way the left text
  column does (`GameChatColumn`'s own `rounded border border-border
  bg-surface-raised` wrapper). The mount point now carries a matching
  `rounded border border-border` frame, so the right side reads as a panel
  at the same visual weight as the left, without duplicating
  `BattleColumn`'s own internal chrome.

Left untouched on purpose: `ExperienceStrip` has no border or background,
per Dan's own instruction recorded in that file's doc comment ("we don't
need borders and padding... it's the whole column"). That is a deliberate
exception, not a missed inconsistency.

The chrome around the pane is deliberately generic - a border and a
background, nothing that assumes what is inside beyond "a scene/game view
lives here" - because Godot is expanding into this panel with its own UI,
not shrinking out of it (`docs/NO-3D.md`: "Godot stays and is expanding").

## Verification

- `npx tsc -b` - clean.
- `node tools/scene-pane-test.mjs` - 24 checks, 0 failed (up from 21; the new
  checks cover the fourth state, the two width constants and the per-state
  ceiling behaviour).
- `node tools/play-first-layout-test.mjs` - 61 checks, 0 failed, across five
  window sizes plus the state-cycling sequence. Game text holds 63.7%-74.8%
  of the window at every size (floor 55%), and the pane's right edge sits
  4px from the window's right edge at every size that has one - same corner
  Lane O put it in.
- `node tools/play-first-layout-break-check.mjs` - 5 sabotages, control
  green first, each named check goes red and nothing else does, each
  restored by hash. The rail-eats-the-window sabotage now targets
  `DOCKED_RAIL_W` (was `SCENE_RAIL_W`), same shape as before.
- Manual pass in a real browser at 1997x935 and 1200x850 against the demo
  character: the pane is drawn full width by default (`docked`, no press
  needed), the icon bar's scene button reports `aria-label="Scene pane: the
  main panel. Press for a small preview in the corner."`, and cycling the
  button visibly shrinks the pane, pops it into its own window with a note
  saying so, hides it, and returns to the primary panel - all four states
  confirmed by reading `data-scene-state` off the live DOM, not inferred
  from a screenshot.

## What this cannot tell you

Godot's own eventual chrome is not built yet - this repairs the panel's
*size and default state* and the app-side chrome around it, per
`docs/NO-3D.md`'s standing note that Godot is expanding, not exercising
what that chrome will look like once it lands. Chrome (the browser) is also
not the packaged app: `isTauri()` is false under the dev server, so
`popped`'s real window is exercised as a state change and a note, not as an
actual window, same limitation Lane O's own verification recorded.
