# Client information ownership

This table answers a deliberately narrow question: **which region owns each
piece of persistent player-facing information?** It prevents the layout failures
that happen when two components both add a title, an action bar, or a scroll
container for the same fact.

| Region | Owns | Must remain visible | Overflow / narrow fallback | Must not own |
| --- | --- | --- | --- | --- |
| Map | verified zone topology, current room, gateways, landmarks, pins, map navigation | location, fit/zoom, keyboard movement, active pin brush | one grab-scrollable two-row tool rail; map keeps its measured viewport; pop-out mirrors it | room prose, a second command catalog, guessed connections |
| Battle | live target, actors, tactical art, vitals, armor, direct actions, floor glance | title, relation/status, main action deck, floor-item count | actor rails grab-scroll independently; action deck stays two rows and horizontal-scrolls | scripts library, carried inventory, invented actor facts |
| Game | game stream, connection state, stream filters, direct input | connection truth, latest game feedback, input | stream scrolls locally; channel filters compact before the stream does | map controls or battle actions |
| Functions & scripts | discovered scripts, tasks, search, pinning to the command hotbar | search and task status | local scroll; task groups can collapse | built-in battle command catalog |
| Room and floor | room title/id, prose, exits, complete floor browser | room identity, exits, selected floor-item actions | prose scrolls in its own reading area; floor list groups, searches, and scrolls after exits | radar art, carried-item state |
| Inventory | carried containers, capacity, filters, search, item detail/actions | search, active filters, capacity pressure | container tree scrolls locally; matching children reveal their parent path | floor pile selections or room exits |
| Skills | current experience/mindstate data and skill filtering | skill name, learning state, numeric progress | independently scrollable long list | combat action controls or character identity card |
| Hotbar | player-pinned commands, slots, shortcuts, execution feedback | pinned slots and their exact command | empty state explains how to pin; overflow persists by slot | unpinned built-in action catalog |
| Console / safety / audio | execution lifecycle, Stop All, pause/resume, music/audio state | Stop All and current run truth | global footer stays one line; secondary details disclose upward | region-specific command duplication |

## Shared rules

1. **One owner, one scroll surface.** A child may scroll only for a bounded
   local collection; it may not add a page-height scroll region to compensate
   for an unbounded list.
2. **Live bridge truth wins.** Presentation may group, summarize, and retain
   the last known good result, but may not report success, a location, an
   actor, a wound, or an item mutation before the bridge confirms it.
3. **Actions have one canonical home.** The Battle action deck owns built-in
   direct actions. Scripts own scripts. The player-owned hotbar may reference
   either, without copying their implementation.
4. **Narrow means fold or scroll locally, never vanish.** Important facts keep
   an affordance, an accessible name, and a path back to the full detail.
5. **Popped-out windows mirror contracts, not markup.** Map and auxiliary
   windows reuse the same state and tool assemblies, with their own error
   boundary and no duplicate bridge listener.
