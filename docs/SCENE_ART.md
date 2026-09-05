# Scene art

> **Scope:** this document describes the existing 2D illustration selection pipeline. It remains useful for provenance and semantic matching, but it does not define the replacement world renderer. New board production follows the [world-board strategy](THREE_D_WORLD_STRATEGY.md), using reusable geometry kits and reviewed actor assets.

DR Companion treats room art as an illustration layer over DragonRealms, not as a replacement for room text. The game text remains authoritative when art and prose disagree.

## Selection order

Scene selection should become more specific only when the data justifies it:

1. **Curated landmark / published override** — an exact reviewed image for a distinctive named place.
2. **Regional family** — a settlement-specific family such as Crossing, Ratha, Shard, Riverhaven, Muspar'i, Hibarnhvidar, or Leth Deriel.
3. **Semantic basket** — an approved reusable family such as forest path, deep forest, mountain pass, riverside, swamp, desert, garden, sewer, mine tunnel, or grassland.
4. **No scene assignment** — preferable to confidently showing the wrong environment. Existing lower-level room-art fallbacks may still apply elsewhere in the renderer.

The generator in `tools/build-room-scene-patterns.mjs` preserves curated places and uses `tools/scene-semantics.mjs` for reusable scene assignment.

For Crossing, a title-backed street classification is necessary but not sufficient. The current three-image city-street family is narrowly allow-listed to reviewed places. Riverfronts, green outskirts, guild grounds, ceremonial approaches, walls, markets and other recognizable districts remain unresolved until matching regional or landmark art exists. Their district and reason are retained in the full audit.

## Semantic model

A scene analysis records more than one category. It also records traits used to explain and eventually improve selection:

- `environment`: forest, desert, wetland, waterside, mountain, underground, cultivated, settlement, grassland, or unknown.
- `subtype`: route, interior, bank, street, garden, passage, sewer, overland, etc.
- `civilization`: wilderness, mixed, settled, urban, infrastructure, or unknown.
- `water`: present, absent, or unknown.
- `elevation`: high, low, or unknown.
- `route`: whether the prose describes a traversable route that should remain visually readable.
- `signals`: the title/lore evidence that caused the classifier to choose a basket.
- `confidence`: a coarse confidence value for diagnostics, not a claim of certainty about DragonRealms lore.

`data/art/scene-basket-coverage.json` is the audit report produced by the scene-pattern generator. Generated assignments now include these traits and signals; unresolved multi-room places are listed explicitly rather than silently disappearing.

## Art-direction rule

**Scene facts come from the room; visual style comes from the art direction.**

Do not put universal scene facts into a global style suffix. In particular, global prompts must not force:

- stone or timber architecture,
- torchlight or candlelight,
- buildings or settlement density,
- people or crowds,
- water,
- elevation,
- roads,
- weather,
- a time of day.

Those details are correct in some DragonRealms rooms and wrong in many others. A forest, marsh, desert, underwater room, field, cavern, and temple should share a visual language without being forced to share architecture or lighting.

A safe shared style describes rendering only: painterly fantasy realism, palette, atmospheric depth, composition, texture, and the exclusions required by the art-safety pipeline.

## Archetype -> region -> landmark

The practical production model is:

**Archetype -> regional identity -> landmark.**

Archetypes provide enough visual variation that travel does not repeat one image constantly. Regional families make important towns and provinces recognizable. Curated landmarks get bespoke art when recognition materially helps navigation or atmosphere.

This is intentionally different from one generated image per room. There are too many rooms, literal image generation is expensive to review, and a single misleading detail can make a nominally unique render worse than a strong reusable scene family.

## Review workflow

When reviewing or generating scene art:

1. Read the room/place title and lore first.
2. Identify the semantic environment before choosing or generating an image.
3. Prefer an existing approved basket when it expresses the place accurately.
4. Add regional specificity when the location is meant to be recognizable as a particular settlement or region.
5. Reserve bespoke images for landmarks and genuinely distinctive spaces.
6. Reject images whose dominant architecture, biome, water, elevation, or route contradicts the text even if the picture is attractive.
7. Record recurring failures as basket curation or semantic rules rather than fixing rooms one at a time.

Crossing's prioritized missing-image plan lives in `regionalIdentity.Crossing.productionQueue` in `data/art/scene-baskets.json`. Each entry has an ordered priority, exact place scope, production rationale and a generation-ready prompt. These are specifications for later reviewed generation; the scene-data pipeline does not create or substitute binary art.

## Current limitation

The semantic classifier is deliberately conservative and rule-based. It is an explainable first layer, not a world-model claim. As scene review finds false positives and missing categories, improve the classifier and basket metadata together. Explicit curation always outranks automatic classification.
