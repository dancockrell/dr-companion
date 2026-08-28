# The soundscape

Two systems, easy to confuse because they share `data/audio/` and a mute
button each, but built for different things.

**Alerts** (`src/lib/alertSound.ts`) — short one-shots tied to Genie
highlight lines: `dr-genie-settings/Config/highlights.cfg`, played through
Tauri's `read_sound` from the player's own Genie install. Unrelated to
everything below.

**Ambience** (`src/lib/ambientSound.ts`) — the background layer covered
here: terrain texture, per-zone music, and an optional radio override.
Files live under `public/audio/`, served as plain static assets, not routed
through Tauri at all - they ship with the app rather than living in a
player's Genie folder.

## Layers

1. **Biome ambience.** Every one of the 85 zones in `src/data/map/*.json`
   is classified into a biome in `data/audio/zone-biomes.json` (forest,
   town, cave, road, etc. — see that file's `classify()` origin in this
   doc's history if the categories ever need revisiting). Each biome maps
   to a file in `BIOME_FILES` in `ambientSound.ts`. This is the fallback
   that covers everything, including roads and zones nobody has hand-tuned
   yet.
2. **Zone music.** One theme per zone id, tried by convention at
   `/audio/zone/<id>.mp3` — not looked up in a manifest at runtime, just
   attempted, and a missing file silently falls back to biome-only (same
   shape as `roomArtUrl` degrading to the generated room stand-in). This is
   the layer that makes a hunting region feel distinct, and it is almost
   entirely unbuilt: `data/audio/manifest.json`'s `zone` object is empty.
   Adding a zone's theme is: source a track, add a `zone` entry to the
   manifest with the file at `zone/<id>.mp3`, run
   `node tools/vendor-audio.mjs`.
3. **Radio.** A player-toggled override of the music layer only — ambience
   keeps playing underneath. Also unbuilt: `manifest.json`'s `radio` array
   is empty. The brief, from Dan: curated, licensed, pre-1900-leaning
   tracks across fantasy/classical/guitar/European/Arabic/Chinese/Japanese
   genres — expect to source a lot of candidates and reject most of them
   on quality or licensing grounds.

## Why zone, not room

`setZone()` is a no-op unless the zone id actually changes. The live bridge
reports a room on every step, and GamePane's own header already measured
eighteen movement events in ninety seconds in one room (Firulf Vista) — a
naive "play on every room update" design would restart background music
that often. Crossfading between zones (2.5s, in `ambientSound.ts`'s
`Layer`) is the only thing that ever changes what is playing, and — an
emergent property worth knowing about, not something separately coded —
moving between two zones that share a biome doesn't even restart the
ambience layer, only the zone-music layer, because `Layer.play()` is
itself a no-op on an unchanged source.

## Sourcing discipline

`data/audio/manifest.json` is the only place a file's licence is recorded.
Nothing goes into `public/audio/` (gitignored, like `public/rooms/`)
without a manifest entry first — `tools/vendor-audio.mjs` is what actually
fetches it, and `--check` reports what's missing without downloading.
`data/audio/ATTRIBUTIONS.md` is the human-readable version, kept in sync by
hand for now.

Royalty-free first (CC0 preferred, CC-BY acceptable with credit), AI
generation as a fallback for anything DR-specific that can't be found —
Dan's call, 27-28 Aug 2026. Never DragonRealms' own audio.

## What's actually done as of this writing

Four biome tracks (forest, town, cave, dungeon — the remaining seven
biomes in `BIOME_FILES` point at one of those four as a stand-in, see the
comment above `FALLBACK_BIOME`), the full 85-zone biome classification,
the crossfade engine, the vendor/manifest pipeline, the mute toggle, and a
radio picker in GamePane listing every station `RADIO_STATIONS` (read
from the manifest, not guessed) actually names. Five radio tracks sourced
— see `data/audio/ATTRIBUTIONS.md` for what and their licences. Zero zone
themes. Verified by measuring `Audio.play()` calls against the fixture and
directly, not by reading the code — same method as the alert-sound fix;
see that commit for why that discipline matters here. The radio picker
itself was verified the same way: selected a station through the actual
`<select>` element and confirmed the right file (`shika-no-tone.ogg`, not
a guessed `.mp3`) was the one `Audio.play()` was called with.

Sourcing so far went through OpenGameArt (biome tracks) and Wikimedia
Commons (radio) - the second because a scripted `imageinfo` API call
returns an explicit machine-readable licence per file rather than a page
that has to be read by eye, which matters when several files are being
pulled in one pass. One sourcing bug worth knowing about: Wikimedia
returns a 200 with a small HTML/text body to a request it does not like,
not a 4xx - `tools/vendor-audio.mjs` treats a suspiciously small or
HTML-typed response as a failure rather than a fetch, and that check was
proven against a real bad URL before being trusted (see its own commit).
