# Battlespace v3 — the tactical table

> **Rule 0 — never fork.** A problem is to be solved, never dodged. Fix the thing,
> replace it outright, or delete the feature — those are the only three moves.
> Never leave two answers to one question standing side by side, and never route
> a parallel path around something you did not want to touch. That is a noodle to
> nowhere, and it is the most serious thing you can do to this codebase.
> Full rule: [`CLAUDE.md`](../CLAUDE.md).

Status: **first implementation complete; live wide-state review passed**
Scope: the central Battle column, its room scene, action deck, room context,
inventory relationship, and responsive behavior. The world map and Experience
strip remain separate regions.

This pass begins with the collision in the current build: the room title is
painted across the full top edge of the scene while the friendly portrait rail
also owns that edge. At narrow widths the first portrait covers the title. That
is not a padding error. Two components believe they own the same pixels.

The redesign rule is therefore simple:

> Every durable fact owns one stable rectangle. Overlays may reveal detail,
> but they may not be the only place an essential fact exists.

---

## 1. Observed problems

The live audit used the mock invasion at Empaths' Guild, Guildleader's Office:
18 player characters, 18 monsters, 60 floor items in 49 kinds, a long real room
description, armor coverage, full skills, and a connected map.

### 1.1 Competing layers

- `RoomScene` gives its title/status strip `inset-x-0 top-0`.
- `CombatRadar` gives both roster columns `top-0 bottom-0`.
- `ArmorManager` also occupies the upper-right tactical quadrant.
- `FloorItems` may occupy up to 42% of the scene from the bottom.

The scene therefore has four independent systems drawing into the same image
without a shared inset contract. The attached narrow capture shows the result:
the first friendly portrait begins directly under the first letters of
"Empaths' Guild, Guildleader's Office."

### 1.2 The tactical image is used as storage

The room art should answer three questions at a glance:

1. Where am I?
2. Who is close to me?
3. What range and allegiance are they?

Instead, the bottom quarter can become a multi-line inventory browser, the top
holds a status bar and armor manager, and both vertical edges become portrait
lists. The room art survives only in the irregular gaps between controls.

### 1.3 Width is abundant but actions remain a single strip

The battle command belt is one horizontal row. It spends vertical space on a
panel boundary but still requires a long sideways scroll. A two-row rail uses
the same 32 px control grammar, exposes roughly twice as many actions, and adds
only one control row of height.

### 1.4 The lower table has the opposite problem

The room context cell reserves a large flexible center for prose even when the
room description is short. Its exits and floor items stay at the bottom, so the
middle can become an empty black field while the scene above is crowded with
loot controls. The full floor browser belongs in this lower table, where that
space already exists.

### 1.5 Duplicate information is not a fallback strategy

The same floor list currently appears over the scene and below the description.
The scene copy and the room-table copy need different jobs:

- the scene gets a one-row **loot glance** for immediate awareness;
- the room table gets the complete searchable **floor browser**.

They may use the same data and item-action component, but not the same density.

---

## 2. Information priority

| Priority | Information | Persistent location | May expand over content? |
|---|---|---|---|
| 1 | Room name, hands, urgent status | Battle header above the art | No |
| 1 | Player, hostile range, engagement | Tactical field | No |
| 1 | Friendly and enemy presence | Reserved left/right roster gutters | Detail only |
| 1 | Exits | Room context footer | No |
| 2 | Immediate ground awareness | One-row loot glance at scene bottom | No |
| 2 | Full ground contents and actions | Floor browser below exits | Its own region scrolls |
| 2 | Armor coverage/loadout | Inset armor rack, collapsed by default | Yes, into center field |
| 2 | Direct game commands | Two-row action deck | No |
| 2 | Carried inventory | Inventory half of lower table | Its own region scrolls |
| 3 | Full room prose and player summary | Room context reading area | Its own region scrolls |
| 3 | Hover dossiers and Elanthipedia | Anchored popover | Yes, temporary |

Anything in priority 1 must remain readable at the minimum supported battle
width. Nothing in priority 1 depends on hover.

---

## 3. Proposed spatial model

The Battle column becomes four vertically owned regions:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ BATTLE HEADER: room/title · hands · urgent state              32 px │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────┬──────────────────────────────────────────────┬──────┐       │
│ │FRIEND│                                              │ ENEMY│       │
│ │RAIL  │      TACTICAL FIELD / ROOM ART              │ RAIL │       │
│ │      │            armor rack ↗                     │      │       │
│ │      │       range rings + player center           │      │       │
│ │      │                                              │      │       │
│ └──────┴──── LOOT GLANCE: one horizontal row ────────┴──────┘       │
├──────────────────────────────────────────────────────────────────────┤
│ ACTION DECK: two grab-scroll rows of fixed 32 px controls      68 px │
├─────────────────────────────────────┬────────────────────────────────┤
│ ROOM CONTEXT                        │ INVENTORY                      │
│ short reading area                  │ bags and carried items         │
│ exits (always visible)              │ search and load                │
│ full floor browser fills remainder  │                                │
└─────────────────────────────────────┴────────────────────────────────┘
```

### 3.1 Battle header

The header is a sibling above `RoomScene`, not an overlay inside it.

- Left: full room name, truncated only after the middle section has yielded.
- Middle: right and left hand contents.
- Right: urgent status icons and roundtime.
- Height: 32 px at normal density, 40 px only when the battle width is below
  680 px and the row must wrap into two lines.
- The room name receives a normal tooltip with the complete value.
- Race, guild, and circle do not return to this row.

This change removes the title/portrait collision by construction. No roster
inset calculation is needed because the systems no longer share a box.

### 3.2 Tactical field

- Shape changes from 4:3 to 16:10. The room art is landscape and the saved
  vertical space is more valuable in the room/inventory table.
- Left and right roster gutters are reserved territories, not transparent
  layers over a title bar.
- The compass center remains 50% / 50%; it no longer needs to compensate for
  header chrome.
- The room art remains visible under the radar wash.
- Range rings remain restrained and anchored to the measured field.

### 3.3 Roster gutters

- Friends always occupy the left edge; enemies always occupy the right.
- Each gutter begins at the top of the tactical field and ends above the loot
  glance. It never crosses the battle header or item rail.
- Cards remain portrait-first and textless at rest.
- The edge tinge and tooltip carry allegiance and detail.
- Vertical grab scrolling remains available with no visible scrollbar.
- Width is derived from the field's measured size:

| Field width | Gutter | Portrait | Notes |
|---:|---:|---:|---|
| 900 px and above | 72 px | 56 px | Full portrait treatment |
| 680–899 px | 60 px | 48 px | Tighter gap and frame |
| Below 680 px | 50 px | 40 px | Armor forced collapsed |

### 3.4 Armor rack

- Collapsed state is the default tactical state: shield icon, `6/10` coverage,
  `4 pcs`, and an expand chevron.
- It is inset from the enemy gutter by `gutter + 8 px`.
- Expansion opens downward and leftward into the tactical center, never across
  the enemy gutter.
- It may temporarily cover room art because it is an explicit player action.
- It may not cover the player center card, loot glance, or battle header.

### 3.5 Loot glance

The scene footer becomes exactly one 34 px row.

- It shows grouped items horizontally, preserving item-specific icons.
- It grab-scrolls; it never wraps.
- It does not render the search field or the item action menu in the scene.
- A count at the leading edge says `60 items · 49 kinds`.
- Clicking an item selects the matching item in the full floor browser below
  and opens its actions there.

This keeps immediate loot visible while returning roughly 120–160 px of room
art in the invasion case.

### 3.6 Action deck

- Two rows, column-major horizontal flow, 32 px fixed-square buttons.
- One shared grab-scroll surface and no visible scrollbar.
- Semantic groups stay contiguous with a two-pixel leading rule.
- The command's unique icon is primary; color remains the shared semantic
  family used by map pins and the Functions library.
- Hover/focus gives label, explanation, and exact command.
- The deck contains no nested hotbar or category labels.

### 3.7 Room context and floor browser

The lower table changes from `1.35fr / 0.85fr` to `0.9fr / 1.1fr`; inventory
receives slightly more width because ten or more bags are normal.

Room context is divided vertically:

1. Room number and prose: at most 42% of the cell; grab-scroll when long.
2. Exits: fixed, immediately below prose, always visible.
3. Floor browser: fills all remaining space below exits.

The floor browser:

- wraps grouped items into as many rows as the cell can show;
- scrolls vertically by grab-and-drag when 49 kinds exceed the region;
- keeps search at the bottom, matching the established item-search placement;
- exposes Look, Get, Appraise, Analyze, and Elanthipedia for the selected item;
- keeps the selected action row inside its region instead of increasing the
  Battle column height.

### 3.8 Inventory

- Inventory remains permanently beside room context.
- It receives 55% of the lower-table width at normal battle sizes.
- Container rows and carried items retain Elanthipedia actions.
- Its own search and scrolling are independent of the floor browser.

---

## 4. Responsive contract

The measured battle field, not the global window, chooses the state.

### Wide: field at least 900 px

- 16:10 scene.
- 72 px roster gutters.
- Expanded armor is allowed.
- Lower table is 45% room / 55% inventory.
- Battle header stays one line.

### Standard: 680–899 px

- 16:10 scene.
- 60 px roster gutters.
- Armor begins collapsed but may expand.
- Lower table is 48% room / 52% inventory.
- Battle header gives hand names less width before truncating the room title.

### Compact: below 680 px

- 4:3 scene only if 16:10 would make portraits smaller than 40 px.
- 50 px roster gutters.
- Armor remains collapsed; clicking opens a centered temporary panel.
- Header may wrap to two lines: room title first, hands/status second.
- Lower table becomes a two-tab deck: `Room & floor` and `Inventory`. Exits stay
  in the Room tab and the tab reports item counts when inactive.
- No essential control falls below 32 px or text below 12 px.

---

## 5. Component ownership changes

| Current component | Change |
|---|---|
| `BattleColumn` | Own the four-region vertical composition and header |
| `RoomScene` | Own only art, tactical overlay, and one-row loot glance |
| `BattleStatus` | Become header content; never render inside the art |
| `CombatRadar` | Receive explicit top/bottom-free field and gutter dimensions |
| `RosterColumn` | End above loot glance; no knowledge of title/status |
| `ArmorManager` | Inset from enemy gutter; compact/expanded placement contract |
| `FloorItems` | Add `glance` and `browser` presentation modes over one action model |
| `ClassicRoomText` | Own prose and exits; host the browser region below exits |
| `BattleActionBar` | Use a two-row grid rather than one flex row |

No new game data, bridge intent, or invented room fact is required for this
layout pass.

---

## 6. Interaction contracts

- Grab-scroll gestures swallow the release click only after the drag threshold.
- Every portrait remains keyboard focusable and exposes the same dossier as
  hover.
- Every floor and carried item remains clickable and has an Elanthipedia path.
- Clicking an exit still sends the exact live compass direction.
- Clicking a battle command still reaches `useMacroRunner` with its exact
  variation command list.
- The loot glance and full floor browser share selection state; they do not
  maintain competing item-action menus.
- No persistent scrollbar is visible, but wheel and trackpad scrolling remain.

---

## 7. Acceptance gates

### Spatial

- At 620, 760, 900, and 1100 px battle widths, no title, roster, armor, player
  card, loot, command, exit, or item-action region overlaps another.
- The first friendly and enemy portraits begin below the battle header.
- The last portraits stop above the loot glance.
- The room art retains at least 70% unobstructed area in the invasion mock.
- The loot glance is one row at every supported width.

### Information

- Full room name is reachable by tooltip even when truncated.
- Right and left hand contents remain present.
- Exits remain visible with the longest demo room description.
- All 49 demo item kinds remain reachable in the floor browser.
- Every item exposes Look, Get, Appraise, Analyze, and Elanthipedia.
- Every roster entry uses its real or race/gender/class fallback portrait.

### Interaction

- Roster, loot glance, floor browser, action deck, map tools, and inventory all
  pass grab-scroll tests without accidental clicks.
- Portrait and item popovers stay inside the viewport.
- Armor expansion cannot cover either roster or the player center card.
- Buttons remain 32 px visual controls with accessible coarse-pointer targets.

### Redraw and build

- ResizeObserver updates settle in one frame without leaving blank canvas.
- Map and radar drag/zoom do not alter each other's transform state.
- `npm run test:battlespace`, focused floor/item tests, map viewport tests, and
  `npm run build` pass.
- Live browser checks use the full mock invasion, not an empty-room happy path.

---

## 8. Implementation order

1. Move the title/status header out of `RoomScene`; verify the original collision
   is impossible before changing any other geometry.
2. Add the explicit tactical-field gutter and loot-glance insets.
3. Convert `FloorItems` to shared data/actions with `glance` and `browser`
   presentations.
4. Make the room context allocate real remaining space to the floor browser.
5. Convert battle commands to a two-row rail.
6. Add measured wide/standard/compact states.
7. Verify each stage live before continuing; commit after the spatial contract
   and again after interaction/responsive verification.

---

## 9. Implementation and review ledger

Implemented in the first pass:

- The room/title, both hands, and live status now own a dedicated 36 px line
  above the art. The room name retains its complete tooltip when truncated.
- The tactical field is 16:10 and shares one border with that header.
- Friendly and enemy gutters start at the art's top and terminate at the
  fixed-height loot boundary; neither can enter the header or loot line.
- Gutter and portrait sizing now use measured compact, standard, and wide
  field bands, with a hard 40 px portrait floor.
- The armor manager is inset from the enemy gutter and begins near the top of
  the art now that it no longer has to avoid an overlaid title.
- The loot glance is a single non-wrapping grab-scroll row with total/kind
  counts. It has no search box and never opens actions over the art.
- The floor browser fills the room cell below fixed exits, wraps vertically,
  keeps search at the bottom, and retains every item action.
- The scene glance and full floor browser share one controlled selection. A
  live click on `some copper kronars (4)` in the scene was verified to open
  the corresponding detailed action row below.
- Battle commands now flow column-major through two grab-scroll rows while
  preserving semantic group rules, unique visuals, and exact macro wiring.
- The lower table now gives 45% to room/floor and 55% to inventory.

Live wide-state review used the full invasion fixture and confirmed that the
original title/portrait collision is gone, the room artwork remains visible,
both vertical rosters are intact, the loot glance stays one row, exits remain
visible under the long description, all 49 item kinds remain reachable, and
inventory uses the larger lower-table share.

The compact-state two-tab lower table described in section 4 remains a planned
second-stage refinement. The current compact state keeps both cells visible
and applies the 40 px portrait floor; it does not invent a tab switch before
that interaction has been separately mocked and tested.
