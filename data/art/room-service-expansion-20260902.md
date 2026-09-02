# Room service-art expansion — 2026-09-02

This batch expands DR Companion's literal room scenes using only native
1792×1008 landscapes from the Grok Imagine full pack. It adds narrowly named
service interiors rather than widening generic prose inference.

## Review and selection

- Reviewed 378 landscape candidates across eight contact sheets, then inspected
  the selected files at native resolution.
- Kept selection deterministic and restricted to explicit room-title evidence.
- Recorded subject traits, habitat, current image, approved primary, variants,
  rejects, regeneration need, source UUID, and SHA-256 in
  `grok-room-landscape-expansion.json`.
- Reused the source pack instead of generating a redundant new batch because it
  already contained strong, coherent matches for all seven subjects.

## Admitted subjects

| Subject | Approved asset | Primary correction |
| --- | --- | --- |
| Working official office | `official-office-b2888959.jpg` | Replaces a monumental marble hall in guildleader, registry, bank, teller, and public-office rooms. |
| Healer ward | `healer-ward-f3a8421c.jpg` | Adds a bed-and-herbs treatment interior for explicit wards and infirmaries. |
| Armory | `armory-7142832a.jpg` | Separates stored weapons from training halls and battle scenes. |
| Locksmith | `locksmith-ee33bafb.jpg` | Adds a tools-and-locks specialist workshop. |
| Tannery | `tannery-4299577b.jpg` | Separates hide processing from finished-leather retail. |
| Carpet merchant | `carpet-shop-37558278.jpg` | Adds a rug-filled merchant interior without matching incidental carpets. |
| Glove merchant | `glove-shop-94e50c0a.jpg` | Adds a fitted-goods shop without matching incidental gloves. |

## Matching corrections

- `[Empaths' Guild, Guildleader's Office]` now resolves to the working office,
  not the marble guild hall or leather workshop.
- `The Crossing, Bank Street` stays an outdoor town scene.
- Named river and directional banks stay water scenes; explicitly financial
  banks use the official-office scene.
- Room prose remains limited to environmental fallback families, so incidental
  furniture and inventory words cannot invent a specialist location.

## Deferred generation

No regeneration is needed for these seven subjects. Future Magnific or Grok
generation should target a documented coverage gap or a weak existing family,
then pass through the same contact-sheet, native-resolution, semantic-match,
provenance, and reachability checks before admission.
