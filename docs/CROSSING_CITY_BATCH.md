# Crossing: single city-wide production batch

Current completion authority: the entire zone, not Town Green or another neighborhood. Small commits are checkpoints inside this one batch. This report is generated; update the sources and recipes, not the report.

Run: node tools/build-crossing-city-batch.mjs. Add --check-complete for the release acceptance gate (expected to fail while unfinished).

## Current inventory

- rooms: 1060
- directedExits: 2389
- descriptions: 840
- missingDescriptions: 220
- partialRecipes: 22
- complete: 0
- compassMismatches: 493
- sourceCompassMismatches: 2

## Coordinated asset families

- street-and-junction: 127 rooms
- garden-and-boundary: 135 rooms
- riverine-and-maritime: 86 rooms
- rock-cave-and-underground: 47 rooms
- interior-shell-and-fittings: 121 rooms
- building-frontage: 139 rooms
- vertical-connection: 38 rooms
- workshop-and-commercial-display: 127 rooms

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
- 1-195 — Asemath Academy, Entrance
- 1-206 — Asemath Academy, Path of Wisdom
- 1-218 — Ragge's Locksmithing, Salesroom
- 1-219 — Mauriga's Botanicals, Salesroom
- 1-223 — Herilo's Artifacts, Showroom
- 1-231 — First Provincial Bank, Lobby
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
- 1-310 — Empaths' Guild, Library
- 1-316 — Town Hall, Second Floor Landing
- 1-325 — Orem's Bathhouse, Lobby
- 1-336 — Wilds, Pine Needle Path
- 1-337 — Wilds, Pine Needle Path
- 1-339 — Traders' Guild, Main Hall
- 1-342 — Traders' Guild, Banquet Room
- 1-362 — Traders' Guild, Gallery
- 1-404 — Guard House, Office
- 1-405 — Guard House, Hallway
- 1-434 — Northwall Trail, Wooded Grove
- 1-435 — Marcipur's Stitchery, Workshop
- 1-436 — Talmai's Cobblery, Salesroom
- 1-439 — A Damp Cavern
- 1-454 — Barana's Shipyard, Office
- 1-463 — Saranna's Sweet Tooth, Kitchen
- 1-475 — Bards' Guild, Balcony
- 1-476 — Riverbank Trail
- 1-477 — Amusement Pier, Entrance
- 1-481 — Emmiline's Cottage, Kitchen
- 1-482 — Emmiline's Cottage, Pantry
- 1-491 — Strand Communal Center, Gathering Room
- 1-497 — Strand Communal Center, Solarium
- 1-498 — Strand Communal Center, Conservatory
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
- 1-532 — The Raven's Court, Landing
- 1-544 — The Raven's Court, Herb Garden
- 1-557 — The Raven's Court, Hallway
- 1-558 — The Raven's Court, Hallway
- 1-559 — The Raven's Court, Hallway
- 1-561 — The Raven's Court, Library
- 1-572 — A Damp Cavern
- 1-573 — A Damp Cavern
- 1-574 — Thieves' Guild, Hallway
- 1-575 — Thieves' Guild, Hallway
- 1-576 — Thieves' Guild, Foyer
- 1-577 — Thieves' Guild, Library
- 1-579 — Thieves' Guild, Office
- 1-584 — Thieves' Guild, Training Room
- 1-585 — Ranger Guild, Main Hall
- 1-586 — Ranger Guild, Storeroom
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
- 1-655 — Orielda's Blossoms, Front Room
- 1-656 — Orielda's Blossoms, Workroom
- 1-670 — Half Pint Inn, Balcony
- 1-675 — Aesthene's Close, Corridor
- 1-676 — Aesthene's Close, Corridor
- 1-677 — Aesthene's Close, Corridor
- 1-678 — Aesthene's Close, Corridor
- 1-679 — Aesthene's Close, Corridor
- 1-680 — Aesthene's Close, Corridor
- 1-681 — Aesthene's Close, Corridor
- 1-682 — Aesthene's Close, Corridor
- 1-683 — Aesthene's Close, Corridor
- 1-688 — Korhege Apartments, First Floor
- 1-689 — Korhege Apartments, First Floor
- 1-693 — Dintacui Apartments, First Floor
- 1-694 — Dintacui Apartments, First Floor
- 1-702 — Ulven's Warehouse, Storage
- 1-705 — Brisson's Haberdashery, Storage
- 1-706 — Brisson's Haberdashery, Fitting Room
- 1-708 — Viper's Nest, Courtyard
- 1-710 — Viper's Nest, The Pit
- 1-713 — Taelbert's Inn, Lobby
- 1-714 — Taelbert's Inn, Bar
- 1-715 — Taelbert's Inn, Dining Room
- 1-719 — Taelbert's Inn, Hallway
- 1-720 — Taelbert's Inn, Hallway
- 1-738 — Gaethrend's Court, Foyer
- 1-740 — Gaethrend's Court, Barroom
- 1-742 — Gaethrend's Court, Dining Room
- 1-743 — Gaethrend's Court, Hallway
- 1-744 — Gaethrend's Court, Hallway
- 1-745 — Gaethrend's Court, Hallway
- 1-746 — Gaethrend's Court, Hallway
- 1-751 — Tower East, Air Floor
- 1-752 — Tower East, Water Floor
- 1-753 — Tower East, Fire Floor
- 1-754 — Tower East, Aether Floor
- 1-756 — Eastern Gate, Guard House
- 1-763 — Ragge's Locksmithing, Basement
- 1-782 — Barbarian Guild, Common Room
- 1-787 — Paladins' Guild, Library
- 1-790 — Paladins' Guild, Armory
- 1-792 — Paladins' Guild, Hallway
- 1-797 — Paladins' Guild, Basement
- 1-798 — Paladins' Guild, Balcony
- 1-799 — Paladins' Guild, Courtyard
- 1-850 — Market Plaza, Foyer
- 1-861 — The Raven's Court, Basement
- 1-863 — Brother Durantine's, Storeroom
- 1-864 — Northwall Trail, Wooded Grove
- 1-868 — Wildulf Woods, Dense Forest
- 1-872 — Barsabe's Grocery, Kitchen
- 1-873 — Crossing Outfitting Society, Entry Hall
- 1-875 — Aesthene's Close, Corridor
- 1-889 — Tunnel
- 1-890 — Tunnel
- 1-891 — Tunnel
- 1-892 — Dintacui Apartments, Second Floor
- 1-893 — Dintacui Apartments, Second Floor
- 1-894 — Dintacui Apartments, Third Floor
- 1-895 — Dintacui Apartments, Third Floor
- 1-896 — Tower South, Earth Floor
- 1-898 — Crossing Alchemy Society, Entrance
- 1-910 — Crossing Outfitting Society, Office
- 1-917 — Crossing Outfitting Society, Workroom
- 1-918 — Crossing Outfitting Society, Workroom
- 1-926 — Crossing Engineering Society, Hallway
- 1-928 — Crossing Engineering Society, Workshop
- 1-929 — Crossing Engineering Society, Workshop
- 1-930 — Crossing Engineering Society, Workshop
- 1-931 — Crossing Alchemy Society, Tool Shop
- 1-932 — Crossing Alchemy Society, Bookstore
- 1-933 — Crossing Alchemy Society, Supplies
- 1-934 — Crossing Alchemy Society, Office
- 1-937 — Estate Holders' Headquarters, Foyer
- 1-942 — Estate Holders' Headquarters, Home Exchange Office
- 1-945 — Bards' Guild, Wine Cellar
- 1-947 — Raven's Court, Hallway
- 1-948 — Raven's Court, Hallway
- 1-949 — Raven's Court, Hallway
- 1-976 — The Crossing Meeting Hall, Corridor
- 1-977 — The Crossing Meeting Hall, Corridor
- 1-978 — The Crossing Meeting Hall, Lounge
- 1-988 — Commendable Collectibles, Foyer
- 1-989 — Commendable Collectibles, Showroom
- 1-990 — Commendable Collectibles, Showroom
- 1-991 — Commendable Collectibles, Alcove
- 1-994 — Crossing Enchanting Society, Entrance
- 1-996 — Crossing Enchanting Society, Supplies
- 1-997 — Crossing Enchanting Society, Tool Store
- 1-1004 — The Raven's Court, Indoor Pond
- 1-1007 — Crossing Escape Tunnels, Hodierna's Path
- 1-1008 — Korhege Apartments, Second Floor
- 1-1009 — Korhege Apartments, Second Floor
- 1-1010 — Korhege Apartments, Third Floor
- 1-1011 — Korhege Apartments, Third Floor
- 1-1012 — Merchant Apartments, Second Floor
- 1-1013 — Merchant Apartments, Second Floor
- 1-1014 — Merchant Apartments, Third Floor
- 1-1015 — Merchant Apartments, Third Floor
- 1-1017 — The Seacaves of Peri'el, Tidal Cave
- 1-1022 — The Office of Inspiration, Work Room
- 1-1036 — Two Rivers Boarding House, Dining Room
- 1-1037 — Two Rivers Boarding House, Scullery
- 1-1038 — Two Rivers Boarding House, Parlor
- 1-1047 — Two Rivers Boarding House, Attic

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
