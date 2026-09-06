# World content integration — 6 September 2026

## One pipeline, different evidence strengths

Imported the focused `9491201a1736702cff9d6516b0c18dd6cd957ba6` commit from
`feat/world-content-pipeline` into the existing Crossing branch. Source branch
head was `d90851c187966fa2928ff74331e94f4f7dbf1f03`; shared merge base was
`129e222b98c5e4536895f5d8bf30fa433bdc4884`. The plan-audit commits and unrelated
application changes on that branch are not part of this integration.

The imported build-world-content tool is the owner of all-zone cartographic
classification. It covers 17,750 rooms across 85 zones. These are classified
records, not 17,750 modeled or completed scenes. Its reported unknown share
measures rule coverage, not independently verified accuracy.

The existing primitive-world build now runs that owner and attaches its matching
record as cartographicContent to each room. Crossing's native composition
compiler consumes the building-interior hint for its neutral floor treatment;
the room description remains the authority for furnishings. This is not an
alternate renderer. SharedAssetContent still renders the same roomCompositions.

Authoritative room IDs, exits, positions, source-description admission and
authored overrides are unchanged. Cartographic classification cannot resolve
missing prose, approve furniture, manufacture a guild building, or certify a
physical boundary. A missing compass exit does not by itself prove a wall.

## Evidence and remaining work

The imported world-content suite was independently run: 12 checks passed,
including exact regenerated-file comparison, all-room coverage and registered
primitive contracts. That does not validate its individual classifications.

Known semantic risks needing review before structural admission include broad
water words (riverbank, quay, boathouse), colour precedence and threshold-based
interior inference. These must remain hints, particularly where descriptions
say otherwise. Whole-city structure, street continuity, asset coverage, gameplay
framing and visual quality remain unfinished.

The next structure pass must consume this common classification and explicit
description evidence; do not introduce a third classification vocabulary.

Integrated validation: 18 Godot scripts passed (4,799 checks), application
TypeScript/Vite production build passed, world-content reproducibility checks
passed, native composition/caching tests passed, presentation-bridge tests
passed, mock fixture contract passed, and full-Crossing geometry tests passed.
The generated room count remains 17 partial furnishing recipes plus 26 authored
partial scenes. This checkpoint adds no claim of completed buildings.
