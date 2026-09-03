# The soundscape

**Status, 29 Aug 2026 (later still): Salt and Sail and Silk Road are gone.
Four stations now, not six, 178 tracks not 233.** Read this block first;
everything below describing six stations, 217+ tracks, or either of those
two by name is history.

Salt and Sail (sea shanties/nautical folk) never actually had the
inventory: a real check of all 20 tracks against their own Wikimedia
descriptions found 4 genuine performances and 16 things that were not
sea shanties at all - Toki Pona conlang covers, Kevin MacLeod stock
tracks with "Shanty" in the name, a Swedish spoken-word lecture *about*
shanties, a 1902 operetta love song. Cut to those 4 real tracks first;
Dan's call after that: "salt and sail actually suck" - cut the last 4
too rather than fold them into another station. A follow-up attempt to
refill it from Jamendo (real popularity ranking, real per-track license
metadata - see tools/source-jamendo.mjs) confirmed the genre just isn't
there commercially-licensed on that platform either: "sailor"/"nautical"/
"pirate"/"ship" all return zero tagged tracks, "shanty" returns two, both
non-commercial-licensed. Mechanism validated, inventory didn't exist.
Killed rather than left thin.

Silk Road (Chinese/Japanese/Arabic/Persian) went the same way for a
different reason: most of its 35 tracks carried the literal note "Added
by tools/source-radio.mjs - composer/era not filled in, review before
treating as finished" - and never got that review. A spot-check turned
up Spanish flamenco/jota tracks miscategorized into an Arabic/Chinese
station, a Quran recitation (not music in the sense a radio station
plays), and a large cluster with blank composer/era fields and no
verification at all. Dan, comparing it to the orchestral stations that
*were* properly sourced: "not good in comparison." Killed rather than
half-fixed.

Both stations' tracks are removed from `manifest.json` entirely (not
just unwired) and `tools/build-zone-playlists.mjs`'s `characterFor()`
was rebalanced across the remaining four stations - coastal/maritime
zones now weight to Six Strings (which is where the shanty station's
one real strength, working folk vocal/guitar, already lived), zones
that leaned on Silk Road's "exotic-world flavor" fall back to a broader
Six Strings/Old Concert Hall mix. All 85 zone playlists still build and
still clear 45 minutes; `tools/ambient-test.mjs` passes clean at 4
stations / 178 tracks. Local orphaned audio files for both (69 of
them, counting the earlier Salt and Sail partial cleanup) deleted from
`public/audio/radio/` - gitignored, so nothing to commit there, but
worth knowing the count if the local cache looks smaller than expected.

Sourcing discipline going forward, stated plainly since this is the
second time a batch shipped without it: a track added by an automated
tool is not finished until someone actually checks it against its own
source page. "Review before treating as finished" in a `note` field is
a promise, not a disclaimer - if it's still there when this file is
next touched, that batch was never actually reviewed.

**Status, 29 Aug 2026 (later the same day): every radio/zone track is
loudness-corrected.** `tools/measure-loudness.mjs` (`npm run audio:loudness`)
measures each of the 233 radio tracks' mean volume (`ffmpeg -t 30 ... -af
volumedetect`, first 30 seconds - fast, and precise enough for what this is
correcting rather than mastering to a broadcast spec) and writes a `gainDb`
onto its `manifest.json` entry: `-20dB target - measured`, clamped to
`±9dB` so one badly-mastered outlier doesn't get pushed hard enough to
mostly amplify its own noise floor. A real sample measured a 25+ dB spread
before this existed - fifteen random tracks ran -15.8 dB to -41.4 dB mean
volume, meaning the quietest was roughly a nineteenth the perceived
loudness of the loudest at an identical slider position - sourced from a
dozen-plus uploaders across Wikimedia and OpenGameArt with no shared
mastering. `ambientSound.ts`'s `Layer` applies it as `trackGain`, a third
multiplicative factor alongside `mix` and the listener's slider, clamped to
1.0 before ever reaching `el.volume` (`HTMLAudioElement.volume` is
spec-clamped to [0, 1] and throws past that in a strict implementation -
verified live at the worst case, slider at 150% on the single largest
+9dB-boosted track, no throw). `tools/ambient-test.mjs` asserts every radio
track carries a `gainDb` and that none exceeds the clamp - sabotage-checked
(stripped one track's `gainDb`, set another to 20) before being trusted.
Re-run `npm run audio:loudness` after adding tracks; it skips (and reports)
anything not vendored locally yet rather than measuring silence as 0.

**Status, 29 Aug 2026: alerts are four channels with per-class throttling,
the panel is a standard mixer with favorites, and the app talks to the OS's
own media controls.** Everything below this block and above "What's new..."
is 28 Aug history; read this one first.

- **Alerts split into three channels** - System (idle warning, disconnects,
  learning), Danger (creature entering, wounds, bleeding, lodged/attached),
  Speech (whispers/tells) - so muting one kind of ping doesn't mean muting
  all of them, which is what emptied the config of wound sounds the first
  time. `alertGate.ts` (dependency-free, tested in plain Node by
  `tools/alert-throttle-test.mjs`) is the channel-mapping and throttle logic;
  `alertSound.ts` is the playback half.
- **The `wounds` class throttles as a class**, one ding per 30 seconds no
  matter how many wounds-class lines match in that window, not per sound
  file. That's what let `dr-genie-settings` put sound back on bleeding,
  severe wounds, lodged items and parasites without reproducing the
  "cacophony" that took it off in the first place - see that repo's
  `Config/highlights.cfg` for the config-side half and its own commit
  history for the real recordings that replaced the initial Hit.wav
  placeholder on those four.
- **The panel (`SoundControls.tsx`) is a standard mixer now** - icon + name +
  one-line description + slider + percent per channel, each with its own
  mute button that remembers its level, grouped under "Alerts" and "Music"
  headers. Opens upward from its footer-anchored trigger (a real bug from
  the panel growing tall enough to run off the bottom of the window when it
  still opened downward).
- **Favorite stations are first class** (`persistence.ts`'s
  `favoriteStations`) - star any built-in station or a named custom stream
  URL, one list, one click to play, persists across restarts. The six
  built-in stations are shown as a real list (name, track count,
  description) rather than hidden in a `<select>`.
- **The app is now a citizen of the OS's own media controls, not just a
  sender to them.** `initMediaSession()` in `ambientSound.ts` sets
  `navigator.mediaSession.metadata` from whatever's in the `music` slot and
  answers play/pause/previoustrack/nexttrack - Windows' Now Playing UI and
  physical media keys can drive the app's own zone/radio music, the mirror
  image of `externalMedia.ts` sending media keys *to* Spotify or a browser.
  Guarded on the API's presence (absent under plain Node, where
  `ambient-test.mjs` imports this module directly) and called once from
  `GamePane`'s mount effect, never at module scope.

**Status, 28 Aug 2026 (updated same day): ambience is gone for good; music
is back.** The ambient/zone-music/radio layer was disabled first, then Dan
clarified within the hour that only the *ambient* half of that was the
problem: "the idea for that ambiance is bad anyways. pull out that kind of
stuff. lets not," followed immediately by "i do want music. not
ambiant...just the music...lots of songs we had." So `ambientSound.ts` was
rewritten rather than left disabled: the terrain-texture `Layer` instance,
`BIOME_FILES`, `ZONE_BIOMES` and `biomeFor()` are deleted from the module
entirely (not just unwired), while `RadioPlayer`, `ZoneMusicPlayer`,
`RADIO_STATIONS`, `setZone()`, `setRadioStation()` and `setMusicVolume()`
are back and `GamePane.tsx` calls them again. The four biome ambience audio
files under `public/audio/biome/` are now unreferenced by any code path -
left on disk rather than deleted, same as the module logic was left in
place during the brief disabled window, in case biome-level texture is
wanted again later in some non-overlapping form. Everything in this file
that describes ambience as active is historical - the "Layers" section
below still names three layers because that is what was built and why, not
what plays today; read this status block as authoritative over it.

Two systems, easy to confuse because they share `data/audio/` and share a
control panel, but built for different things.

**Alerts** (`src/lib/alertSound.ts`) — short one-shots tied to Genie
highlight lines: `dr-genie-settings/Config/highlights.cfg`, played through
Tauri's `read_sound` from the player's own Genie install. Unaffected by any
of the ambience/music churn. Tuned to blend in rather than sit forward -
Dan's instruction (28 Aug 2026): "tune down your sound effects to be
background, to blend in generally."

**Music** (`src/lib/ambientSound.ts` - the filename predates the rewrite
and still describes what's inside the module, not what's on the label) —
per-zone playlists plus an optional radio-station override, covered in the
rest of this file. No terrain-texture layer under it any more; there is
only ever one thing playing in the module's `music` slot. Files live under
`public/audio/`, served as plain static assets, not routed through Tauri at
all - they ship with the app rather than living in a player's Genie folder.

## What's new since the status block above: a full player, not just a volume slider

28 Aug 2026, same evening. The panel gained a "now playing" line with
prev/next skip (works on radio and zone playlists - `ambientSound.ts`'s
`Layer` now emits its current track over a small `nowPlayingListeners` set,
and `RadioPlayer`/`ZoneMusicPlayer` both got a `skip(dir)` that jumps a
position and calls `playCurrent()` directly rather than waiting for `ended`),
a custom stream URL field, and global media-key control of whatever else is
playing outside the app.

**Custom stream URL** (`setCustomStream`/`currentCustomStream` in
`ambientSound.ts`) is the literal "plug in other radio sources" ask - a
player can point the `music` slot at any direct audio URL (an Icecast/
Shoutcast station, or anything else that streams), not just the six curated
built-in stations. It occupies the same slot radio and zone music do, so all
three are mutually exclusive: picking a built-in station clears the custom
URL, entering a custom URL clears the built-in pick, and clearing either
falls back to zone music. `setZone()` was updated to check `customStreamUrl`
alongside `radio.current` before it's allowed to touch the slot, the same
override relationship a built-in station already had. No licence/attribution
bookkeeping applies here the way it does to `manifest.json`'s curated pool -
a player pointing this at their own stream is responsible for what they
play, same as plugging a physical radio into a speaker. Persisted
(`persistence.ts`'s `radioStation`/`customStreamUrl`) and restored on mount
in `GamePane.tsx`, alongside the volume levels - previously neither the
built-in station pick nor (obviously) a custom stream survived a restart.

**External media control** (`src/lib/externalMedia.ts`,
`src-tauri/src/media_keys.rs`) answers the other half of the ask - "take
music from other games or Spotify and control it in game." Real per-app
audio capture (WASAPI loopback, mixed into this app's own output) is a
separate, much bigger project and is **not** attempted. What's built instead
is global media-key injection: `send_media_key` taps a virtual media key
(`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, etc., via `user32.dll`'s
`keybd_event`) exactly as a physical keyboard's media keys would, system-
wide. Spotify, browsers, VLC and most other players already answer to this
without any app-specific integration - the panel doesn't ask them for
anything, it just presses the same button a keyboard would. Windows-only
(`#[cfg(target_os = "windows")]`; this app only ships for Windows, see
Cargo.toml), and hidden from the panel entirely in the browser demo
(`externalMediaAvailable()` is `isTauri()` - there is no OS underneath the
demo to send a key to).

## Controls

`SoundControls.tsx` shows two sliders (Alerts, Music), a quick-mute button,
and a radio station picker - no Ambience slider; that channel is gone, not
hidden. One button "Sound" opens a popover with the sliders and the
`<select>`, rather than several separate icon-toggle buttons crammed into
the toolbar. Dan's ask (28 Aug 2026): "full and strong sound controls...
obvious but... easier to use and more intuitive than now."

**No separate mute flag anywhere - a slider at 0% is silent, and that is
the only state there is.** `alertsVolume()`/`musicVolume()` are plain
0-to-1.5 numbers (0% to 150%); a `setAlertsMuted`-style boolean was
considered and rejected, because a mute flag and a remembered volume level
are two pieces of state that can disagree with each other, and a control
that can silently disagree with what it shows is worse than one fewer
control. Persisted in `PersistedPrefs` (`src/lib/persistence.ts`) -
`alertsVolume`/`musicVolume`, both defaulting to 0 (muted) - not the earlier
0.45/1 - since a first run should never make noise nobody asked for; sound
is opt-in via the sliders, not opt-out (there is no `ambientVolume` field
any more either - removed rather than left dead, since a stale field that
nothing reads is exactly the kind of drift rule 1 in the working agreements
warns about) - and applied once at `GamePane` mount, since neither sound
module has (or should have) an opinion about storage.

**Quick mute** (28 Aug 2026, Dan: "mute quickly or whatever," reconfirmed
"that will need a volume control and mute too" when music came back) is a
separate button next to "Sound," not something you open the panel and drag
sliders to reach - one click sets both channels to 0, saving exactly where
they were; the same click again restores those exact numbers, not a
guessed default. Manually moving either slider while quick-muted clears the
saved state, so the button doesn't fight a deliberate adjustment.

Also removed from the toolbar, per Dan's instruction, to make room: the
`{link.lines} lines` counter (gone entirely) and the numeric `host:port`
display, replaced with a plain "Attached" - the number is still in the
connection indicator's `title` tooltip for anyone who needs it, just not
rendered inline.

**"Blend into the background" as actual numbers:** each `Layer.play()`
call site's base level (`Layer`'s `mix` in `ambientSound.ts`) was lowered
- ambient 0.3 → 0.15, zone/radio music 0.4 → 0.22 - so the 100% slider
position is already the tuned-down level Dan asked for, not a starting
point a listener has to find by ear. The slider then multiplies that base
by up to 1.5x, so turning it up is still available without touching the
source.

## "They are a menace" (28 Aug 2026) - what was actually wrong, and the fix

Two separate real problems, plus two bugs found while fixing them.

**The alert WAVs were mastered to 0 dBFS peak - maximum digital loudness,
zero headroom.** Measured with `ffmpeg -af volumedetect` on all six files
in `dr-genie-settings/Sounds/`: every one showed `max_volume: -0.0 dB`.
Combined with an 80% default multiplier on top, that is most of the way
to as loud as a WAV file can be, played on every idle warning, every
creature entering, every whisper. Cut to -8 dB peak with
`ffmpeg -af "volume=-8dB"`, originals kept in
`dr-genie-settings/Sounds/.originals-backup/`, redeployed to both
`dr-genie-settings/Sounds/` and the live `C:\Genie4\Sounds\` (diffed
after to confirm the two copies match). The default multiplier was also
lowered, 0.8 → 0.45 - fixing only the file or only the multiplier would
have still left alerts loud most of the way up the slider.

**Alerts now route through Web Audio (`AudioContext` → `GainNode`)
instead of the element's own `.volume`.** `HTMLAudioElement.volume` is
spec-clamped to [0, 1] - it cannot express the 100%-to-150% half of the
slider range at all, silently doing nothing past 100% (or throwing, in a
strict implementation). A `GainNode` per loaded sound, created once and
cached alongside the `<audio>` element (`createMediaElementSource` can
only be called once per element, ever), carries the real level instead;
the element itself stays at full scale. Falls back to the native
`.volume`, capped at 100%, if Web Audio is unavailable for any reason -
a real ceiling stated honestly, not a silent failure to boost.

**Bug found while building quick mute: clicking it closed the Sound
panel.** The outside-click-closes handler checked two separate refs
(the panel, the "Sound" trigger) and the new mute button was neither -
clicking it read as a click outside the control and closed whatever was
open, which is the opposite of "easier to use." Fixed by giving the
whole control (mute button, Sound trigger, panel) one wrapping ref and
checking that instead of two ad hoc ones.

**Bug found verifying the fix: the slider's displayed percentage could
silently disagree with what was actually playing.** `SoundControls`
initialized its React state by reading `alertsVolume()` directly from the
module at mount; `GamePane` applies the persisted level to that same
module in its own effect, in a separate render pass. Which one a
listener saw depended on which ran first, and on a fresh profile the two
defaults had already drifted apart (`persistence.ts`'s `alertsVolume`
default was still 0.8 from before the module's own default was lowered
to 0.45 - the same commit that introduced the first problem this section
describes reintroduced a version of it here). Fixed by having
`SoundControls` read the same `loadPrefs()` snapshot `GamePane`'s effect
reads, rather than the module's live value - removing the race instead of
correcting the one instance of it that happened to be caught.

All of this was verified in the running app rather than assumed: cleared
persisted prefs, hard-reloaded, and read actual DOM/slider state after
each step (mute, unmute, panel-still-open) - the first pass at this
verification gave contradictory results from querying too fast for
React's render to land and from testing across app restarts that raced
each other, both corrected by testing methodically rather than trusting
the first answer. The Web Audio gain-boost path itself was not exercised
live (would have meant real audible playback, and Dan had just reported
these very sounds as a problem) - checked instead that `AudioContext`/
`GainNode` are present in this WebView2's environment, and by code
review of otherwise-standard Web Audio API usage.

## Layers

**Only #2 and #3 below actually play, as of the status block at the top of
this file.** #1 (biome ambience) is described here because it's what got
built and the reasoning is worth keeping, not because it runs.

1. **Biome ambience — removed from the running app, 28 Aug 2026.** Every one of the 85 zones in `src/data/map/*.json`
   is classified into a biome in `data/audio/zone-biomes.json` (forest,
   town, cave, road, etc. — see that file's `classify()` origin in this
   doc's history if the categories ever need revisiting). Each biome maps
   to a file in `BIOME_FILES` in `ambientSound.ts`. This is the fallback
   that covers everything, including roads and zones nobody has hand-tuned
   yet.
2. **Zone music.** A roughly-one-hour *playlist* per zone (`ZoneMusicPlayer`
   in `ambientSound.ts`, same shuffle/loop/advance-on-`ended` shape as
   `RadioPlayer`), not a single file — Dan's ask (28 Aug 2026): "one hour
   playlists for each region," aware of what a zone actually is, not just
   its biome. `manifest.json`'s `zone` object maps a zone id to a track-id
   list drawn from the *same pool* radio stations use (no separate
   zone-only files). All 85 zones are built: `tools/build-zone-playlists.mjs`
   assigns each one a station-weighted mix from `characterFor()` — a
   thief-passage zone gets Halls of Shadow, a coastal one gets Salt and
   Sail, a real named city gets Throne and Temple, and so on — then fills
   it with shuffled tracks until the total passes an hour. Re-run it after
   adding radio tracks to redistribute; `--zone <id> --dry-run` previews
   one zone without writing.
3. **Radio.** A player-toggled override of the music layer only — ambience
   keeps playing underneath. Fallout-style, not a jukebox: selecting a
   station starts a *playlist* (`RadioPlayer` in `ambientSound.ts`) that
   shuffles once, loops, and advances on its own — it does not stop after
   one track, the way Galaxy News Radio does not. `manifest.json`'s
   `radio` array is a flat list of tracks, each tagged with a `station` id
   that groups into `manifest.json`'s `radioStations` object (name +
   description per station). The brief, from Dan: curated, licensed,
   chill-able tracks — pre-1900-leaning was a proxy for "not weird," not a
   hard rule — across fantasy/classical/guitar/European/Arabic/Chinese/
   Japanese genres, several tracks per station rather than one.

## Why zone, not room

`setZone()` is a no-op unless the zone id actually changes. The live bridge
reports a room on every step, and GamePane's own header already measured
eighteen movement events in ninety seconds in one room (Firulf Vista) — a
naive "play on every room update" design would restart background music
that often. Crossfading (2.5s, in `ambientSound.ts`'s `Layer`) is the only
thing that ever changes what is playing, and it applies to one layer now,
not two — the note this section used to have about a biome-sharing pair of
zones not restarting the ambience layer no longer applies now that there is
no ambience layer to not-restart.

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

Two biome tracks actually carry their own ambient audio (forest, dungeon)
— every other biome, including `town` and `cave`, points at one of those
two as a stand-in, see the comment above `FALLBACK_BIOME` in
`ambientSound.ts`. `town` and `cave` *did* have their own fetched files
(`biome/town.mp3` "Peaceful Village Loop", `biome/cave.mp3` "Cave Loop"),
but both turned out to be 16-second melodic tunes - a plucked/flute-led
tune, not the wind/water/drips texture this slot is for - measured with
`ffprobe` after a player heard it as "an annoying flute and guitar
plays over the music on a short loop," which it did, constantly, since
`town` is the biome for Crossing and every settlement/interior. Repointed
to the stand-ins rather than deleted; **town and cave still need their own
genuinely textural ambient track** (short is fine for a real texture loop -
see ambient-test.mjs's own comment on why that property is intentionally
*not* checked here the way it is for radio tracks; melodic is the actual
defect, not duration) - this is a
regression fix, not the fix for the underlying gap.

The full 85-zone biome classification, the crossfade engine, the
vendor/manifest pipeline, and the mute toggle are done.

**Radio: six stations, 233 tracks.** Six Strings (61, guitar/lute/cello,
including a large Spanish/flamenco folk batch), The Old Concert Hall (42,
western orchestral/piano), Throne and Temple (39, grand/ceremonial —
Handel, Purcell), Halls of Shadow (36, dark/dramatic — split out because
Brahms' and Beethoven's turbulent movements suit undead/dungeon zones
far better than a town square), The Silk Road (35, Chinese/Japanese/
Arabic/Persian, including six genuine 1914-1931 Egyptian recordings —
see "Roadmap" below), Salt and Sail (20, sea shanties/nautical folk, the
thinnest of the six — good folk maritime instrumental material is
scarcer on Commons than classical repertoire).
See `data/audio/ATTRIBUTIONS.md` (generated, not hand-maintained — run
`node tools/vendor-audio.mjs --attributions` after adding tracks).

**Zone music: all 85 zones**, each a roughly-one-hour playlist built by
`tools/build-zone-playlists.mjs` from the radio pool — see "Layers" above
and that script's own header for how `characterFor()` reads a zone's name
and biome into a station mix.

`tools/ambient-test.mjs` checks the manifest mechanically: every station
a track names actually got built, no station has fewer than two tracks,
every vendor-fetchable entry has a file/download/licence, every
attribution-required entry carries its text, every radio track measures
at least 90 seconds by `ffprobe` (added after three tracks turned out to
be 49s/63s/70s demo clips wearing a full song's metadata), and every zone
playlist references real track ids and totals at least 45 minutes
(reading `data/audio/.track-durations-cache.json`, committed specifically
so this check works on a fresh checkout before `public/audio/` exists to
re-probe). Sabotage-verified against real defects — a missing licence, an
undeclared station, a one-track station, a track pointed at a nonexistent
station, an empty zone playlist, and an unknown track id in a zone
playlist were each introduced on a scratch copy and confirmed to fail
before being trusted. Not yet wired into `npm run test` — `package.json`
was mid-edit by another session when this landed; add `test:ambient`
there when it's free.

The engine-level claims (crossfade, no-restart-on-same-zone, a station or
zone playlist actually calling the files it says it will) were verified
separately by measuring `Audio.play()` calls against the fixture and
directly — same method as the alert-sound fix, see that commit for why
that discipline matters here. `tools/ambient-test.mjs` cannot make that
claim: it runs in plain Node, which has no `Audio` constructor, so it
only reaches the module's data and the pure `shuffled` helper — see the
file's own header. A few tracks use unusual containers (Ogg-FLAC, Ogg
Skeleton-multiplexed) and are flagged with a `note` in the manifest,
confirmed serving correctly over HTTP but still owed a real playback
check in a browser.

## A real trap this system hit: Vite's watcher and `data/audio/`

`vite.config.ts`'s dev-server watcher used to ignore all of `data/` (to
stop an OOM crash from the art pipeline's ComfyUI venv — see that file's
own history). That silently broke hot-reload for
`data/audio/manifest.json`, which `ambientSound.ts` reads as a real ES
module import, not a static asset: editing the manifest updated the file
on disk and nothing else, because Vite's watcher was told never to look
under `data/` at all. Every radio/zone-playlist edit looked correct
against the source and produced zero new `Audio.play()` calls in the
running app until the dev server was restarted by hand — the same
"looks right, does nothing" shape the whole test suite here exists to
prevent, just moved into a layer no amount of `ambient-test.mjs` coverage
can see, because the bug wasn't in the data or the code, it was in what
Vite was willing to notice changed. Fixed by naming the two actually-
churny directories (`data/art/comfy-venv`, `data/art/out`) instead of
their parent. If a `data/audio/*` edit ever again looks correct but
doesn't reach the running app, check whether the dev server has been
restarted since — this exact failure has now happened twice with two
different unrelated symptoms.

Sourcing went through OpenGameArt (biome tracks) and Wikimedia Commons
(radio) - the second because a scripted `imageinfo` API call returns an
explicit machine-readable licence per file rather than a page that has to
be read by eye, which matters when a dozen-plus files are being pulled in
one pass. One sourcing bug worth knowing about: Wikimedia returns a 200
with a small HTML/text body to a request it does not like, not a 4xx -
`tools/vendor-audio.mjs` treats a suspiciously small or HTML-typed
response as a failure rather than a fetch, and that check was proven
against a real bad URL before being trusted (see its own commit).

## Bulk sourcing: tools/source-radio.mjs

Hand-picking tracks one at a time doesn't reach the scale this needs
("hundreds of songs" - Dan, 28 Aug 2026). `tools/source-radio.mjs`
automates the pipeline: search Commons for a query, batch-check licence
via `imageinfo` (up to 50 titles per request), download with a real
User-Agent, reject a suspicious response the same way `vendor-audio.mjs`
does, reject anything under 90 seconds by real `ffprobe` duration (the
exact defect class three hand-picked tracks shipped with before this
existed), and append survivors to the manifest.

```
node tools/source-radio.mjs --station old-concert-hall --query "brahms symphony" --limit 25
node tools/source-radio.mjs --station six-strings --query "classical guitar" --mood "warm, intimate" --limit 25 --dry-run
```

`--mood` tags every track the run adds with a loose free-text mood - not
inferred from the audio, just the curator's intent at source time (Dan's
example: Brahms' darker symphonic movements suit undead/dungeon zones).
Matching mood to a specific zone or biome is not built yet; the tag is
there so it can be later. `--dry-run` reports candidates without
downloading or writing, worth using before trusting an unfamiliar query.

**Quality bar, Dan's explicit instruction (28 Aug 2026): avoid "tribal"
music - typically low-quality demo/commercial-mixing-library material,
not real performances, and not competing with "great masters."** This is
why `source-radio.mjs` batches broad composer/genre searches ("brahms
symphony", "andalusian music") rather than narrow instrument searches
("oud solo") - the latter mostly surfaces short demo clips from sample
libraries, which is exactly what got three tracks pulled after shipping
too short. The Andalusian/Ottoman batch that filled out Arabic
representation in The Silk Road worked because it searched by tradition
and repertoire name, not by instrument.

## Roadmap: what's still open

Dan's direction (28 Aug 2026). **Done since it was written:** "hundreds of
songs" (233 as of this writing), "a good number of stations matched to
region types" (six,
each with a `characterFor()` reason — see "What's actually done"), and
"one hour playlists for each region... aware of more than just maps"
(all 85 zones, `tools/build-zone-playlists.mjs`). Still open:

- **Player-created custom stations.** Not built at all. The manifest
  schema (`radioStations` + a `station` tag per track) already supports
  an arbitrary number of stations, so the data model doesn't block this,
  but there is no UI for a player to build their own station from
  tracks, name it, or persist it. This is the next real feature, not a
  content-sourcing task.
- **Interior-level music matching, finer than zone.** "Places of
  interest in towns like building interiors" implies going below the
  85-zone granularity eventually (a temple or guild hall inside a town
  zone getting its own theme distinct from the zone's playlist), which
  the `place` field already carried in `src/data/map/*.json`'s room
  records could key off of, but nothing reads it for audio yet.
- **`characterFor()`'s heuristics are a first pass, not lore.** It reads
  zone names and biomes; it does not know what actually lives in a zone.
  Cross-referencing `src/data/hunting.ts`'s `HUNTING_GROUNDS` was tried
  and abandoned for now — its `area` field names regions ("Zoluren"), not
  specific zone ids, too loosely to map reliably. A better creature/zone
  data source, if one exists or gets built, would let a genuinely
  undead-heavy zone get Halls of Shadow regardless of what its name
  happens to say.
- **More stations as content allows.** Six is not a ceiling — a "Court
  and Ceremony" split from Throne and Temple, a lighter "Tavern and
  Hearth" folk station, or others Dan names are all just another
  `radioStations` entry plus a `tools/source-radio.mjs` run away.
- ~~The genuine pre-1900 Arabic gap.~~ **Filled, 28 Aug 2026.** Dan's
  clarification was pre-1960, not pre-1900 - the mid-20th-century Arabic
  golden age (Umm Kulthum/Abdel Wahab era), not medieval. Named-artist
  Commons searches came up empty (that era's actual commercial
  recordings are mostly still copyrighted), but Wikimedia's
  `Category:Music of Egypt` had six genuine historical recordings, all
  Public domain: five dated 1914-1931 (`Aldahre Kata Awsali`, two-part
  `Baschrav Kuzum Maqam Hijaz`, `Art-song Maqam Sika`, `Ala fi Sabil
  Allah`) plus one undated orchestral anthem. The Silk Road is now 35
  tracks with real period-authentic Arabic material anchoring it the way
  Grieg/Handel anchor their stations.
