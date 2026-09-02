# Brand emblem pipeline

Source of the dragon-and-compass-rose mark used for the app icon and favicon
(src-tauri/icons/*, public/favicon.svg). Reproducible in three steps:

1. `emblem-source.png` — raw output from Magnific (Recraft V4.1, upscaled 2x),
   prompted for a flat-vector heraldic emblem in the app's own ink/gold
   palette (see index.css's `--color-surface` / `--color-accent`).
2. `python recolor.py` — snaps the generated background to the app's exact
   `--color-surface` (#0d0c0a) rather than Magnific's close-but-not-quite dark.
3. `python crop_icon.py` — crops tight around the dragon+wheel, excluding the
   long tail flourish (it doesn't survive downscaling to icon sizes).
4. `python make_source_icon.py` — composites onto a rounded-square ink
   background, matching the squircle convention the old icon used, and writes
   `source-icon-1024.png`.

That file was copied to `src-tauri/icons/source.png`, then
`npx tauri icon src-tauri/icons/source.png -o src-tauri/icons` regenerated
every platform size from it in one pass.

The favicon uses a separately-dilated (thicker-stroked) pass of the same
crop, composited the same way — full detail doesn't survive to 16-32px, a
bolder silhouette does. Re-derive it from `emblem-source.png` with an added
`ImageFilter.MaxFilter` pass if it ever needs regenerating; not kept here
since it's fully reproducible from the same source.
