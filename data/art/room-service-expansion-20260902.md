# Room service-art expansion — 2026-09-02

This batch expands DR Companion's literal room scenes using only native
1792×1008 landscapes from the Grok Imagine full pack. It adds narrowly named
service interiors rather than widening generic prose inference.

## Review and selection

- Reviewed 378 landscape candidates across eight contact sheets. A post-merge
  native-resolution audit found four incomplete payloads that dimension and
  decoder checks had missed; those files are quarantined from the application.
- Kept selection deterministic and restricted to explicit room-title evidence.
- Recorded subject traits, habitat, current image, approved primary, variants,
  rejects, regeneration need, source UUID, and SHA-256 in
  `grok-room-landscape-expansion.json`.
- Reused the three complete source-pack matches. Four subjects remain explicit
  regeneration targets and temporarily use the nearest intact reviewed family.

## Admitted and quarantined subjects

| Subject | Approved asset | Primary correction |
| --- | --- | --- |
| Working official office | Quarantined; guild-hall fallback | Source payload had a flat gray lower half. |
| Healer ward | `healer-ward-f3a8421c.jpg` | Adds a bed-and-herbs treatment interior for explicit wards and infirmaries. |
| Armory | `armory-7142832a.jpg` | Separates stored weapons from training halls and battle scenes. |
| Locksmith | `locksmith-ee33bafb.jpg` | Adds a tools-and-locks specialist workshop. |
| Tannery | Quarantined; leather-workshop fallback | Source payload had a flat gray lower half. |
| Carpet merchant | Quarantined; textile-shop fallback | Source payload had a reconstruction seam and black lower band. |
| Glove merchant | Quarantined; textile-shop fallback | Source payload had a flat gray lower half. |

## Matching corrections

- `[Empaths' Guild, Guildleader's Office]` temporarily resolves to the intact
  guild-hall fallback until a complete working-office scene is admitted.
- `The Crossing, Bank Street` stays an outdoor town scene.
- Named river and directional banks stay water scenes; explicitly financial
  banks use the intact guild-hall fallback.
- Room prose remains limited to environmental fallback families, so incidental
  furniture and inventory words cannot invent a specialist location.

## Deferred generation

Regeneration is required for the working office, tannery, carpet merchant, and
glove merchant. Replacements must pass the same contact-sheet,
native-resolution, semantic-match, provenance, and reachability checks before
admission; dimensions and successful decoding are not sufficient visual QA.

## Library-wide integrity follow-up

The same pixel-level audit found eight older admitted scenes with reconstruction
seams, severe color discontinuities, or blank terminal bands:
`forest-sunlit-0261ab7e.jpg`, `forest-clearing-06aeb546.jpg`,
`desert-canyon-0322415e.jpg`, `cliff-monastery-0183963f.jpg`,
`mountain-bridge-05a1ad18.jpg`, `night-market-04c61394.jpg`,
`sea-cave-038edbd8.jpg`, and `tree-city-04b6c4bd.jpg`. They are also removed
from runtime families and generated scene baskets. Intact reviewed variants
replace them where available; desert rooms intentionally retain the honest
room fingerprint until a complete desert scene is admitted.

`python/test_room_scene_images.py` now decodes every shipped Grok room scene,
checks production dimensions, and rejects large or terminal flat bands. Both
the canonical suite and the scene-art workflow run this check, including when
`public/grok-art/room-scenes` changes.
