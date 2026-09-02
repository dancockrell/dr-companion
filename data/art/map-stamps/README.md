# Map-stamp production

This directory records how source art becomes a shipped map stamp. It is not a
runtime asset directory.

The layers are deliberately separate:

- `batches/`: reusable reel templates and immutable execution records. Templates
  contain no creation ID or spend claim; executed batches record both;
- `raw/`: untouched vendor videos and exports, kept outside Git when large;
- `candidates/`: harvested frames and contact sheets, never consumed at runtime;
- `approved/`: reviewed source frames before final crop, alpha, and optimization;
- `public/map-stamps/`: the only shipped layer.

No harvested directory may be copied wholesale into `public/map-stamps`.
Every runtime image needs an `approved` entry in `curation.json`, a stable
family assignment, an independent full-size and in-map review, and a passing
`npm run test:map-stamp-curation` check. Rejections remain in the ledger so a
publisher cannot rediscover them later.

## Reel workflow

1. Approve one unsigned anchor at full resolution and record its SHA-256.
2. Check the live Magnific balance and video catalog. Record expected spend.
3. Generate one short silent reel with one camera idea and stable topology.
4. Preserve the downloaded video unchanged and record its SHA-256.
5. Harvest at 6 fps for holds or 12 fps for pans/orbits with perceptual
   deduplication enabled.
6. Review the contact sheet, then inspect every survivor at full size and at
   its intended map scale over parchment.
7. Promote only independently shippable frames. Record every rejection and
   reason. Remove the background, crop with safe margin, and optimize the
   approved runtime copy without replacing the source.
8. Add runtime references deterministically and rerun the map, stamp, bundle,
   and curation tests.

FFmpeg and FFprobe are required by the harvester. Their absence is a hard
preflight failure, not permission to claim a reel was reviewed.
