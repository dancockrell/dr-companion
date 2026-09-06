# Crossing: single city-wide production batch

Current completion authority: the entire zone, not Town Green or another neighborhood. Small commits are checkpoints inside this one batch. This report is generated; update the sources and recipes, not the report.

Run: node tools/build-crossing-city-batch.mjs. Add --check-complete for the release acceptance gate (expected to fail while unfinished).

## Current inventory

- rooms: 1060
- directedExits: 2389
- descriptions: 976
- missingDescriptions: 84
- partialRecipes: 20
- complete: 0
- compassMismatches: 493
- sourceCompassMismatches: 2

## Coordinated asset families

- street-and-junction: 138 rooms
- garden-and-boundary: 141 rooms
- riverine-and-maritime: 95 rooms
- rock-cave-and-underground: 47 rooms
- interior-shell-and-fittings: 177 rooms
- building-frontage: 148 rooms
- vertical-connection: 55 rooms
- workshop-and-commercial-display: 159 rooms

Families are evidence-backed work queues, not permission to fill every matching room with a generic model. The JSON retains the full bound description, excerpt, commands, geometry diagnostics and current recipe for every room. Shared-place descriptions and heuristic classifications need review.

## Required architecture

Street continuations, intersections, waterfronts and building approaches must be composed as connected arrangements. Footprints need not all be square. A legal graph edge remains authoritative even when literal geometric adjacency is impossible; communicate the exception with a typed tether. Interior visibility layers are not evidence of physical upstairs/downstairs. Only supported elevation relationships may be represented as such.

## Missing descriptions

- 1-1 — The Crossing, Magen Road
- 1-2 — The Crossing, Magen Road
- 1-3 — The Crossing, Magen Road
- 1-24 — The Crossing, Puddle Path
- 1-40 — The Crossing, Lunat Shade Road
- 1-41 — The Crossing, Lunat Shade Road
- 1-49 — The Strand, Sandy Path
- 1-50 — The Strand, Sandy Path
- 1-51 — The Strand, Crystalline Beach
- 1-54 — The Strand, Crystalline Beach
- 1-55 — The Strand, Crystalline Beach
- 1-65 — The Crossing, Kertigen Road
- 1-69 — The Crossing, Kertigen Road
- 1-70 — The Crossing, Kertigen Road
- 1-71 — The Crossing, Kertigen Road
- 1-72 — The Crossing, Ustial Road
- 1-73 — The Crossing, Ustial Road
- 1-98 — The Crossing, Kertigen Road
- 1-99 — The Crossing, Kertigen Road
- 1-109 — The Crossing, Kertigen Road
- 1-110 — The Crossing, Kertigen Road
- 1-111 — The Crossing, Kertigen Road
- 1-126 — The Crossing, Sicle Grove Lane
- 1-127 — The Crossing, Sicle Grove Lane
- 1-133 — The Crossing, Eylhaar Bane Road
- 1-135 — The Crossing, Eylhaar Bane Road
- 1-137 — The Crossing, Eylhaar Bane Road
- 1-173 — North Turnpike, Forest
- 1-206 — Asemath Academy, Path of Wisdom
- 1-249 — Willow Walk, Garden Path
- 1-250 — Willow Walk, Garden Path
- 1-251 — Willow Walk, Garden Path
- 1-252 — Willow Walk, Garden Path
- 1-253 — Willow Walk, Garden Path
- 1-254 — Willow Walk, Garden Path
- 1-255 — Willow Walk, Garden Path
- 1-256 — Willow Walk, Garden Path
- 1-257 — Willow Walk, Garden Path
- 1-259 — Willow Walk, Garden Path
- 1-261 — Willow Walk, Garden Path
- 1-262 — Willow Walk, Garden Path
- 1-263 — Emmiline's Cottage, Path
- 1-294 — Jadewater Mansion, Cobbled Path
- 1-336 — Wilds, Pine Needle Path
- 1-337 — Wilds, Pine Needle Path
- 1-434 — Northwall Trail, Wooded Grove
- 1-439 — A Damp Cavern
- 1-476 — Riverbank Trail
- 1-505 — The Strand, Tree-lined Path
- 1-506 — The Strand, Tree-lined Path
- 1-507 — The Strand, Tree-lined Path
- 1-508 — The Strand, Tree-lined Path
- 1-509 — The Strand, Tree-lined Path
- 1-510 — The Strand, Tree-lined Path
- 1-511 — The Strand, Tree-lined Path
- 1-512 — The Strand, Tree-lined Path
- 1-513 — The Strand, Tree-lined Path
- 1-514 — The Strand, Tree-lined Path
- 1-515 — The Strand, Hilltop
- 1-572 — A Damp Cavern
- 1-573 — A Damp Cavern
- 1-587 — Ranger Guild, Tree Grove
- 1-588 — Ranger's Guild, West Tree Grove
- 1-591 — The Strand, Large Dune
- 1-597 — The Strand, Shore
- 1-598 — The Strand, Shore
- 1-636 — Old Warehouse, Riverbank Cave
- 1-641 — Old Warehouse, Riverbank Mudflats
- 1-642 — Riverbank Mudflats
- 1-643 — Riverbank Mudflats
- 1-644 — Riverbank Mudflats
- 1-645 — Riverbank Mudflats
- 1-646 — Riverbank Mudflats
- 1-647 — Riverbank Mudflats
- 1-648 — Riverbank Mudflats
- 1-654 — Crossing Battlements, Campaign Tent
- 1-864 — Northwall Trail, Wooded Grove
- 1-868 — Wildulf Woods, Dense Forest
- 1-889 — Tunnel
- 1-890 — Tunnel
- 1-891 — Tunnel
- 1-1004 — The Raven's Court, Indoor Pond
- 1-1007 — Crossing Escape Tunnels, Hodierna's Path
- 1-1017 — The Seacaves of Peri'el, Tidal Cave

Historical recovery candidates are recorded in data/world/crossing-archive-candidates.json. Refresh them with tools/audit-crossing-archive.ps1 after regenerating this batch, then regenerate the batch again to attach the candidates. Archive matches never approve prose, topology or models automatically.

## Completion gate

- every room has reviewed source evidence
- no unbuilt or placeholder room
- all legal exits have deliberate endpoints
- interiors and vertical relationships reviewed
- assets have provenance and measured bounds
- all room captures reviewed at gameplay framing
- tests and dense-scene performance accepted

A populated inventory is not a populated city. No current partial recipe is certified complete by this batch compiler.
