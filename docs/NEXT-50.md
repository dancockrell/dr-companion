# DR Companion: the next 50 steps

Status: production roadmap after the 2 September 2026 live workspace review.

This is ordered work, not a bag of ideas. Each step names a player-visible
outcome, why it is sequenced there, and the evidence required to call it done.
Later steps may begin in parallel only when they do not depend on an earlier
contract or touch the same files.

## Product promise and non-negotiable contracts

DR Companion is a glanceable tactical companion beside DragonRealms, not a
generic desktop dashboard and not a replacement text client. It earns space by
showing location, people, threats, body state, possessions, and automation more
clearly than the text stream can.

The following decisions are accepted:

- The central `BattleActionBar` is the one canonical home for direct game
  actions. `Functions & scripts` contains tasks and scripts, not a duplicate
  command launcher. Existing command hotbar pins remain supported.
- Compact controls must feel like game objects. Shape identifies a family,
  every action has a unique meaningful pictogram, color is a second channel,
  and the accessible name and exact command remain available on hover/focus.
- The map has one shared two-row tool rail in both docked and popped-out views.
  It supports click, keyboard, and grab/drag interaction.
- Live bridge data owns truth. The presentation may derive layout and grouping,
  but it may not invent enemies, topology, status, successful commands, or
  demographic facts.
- Player portraits resolve in this order: player-maintained custom art, then a
  race + gender + guild/class default, then a neutral image when required facts
  are genuinely unavailable. A letter tile is not an acceptable fallback.
- Floor and carried items remain clickable at high volume. Large collections
  compress through grouping, filtering, and scrolling rather than disappearing.
- Work lands as small validated commits and is pushed before another overlapping
  slice begins.

## Current verified baseline

- PR #262, map recovery and reachable-map art, is green on every current check.
- PR #263, the shared modal scrim, is green but must be refreshed after #262.
- Commit `ae1a2274` removes the duplicate command catalog from the scripts pane,
  keeps command hotbar compatibility, and gives battle/map controls a shared
  forged game-control treatment. Build, battlespace, action-icon, contrast,
  and map-viewport checks pass locally.
- The live Crossing map now owns its full column; the earlier empty black
  reservation and natural-aspect width cap are gone on the #262 branch.
- The bridge truthfully reports nine missing activity intents. Eight are
  specified; `burgle` still requires a product decision.
- Open tracking issues are #175 (map), #176 (color/token drift), and #179
  (design-system adoption). The issue queue is small enough that new work must
  update or close these rather than create duplicate trackers.

## Phase A — establish one releasable baseline

### 1. Merge green map recovery PR #262 at its exact tested head

**Why now:** Every later visual and interaction branch includes or assumes its
full-viewport map fix. Leaving it open makes every comparison ambiguous.

**Done when:** the tested head is the merge source, `main` contains the map
viewport, topology, stamp, and pin-art tests, and the deployed demo shows no
empty reserved map area.

### 2. Refresh PR #263 onto the new `main`, then merge the shared scrim

**Why now:** It is already green, small, and independent, but merging stale
bases recreates the branch pileups this roadmap is meant to stop.

**Done when:** all modal backdrops use the token, keyboard dismissal and focus
return still work, and CI is green on the refreshed exact head.

### 3. Refresh `fix/canonical-action-deck` onto that baseline

**Why now:** The action branch starts from #262 and should contain only its own
deduplication and control-language delta before review.

**Done when:** the branch diff contains no already-merged map work, has no
conflicts, and `git diff --check`, build, frontend, battlespace, and map viewport
checks pass.

### 4. Perform a real visual review of the new game controls

**Why now:** Unit checks prove icon uniqueness and wiring, not whether a forged
control actually feels playful or becomes muddy at 125–200% Windows scaling.

**Done when:** screenshots at compact, standard, wide, ultrawide, 100%, 150%,
and reduced-motion settings confirm readable silhouettes, visible focus,
clear pressed/disabled states, and two intact rows.

### 5. Open, review, and merge the canonical action-deck PR

**Why now:** This removes the most visible duplicated system before deeper
button and scheduler work, giving those features one command owner.

**Done when:** the center deck is the only built-in command catalog, scripts
remain searchable and pinnable, stored command hotbar pins still execute, and
all remote checks pass on the merged head.

## Phase B — repair the product contract and its guardrails

### 6. Reconcile `DESIGN-BIBLE.md` with the product that is actually approved

**Why now:** The document still mandates a map drawer, a 220-room local map,
and “no columns,” contradicting the persistent full-zone proportional workspace.
That stale contract can drive correct code backwards.

**Done when:** the bible records the accepted map-column model, proportional
shared boundaries, compact folding behavior, and why the earlier drawer/local
map direction was rejected.

### 7. Create an explicit information-ownership table for every visible region

**Why now:** Lost directions, duplicated command bars, and title/portrait
collisions all came from two components believing they owned the same pixels.

**Done when:** Map, Battle, Game, Scripts, Room/Floor, Inventory, Skills, Console,
Hotbar, and Safety/Audio each have one owner, essential facts, overflow rule,
and responsive fallback.

### 8. Establish a golden visual-state matrix

**Why now:** “Looks right on my screen” repeatedly failed during resize and
mock-state changes. A stable matrix makes visual regressions reproducible.

**Done when:** automated captures cover combat/safe, short/crowded rooms,
empty/60-item floors, 0/18 actors, map loading/error/ready, compact/standard/
wide/ultrawide, and dark/reduced-motion settings.

### 9. Add mounted interaction tests for the primary player loop

**Why now:** Source-regex checks are useful contracts but cannot prove a button
is unobscured, focusable, clickable, or connected to the live store.

**Done when:** mounted tests execute map travel, action dispatch, script start/
stop, item selection, inventory expansion, armor actions, hotbar add/remove,
and recovery from failed commands.

### 10. Define one command metadata registry

**Why now:** Icons, colors, capability gates, help text, hotbar behavior, and
exact commands currently meet through several lookups. A registry prevents
another visually or behaviorally different copy.

**Done when:** each action key has label, family, unique icon, tone, command(s),
capability requirement, safety class, help text, and optional shortcut in one
validated schema consumed by deck, palette, hotbar, and command search.

### 11. Promote the forged tile into an accessible shared component

**Why now:** The new CSS language proves the direction, but raw buttons can
still omit the inner frame, busy state, tooltip trigger, or focus contract.

**Done when:** `GameIconButton` owns silhouette, focus, pressed, busy, disabled,
reduced-motion, and tooltip behavior while allowing a unique icon and semantic
tone; battle actions and map tools use it without changing commands.

### 12. Add CI guards against duplicate command surfaces and bespoke game tiles

**Why now:** Cleanup without prevention regrows. Issue #179 identified that as
the root design-system failure.

**Done when:** CI fails if a second built-in macro catalog is rendered, a game
tile bypasses the shared primitive without an allowlisted reason, an action
lacks unique metadata, or a new control has no focus-visible state.

## Phase C — make the map trustworthy, fluid, and explanatory

### 13. Build a resize/redraw stress harness for the map

**Why now:** The blank half-map and stale drag frames are timing/geometry bugs,
not static SVG mistakes. They require repeated resize and pan sequences.

**Done when:** a test loops compact↔ultrawide resizing, zooming, dragging, zone
changes, and map reloads without blank frames, stale transforms, or sheet-sized
dead space.

### 14. Give map rendering one measured viewport and one animation-frame writer

**Why now:** Multiple effects writing scale/translation are a common source of
wonky zoom and incomplete redraws.

**Done when:** `ResizeObserver` updates dimensions, a single reducer owns zoom
and translation, rendering batches through `requestAnimationFrame`, and stale
callbacks cannot overwrite newer geometry.

### 15. Make cursor-anchored zoom mathematically stable

**Why now:** Zoom should preserve the room under the pointer instead of jumping
the chart, especially on a 1,041-room zone.

**Done when:** wheel/buttons keep the focal room stable, clamp at deliberate
min/max scales, `fit` is atomic, and 10 repeated in/out cycles return to the
same transform within a tested tolerance.

### 16. Finish grab, touch, and boundary behavior

**Why now:** Dragging is a primary map interaction and must not select text,
lose capture outside the sheet, or expose blank space.

**Done when:** mouse, pen, and touch use pointer capture; movement clamps at all
zooms; fitted maps center; interrupted drags cancel cleanly; and reduced motion
does not alter geometry.

### 17. Complete the topology audit without inventing connections

**Why now:** 288/310 gateway arrivals are recovered, while zone `33a` and a
small set of islands remain genuinely unresolved. Guessing makes navigation
dangerous.

**Done when:** every gateway has verified source/destination evidence or an
explicit unresolved record with raw exit text, and no inferred edge enters the
runtime map without provenance.

### 18. Audit landmark/pin placement room by room

**Why now:** Correct symbols at wrong rooms are worse than missing symbols.
Multi-pin sites such as temple grounds need an explanation, not silent overlap.

**Done when:** every authored landmark records room id, zone, semantic kind,
source text, and rationale; unintended duplicates are removed; intentional
multi-function rooms show a grouped marker or distinct named entries.

### 19. Expand pin semantics beyond generic offices and repeated anchors

**Why now:** A bank, registry, guild office, courthouse, and post office should
not require opening five identical symbols to tell them apart.

**Done when:** high-frequency place functions have distinct, fantasy-readable
glyphs; repeated icons are justified by shared meaning; fantasy gaps use
reviewed code-native SVG assets with provenance rather than random web art.

### 20. Give every map symbol an explanatory tooltip card

**Why now:** A symbol without meaning increases memory burden instead of
reducing it.

**Done when:** hover/focus shows place name, exact function, zone and room,
source/provenance, click/drag behavior, and an Elanthipedia link or honest
search link; tooltip content remains keyboard and touch reachable.

### 21. Add searchable categories to the two-row pin library

**Why now:** Seventy-plus meaningful controls still become a memorization test
without a fast route to “bath,” “forge,” or “danger.”

**Done when:** customize remains far left; category boundaries remain visible;
search/filter does not add permanent height; grab scrolling persists; clearing
search restores the stable authored order.

### 22. Prove docked and popped-out map parity

**Why now:** The red-team report explicitly did not exercise the Tauri window,
and separate window lifecycles can drift despite shared components.

**Done when:** a desktop integration test covers open/close/reopen, same zone,
zoom, selected level, pins, tooltips, keyboard navigation, and live movement in
both views without duplicate bridge ownership.

## Phase D — make the battle space truthful and readable under pressure

### 23. Lock a collision-free spatial contract for every battle layer

**Why now:** Portraits, armor, title, floor loot, and the player center have all
covered each other in prior builds.

**Done when:** measured insets reserve friend/enemy gutters, header, loot glance,
armor expansion, and center dashboard at compact/standard/wide widths; automated
tests fail on overlap.

### 24. Finish the two independent actor rails

**Why now:** The enemy rail has repeatedly disappeared while friendlies stayed
visible. Allegiance must survive ordering and crowding changes.

**Done when:** friends and enemies each have grab/drag and keyboard scrolling,
edge tinges identify allegiance, neither rail is replaced by stacking policy,
and 18+18 actors remain reachable without covering loot or header.

### 25. Make actor identity reconciliation stable

**Why now:** Invented or mismatched enemies produce missing art, wrong dossiers,
and cards that reorder on every update.

**Done when:** bridge presence, combat assessment, death, and player lists join
through stable normalized identities; unmatched facts remain “unassessed” or
unknown; tests cover same-name collisions, departure, death, and late packets.

### 26. Complete portrait resolution by explicit character facts

**Why now:** Distinct files are meaningless if every unknown actor resolves to
the same female-human image.

**Done when:** race + gender + guild/class selects a deliberate default family,
names only choose stable variation within that family, custom art wins, unknown
facts use a neutral image, and tests cover every supported combination.

### 27. Turn portrait hover into a complete, provenance-aware dossier

**Why now:** The portrait is the fastest route to “who is that and what do we
know,” but live status and old assessment must never be blended.

**Done when:** the card separates identity, live relation/range/target, injuries
or death, assessed level/health/abilities and age, Look/Assess actions, and
Elanthipedia/bestiary links; stale facts are visibly dated.

### 28. Design safe community portrait authentication and sync

**Why now:** Clients cannot be handed a maintainer GitHub token. Player-managed
art needs authentication, moderation, caching, and rollback before upload UI.

**Done when:** the chosen flow uses user-owned GitHub OAuth/device auth or a PR
submission service; scopes are minimal; submissions land as reviewable manifest
changes; clients fetch signed/versioned manifests at launch and retain the last
known good cache when offline.

### 29. Finish the armor rack as real equipment management

**Why now:** Coverage visuals are useful only if inventory slots and commands
reflect DragonRealms equipment behavior.

**Done when:** pieces derive from carried/worn data, each coverage fact has
provenance, slot conflicts are explained, wear/swap/remove all wait for bridge
confirmation, and shield wear/adjust/remove actions expose failure recovery.

### 30. Repair the paperdoll/body-state contract

**Why now:** “Tended character” is not a game fact; wounds, scars, bleeding,
and tending apply to body parts.

**Done when:** every body part represents live wound/scar/bleed state, clicking
a part explains and offers valid treatment actions, unknown data is distinct
from healthy, and the visual remains readable beside the portrait.

### 31. Inventory every combat-critical status indicator

**Why now:** Missing or decorative status icons can cause real bad commands.
The app must know which indicators are wired and which are merely mock data.

**Done when:** health, spirit, stamina, concentration, balance, position,
roundtime, hidden/invisible, engagement, hands, burden/bag pressure, bleeding,
dead/stunned/webbed/etc. each name source, freshness, unknown state, visual,
tooltip, and live test.

### 32. Finish the action deck as a playful instrument panel

**Why now:** The shared forged frame is only the base language. Every action
still needs immediate, flavorful recognition without becoming decorative noise.

**Done when:** all 47 actions have unique reviewed pictograms, meaningful family
silhouettes and colors, responsive two-row layout, label/note/exact-command
tooltips, busy/failure feedback, direct wiring, and no dead enabled button.

## Phase E — make rooms, floor piles, and inventory scale

### 33. Define a lossless floor-item schema

**Why now:** Grouping 50 invasion drops is necessary, but normalization must not
erase adjectives, quantities, ownership, container/table location, or action
targets.

**Done when:** raw phrase, normalized noun, count, room/container relation,
action target, source timestamp, wiki key, and stable selection identity are
separate fields with round-trip fixtures.

### 34. Make the floor browser efficient at 1, 50, and 500 items

**Why now:** A real invasion can exceed the current demo; wrapping every chip
eventually consumes the whole room panel.

**Done when:** grouped rows virtualize or window large lists, grab/keyboard
scrolling remains local, search stays at the bottom, counts remain accurate,
and no selection changes the battle column’s height.

### 35. Give every floor item truthful actions

**Why now:** Clickable-looking loot that silently does nothing is worse than
plain text.

**Done when:** Look, Get, Appraise, Analyze, and appropriate container/table
actions go through the guarded command boundary, show pending/confirmed/failed
states, and refresh the pile only from subsequent game truth.

### 36. Make Elanthipedia resolution correct and recoverable

**Why now:** Exact items, ordinary nouns, and ambiguous phrases need different
link behavior; an incorrect exact page misleads the player.

**Done when:** known canonical pages win, then normalized search, then raw search;
results are cached with age/provenance, late replies cannot replace a newer
selection, and offline mode retains the last known useful answer.

### 37. Scale inventory around containers and work, not a flat object list

**Why now:** Players carry many bags for different activities. Capacity and
location matter more than a long alphabetical list.

**Done when:** bags show used/capacity pressure, nested items remain reachable,
search reveals parent paths, filters include combat/armor/magic/crafting/loot,
and item/wiki/action behavior matches the floor browser.

### 38. Restore the complete room-context stack

**Why now:** Directions and floor items have repeatedly vanished beneath long
descriptions or scene changes.

**Done when:** room name/id and prose scroll in a bounded reading area, exits are
always immediately below it, the full clickable floor browser follows exits,
and every room change resets only the regions that should reset.

### 39. Build a priority-aware deadtime scheduler

**Why now:** Opportunistic commands can help, but they must never steal a combat
round, flood DragonRealms, or continue after Stop All.

**Done when:** one queue models priority, roundtime, cooldown, server backpressure,
combat suppression, cancellation, retries, and per-command cost; foreground
player commands always preempt background probes.

### 40. Add opt-in opportunistic room observation

**Why now:** Weather, teaching, tables, object looks, and room changes can enrich
the companion during genuine idle time without extra user work.

**Done when:** probes are read-only, rate-limited, visible in a queue/history,
cancelled on activity, never repeat unchanged facts unnecessarily, and store
timestamped diffs with source commands instead of pretending inference is live
truth.

## Phase F — make every enabled bridge action real

### 41. Generate and enforce a UI-to-bridge capability matrix

**Why now:** Nine declared actions lack real handlers. The UI must never advertise
mock-only success.

**Done when:** every visible action maps to a shipped handler or renders disabled
with a precise reason; mock, TypeScript contract, Ruby dispatch, docs, and tests
are generated or checked from one list.

### 42. Implement and live-test `buffs`

**Why now:** It is read-mostly and a comparatively safe first activity intent,
making it the right template for confirmed progress/failure reporting.

**Done when:** the bridge invokes the approved buff routine, streams state,
honors Stop All, reports unsupported setup, and passes a live Prime test.

### 43. Implement and live-test `loot`

**Why now:** Floor UI now exposes loot prominently; the activity button must
share its guarded item semantics rather than remain mock-only.

**Done when:** policy/options are explicit, no protected item is taken by
default, state is confirmed from game output, cancellation works, and invasion
fixtures plus a live low-risk room pass.

### 44. Implement and live-test `travel`

**Why now:** It establishes the common movement lifecycle used by town and
healer workflows.

**Done when:** destination validation, route start, progress, interruption,
arrival confirmation, unreachable recovery, and map synchronization are proven
against live Lich.

### 45. Implement and live-test `town_run`

**Why now:** It composes travel with multiple tasks and therefore belongs after
the single travel lifecycle is trusted.

**Done when:** the itinerary is inspectable, steps checkpoint, resume is safe,
inventory/currency failures stop honestly, and Stop All cancels every child.

### 46. Implement and live-test `go_healer` and `escape_heal`

**Why now:** These are safety-critical compositions. They come only after travel
and health truth are dependable.

**Done when:** preferred-healer scoring is documented, thresholds are tunable,
combat escape and travel report separate states, no “healed” result appears
before live health confirms it, and failure leaves a clear recovery action.

### 47. Implement and live-test `start_training` and `start_combat`

**Why now:** Both start long-running automation and require the scheduler,
capability matrix, cancellation, and state reporting established above.

**Done when:** parameters are validated, scripts/tasks have one owner, Pause/
Resume/Stop All work, re-entry is idempotent, and live tests prove the UI never
reports running after the backend stops.

### 48. Decide the `burgle` product contract or remove its control

**Why now:** It is the sole acknowledged unspecced intent. Keeping an enabled or
promised button without a safe definition violates the product’s truth rule.

**Done when:** either an approved safety/target/stop/recovery contract is written
and implemented, or the intent and UI are removed until such a contract exists.

## Phase G — prove it as a product, not a mock

### 49. Run whole-app accessibility, performance, and long-session gates

**Why now:** The pieces can all pass individually while the companion fails as
an eight-hour, keyboard-heavy sidecar.

**Done when:** keyboard/focus/screen-reader traversal is complete; color and
12px type gates pass; 1,041-room maps, 36 actors, 500 floor items, and full
skills remain responsive; repeated resize/connect/disconnect cycles leak no
listeners, sockets, timers, or stale state.

### 50. Complete a packaged live vertical slice and release candidate

**Why last:** Only the packaged Tauri app with real Lich can prove authentication,
bridge installation/versioning, window lifecycle, art caching, commands, map,
combat, items, scheduler, and recovery together.

**Done when:** a fresh install connects to Prime, loads a real character and
portrait, travels across a verified gateway, renders a crowded battle, executes
and stops an action, manages armor, inspects and gets an item, survives network/
bridge interruption with last-known-good state, restarts with preferences intact,
and ships from a tagged green commit with rollback instructions.

## Approval ledger

### Accepted

- Center action deck is canonical; command duplication in scripts is removed.
- Game controls use tactile fantasy framing, unique functional icons, semantic
  shape/color, strong tooltips, and preserved accessibility.
- Full-zone map remains a first-class workspace region and owns its full width.
- Unknown facts stay unknown; the app does not invent enemies, connections,
  status, art identity, or success.
- Community portrait delivery is versioned and reviewable; custom art overrides
  demographic defaults.

### Rejected

- Empty “reserved” layout furniture.
- Direct maintainer credentials inside player clients.
- Letter portrait fallbacks.
- Separate implementations of the same toolbar or command catalog.
- Generic identical desktop buttons distinguished only by tooltip.
- Guessed map connections or silently duplicated landmark pins.

### Provisional until live proof

- The exact GitHub/OAuth submission architecture for community portraits.
- Which of the remaining closed-looking zones are intentionally isolated.
- The final compact battle fallback below 680 px.
- The `burgle` behavior contract.
