# Panel architecture: what's actually wrong, and a contract to fix it

Written from reading the code and running the test suite against
`2c0b2e8`, not from the design intent — everything below is checked against
what ships, and cites the file and line it came from so it can be re-checked
rather than trusted.

This exists because "the panels feel poorly constructed and some look
redundant" is a real, correct read of the current app, and it has two
separate causes that want two separate fixes. Conflating them is why neither
has been fixed yet — both #32 and #33 were closed "not fixing tonight"
with the actual decision left for whoever picked it up next. This is that.

---

## 1. There are two panel systems, and they disagree about which is real

`src/components/dashboard/panels.tsx` is a registry — `PanelId`,
`PANEL_TITLES`, `PANEL_CONTENT` — with a header comment stating its whole
reason to exist:

> Shared on purpose. A panel that rendered differently depending on which
> window it was in would be two components pretending to be one, and they
> would drift.

`src/components/dashboard/DashboardLayout.tsx` is what a player actually
sees by default, and it does not read that registry at all. It imports
`TrainingPanel`, `InventoryPanel`, `RiskBar`, `ScriptLibraryPanel`,
`TaskFlowPanel`, `QuickQueuePanel` directly and hand-places each one in a
fixed JSX grid (`DashboardLayout.tsx:5-20`). Its own doc comment says why —
a registry-driven layout produced arbitrary ordering in an earlier version —
and names the consequence itself:

> That leaves two sources of truth for "what panels exist" — this grid, and
> `layout.order` / `PANEL_CONTENT` in `panels.tsx`, which still feeds
> `FreeCanvas` and pop-out windows. **This file is authoritative for what a
> player sees by default.**
> — `DashboardLayout.tsx:81-84`

So the registry's founding promise — one definition, used everywhere — is
already false for six of eleven `PanelId`s (`training`, `inventory`, `risk`,
`launcher`→`TaskFlowPanel`, `scripts`, plus `QuickQueuePanel` which isn't
even in the registry). A pop-out window and the default dashboard can now
render genuinely different content for the same nominal panel, which is
exactly the drift the registry comment warned about.

**This is issue #33's root cause**, restated precisely: Basic/Power don't
differ in arrangement because `order` is the registry's concept and the
thing that actually renders never asks the registry anything.

## 2. ~250 lines of freeform-layout machinery are unreachable — issue #32, still open

`FreeCanvas.tsx`, `DockView.tsx`, `freeLayout.ts`, `dock.ts`, and the
`rects`/`dock`/`freeform` fields in `layout.ts` implement drag-to-place,
drag-to-resize, panel pop-outs into a dock. Verified again just now, same
finding as #32: the only caller of `place()`/`setPanelRect` (the function
that turns `freeform` on) is inside `FreeCanvas` itself, and `FreeCanvas`
only renders once `freeform` is already true. No button, menu item, or
settings-sheet control sets it. A player cannot reach this code through the
shipped UI, full stop — confirmed by grepping `AppControls.tsx` and
`SettingsSheet.tsx` for any call to `setPlane`/`place`; there is none.

`#32` gave this two honest resolutions and left it unclaimed. It is still
unclaimed. I am not resolving it here — see §5 for why — but it is load-
bearing context for §3: **the redundancy a player perceives when they open
this app is coming from real, working, competing surfaces, not from dead
code.** The freeform system is invisible to a player; it cannot be what
"looks redundant" refers to. What follows is.

## 3. The genuine redundancy: three script-launch surfaces, two of them reading the same files two different ways

This is the one worth being precise about, because the first thing that
looks true here is wrong, and I want to save the next reader the same wrong
turn.

**`TaskFlowPanel`'s "Tasks" tab** (`pythonStatus()`, `lib/pythonTasks.ts`) is
genuinely distinct — the app's own curated, ready-made Python automations.
Not redundant with anything else in this app.

**`TaskFlowPanel`'s "Scripts" tab** calls `listScripts()` →
`invokeTauri('list_scripts')` → `scripts.rs:187`, whose own comment states
what it enumerates:

> Lich's folder holds scripts this app did not write — dr-scripts, whatever
> the player installed — and they are all listed.
> — `scripts.rs:181-183`

It reads Lich's real scripts directory off disk, directly, every `.rb` and
`.py` file, with no curation. The tab has a `Play` button
(`TaskFlowPanel.tsx:480` calls `startScript(s.name)`) alongside edit/save/
delete via `ScriptEditor`.

**The separate `ScriptLibraryPanel` box**, rendered lower in the same
scrollable rail (`DashboardLayout.tsx:316-326`), reads the bridge's own
`script_catalog` payload — Lich reporting the same folder over the game
connection instead of the filesystem — and runs it through
`data/scriptCatalog.ts`'s curation (descriptions, twelve categories, a
`promoted`/`standard`/`hidden` tier so the raw count doesn't become 234
identical buttons). It also has a Start action.

**So it is real, not a false impression**: two different code paths (direct
filesystem vs. through-the-bridge) enumerating the same underlying set of
installed scripts, presented as two separate boxes in the same view, both
launchable. The difference that actually matters — one is *editable, raw,
uncurated*; the other is *curated, described, categorized, read-only* — is
not stated anywhere in either panel's UI. A player sees two lists of
scripts, one small-looking ("Scripts 234" as a tab count next to "Tasks
10") and one further down ("Script Library"), with no label telling them
why there are two or which to reach for.

That is the concrete "looks redundant" — verified against the actual data
paths, not the labels. It is a presentation problem sitting on top of two
capabilities that are each individually worth keeping: a player managing
their own script files needs edit/save/delete; a player discovering what
`dr-scripts` offers needs curation. Merging the data would lose one of
those. **Naming the difference would not**, and costs nothing structural.

### What I'm proposing here vs. what I actually changed

Given the pace on this repo overall — eight commits in the seven hours
before this was written, one of them (`fd34931`) touching
`DashboardLayout.tsx` directly — a structural merge of two live, tested
components is the wrong thing to push into a fast-moving tree without
review. What ships alongside this document is the safe half: **rename and
label**, not merge — see the PR this document ships with. The fuller
version, for whoever picks it up next:

> One "Scripts" module, two tabs — **Library** (curated, Start-only, what
> `ScriptLibraryPanel` is today) and **My Files** (raw, editable, what
> `TaskFlowPanel`'s Scripts tab is today) — sharing one `startScript` call
> and one search box, so a player learns the vocabulary once. `Tasks` stays
> a third, clearly separate tab on the same panel, since it answers a
> different question ("what will this app do for me") from the other two
> ("what exists that I could run").

---

## 4. The module contract this app doesn't have yet

Every panel added by hand to `DashboardLayout.tsx` has, in practice, made
three decisions with no shared place to make them:

1. **Does it exist in Basic, Power, or both?** — currently a bare `{dense &&
   ...}` wrapper repeated per-panel, each with its own prose comment
   justifying the choice (`DashboardLayout.tsx:230-326`). The comments are
   good. The mechanism to check them against each other is not — nothing
   stops two panels from both claiming to be "Power's brief" for
   contradictory reasons.
2. **What does it show when it has nothing to show?** — inconsistent today.
   `Objects` explicitly renders `"Floor is clear."` (`DashboardLayout.tsx:
   288`); several `dense`-gated panels render nothing at all when collapsed,
   which is correct per §2.115's "dead space is a bug," but there's no
   shared rule saying so — each panel decided independently.
3. **Is it the only surface that answers its question, or does it overlap
   an existing one?** — the check that was skipped for §3's redundancy, and
   the one this document exists to make routine.

DESIGN.md §2.115 already has the right test, stated for *whether a panel
belongs on the page at all*:

> The practical test for any panel: *would I give up game window for this?*

This proposes the same-shape test for *whether a panel is a new module or a
tab on an existing one*, since that is the decision §3 shows the app
currently has no process for:

> **Before adding a panel: what question does it answer, and does an
> existing panel already answer a question close enough that a player would
> reach for it first?** If yes, it is very likely a tab or a mode on that
> panel, not a new box. `Tasks`/`My Files`/`Library` in §3 is the worked
> example — three real, distinct capabilities, correctly One thing each,
> that should read as one module with three doors rather than two modules
> that happen to share a hallway.

A concrete, cheap version of this that doesn't require ripping out
`DashboardLayout`'s deliberate fixed-grid design (§1 already found that
"registry vs. fixed grid" is a decided, defended choice, not an oversight —
see `DashboardLayout.tsx:22-28`): a plain manifest, colocated with the grid
rather than replacing it, that each hand-placed panel is required to update:

```ts
// src/components/dashboard/panelManifest.ts
export interface PanelManifestEntry {
  id: string
  /** One sentence: what question does a player open this to answer? */
  answers: string
  mode: 'basic' | 'power' | 'both'
  /** id of another entry this could be mistaken for, and why it isn't. */
  distinctFrom?: { id: string; because: string }
}
```

Nothing reads this at runtime — it's not a rendering mechanism, and it does
not touch #32/#33's registry-vs-grid question at all. Its only job is to
make §3's mistake mechanical to catch: a lint or a five-line test
(`tools/panel-manifest-test.mjs`, same shape as `intent-drift-test.mjs`)
that fails when two entries have overlapping `answers` text and neither
names the other in `distinctFrom`. Cheap, additive, and it would have
flagged §3 the day the second script surface was added rather than after a
player noticed.

---

## 5. What this document is and isn't deciding

**Decided and shipped in the accompanying PR:** the labeling fix in §3 —
`TaskFlowPanel`'s Scripts tab and `ScriptLibraryPanel` now say, in the UI
itself, what each is and points at the other. Verified against
`npm test` and `npm run build` before opening the PR.

**Named but deliberately not executed:** the #32 freeform-deletion call and
the #33 registry-unification call. Both are real architectural decisions
with a fast-moving tree under them right now; both already have documented
resolution paths from whoever closed them. This document does not add a
third "not tonight" — it adds the missing piece those two issues were
waiting on, which is a working diagnosis of what a player actually
perceives as wrong, so whoever picks up #32/#33 next is deciding with full
information instead of re-deriving it.

**My own recommendation, for what it's worth, since I was asked to think
about this rather than only report it:** delete the freeform machinery
(#32's option 2). It has been unreachable and unclaimed since before this
document, every real panel added since has gone into the fixed grid by
hand (§1), and the team's actual effort is visibly going there, not into
reviving drag-placement. Keeping ~250 lines of untested, unreachable code
around costs real maintenance attention — the `layout.ts` doc comment was
already wrong once, per #33, from nobody noticing the freeform path had
drifted from what it claimed. Deleting it is reversible from git history if
someone wants freeform back later with an actual entry point designed in
from the start, which is a better foundation than resurrecting what's here.
