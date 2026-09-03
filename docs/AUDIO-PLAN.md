# Audio: ship small, make bring-your-own excellent

Decided 3 Sep 2026. Supersedes the "replace the library" plan from earlier the
same day, which was aimed at the wrong problem.

## The steer

> "It's going to be good if we go with the big names. To be honest, people are
> most likely to put in their own tracks or radio if we make that really easy."
> — Dan

The bundled library's job is to **sound good on first launch and then get
replaced.** Effort goes into bring-your-own, not into curation.

## What is actually there today (measured, not assumed)

Checked before planning, because the last two rounds of this both found the
work already half-done.

| | Status |
|---|---|
| Transport (play/pause/next/prev) | **Built** — `MusicTransport.tsx` |
| Seekable scrub bar | **Built** — long, labelled, guards a missing duration |
| Favourite stations, surviving restart | **Built** — `favorites.ts`, persisted as `favoriteStations` |
| Hand-picked playlists | **Built** — `playlists.ts` |
| Per-track loudness correction | **Built** — `measure-loudness.mjs` → `gainDb` |
| Per-file licence record + attribution generator + verification test | **Built** — good, keep |
| Radio | **Static list.** `RADIO_STATIONS` is a literal in `ambientSound.ts` |
| Local music folder | **Not built at all.** Nothing scans a user library |

`sounds.rs` does scan directories, but for *alert* sound effects in Genie
`Sounds` folders — single-level `read_dir`, three extensions, feeding a
highlight picker. It is not a music library scanner and should not be grown
into one; the requirements are different in every respect that matters.

**So the controls Dan asked for largely exist.** The two real gaps are the
local library and the radio directory.

## Naming: "channel" is already taken, twice

The organising concept is right. The *word* is a hazard here, and this codebase
has already paid for it once.

`src/lib/chatChannels.ts` uses `CHANNELS` for the companion's own log tabs, and
`streamLabels.ts` records what happened when that vocabulary was rendered
beside the game's own stream labels:

> Speech  Thoughts  |  All  Speech  Combat  Game  Companion
>
> two tabs, the same word, different content, one thin pipe apart.

Adding a third "channel" vocabulary for music invites exactly that again, in a
UI where the music switcher and the stream tabs can plausibly share a row.

**Decided: the user-facing noun is "station".** A composer station, a mood
station, a local-folder station and a radio station are all the same kind of
thing. It is also the lower-churn choice: `favorites.ts` already stars
stations, and persistence already carries `favoriteStations`, so unifying
around it is mostly wiring rather than a rename.

"Channel" stays where it already means something — game text streams.

## One concept: the station

A station is *a named, ordered source of audio you can switch to*. That is the
whole abstraction, and everything is one:

| Station kind | Source |
|---|---|
| Composer | bundled tracks filtered by composer |
| Mood | bundled tracks curated across composers |
| Local | a folder the user pointed at, or a subset of it |
| Radio | a radio-browser stream |

The switcher, the transport, the favourite button, the volume model and the
"now playing" display take a station and do not care which kind it is. That is
what stops the switcher being three browsers wearing one hat.

The kind-specific differences are few and each is handled explicitly rather
than by branching everywhere:

- A radio station has no duration, so it cannot be scrubbed — the UI says
  **live** rather than showing a dead control.
- A local station's contents can change under it; bundled and radio cannot.
- Only bundled tracks carry a licence record. Local files are the user's own
  business, and radio is a link rather than a file.

## The payload problem

`public/audio/radio` is **4.4 GB** on disk for ~176 files.

The good news, and it is genuinely different from the art situation: **audio is
not in git.** Only 4 files under `data/audio` and `public/audio` are tracked;
the rest is gitignored and fetched by `vendor-audio.mjs`. So there is no
history to rewrite and no clone to shrink — this is purely a *first-run
download* problem.

It is still the same problem in a different costume. Shipping 167 MB of art was
one version of it; a multi-gigabyte audio fetch on first launch directly
contradicts "super easy to download and start".

**Target: roughly ten hours** — a real library, not a sampler. Enough per
composer that a composer station holds up on its own, plus mood stations
cutting across them. Radio covers everything beyond that.

### Sizing, and why it is tiered rather than compromised

Ten hours of Opus:

| Bitrate | ~Size |
|---|---|
| 96 kbps | ≈ 420 MB |
| 112 kbps | ≈ 490 MB |

That is fine as a music library and bad as the thing standing between someone
and a working client on first launch. So **do not compromise the bitrate to fix
an install-time problem** — tier the download instead:

- **Starter set**, shipped or fetched on install: roughly 45–60 minutes, a
  handful of pieces across two or three composers. Tens of megabytes.
- **Full library**, fetched in the background or on request, with progress the
  user can see and cancel.

`vendor-audio.mjs` already fetches rather than commits, so the mechanism
exists; this is a manifest split and a fetch trigger, not new infrastructure.

**Encoding floor: Opus 96–112 kbps. Do not go below.** Classical has wide
dynamic range and long quiet passages where low-bitrate artefacts are audible
in a way they are not in dense modern music — a solo piano decay is exactly
where a codec running out of bits announces itself. The saving from 64 kbps is
about 140 MB across the whole library and it is not worth what it does to the
thing people will actually notice.

## The plan

### 1. Build the bundled library — ten hours, by station

A station per composer — Bach, Beethoven, Brahms, Mozart, Tchaikovsky, and
anyone else who clears the bar — each with enough tracks to hold up on its own,
plus mood stations curated across composers.

Chosen for background listening: things that reward being half-heard, loop
without fatigue, and do not lunge at you mid-combat. A brilliant recording of
something bombastic is the wrong choice here even when it is free and clean.

**Curation beats volume, and the quality bar does not bend to fill a station.**
Ten hours of well-chosen recordings beats ten hours of everything that could
legally be found. If a composer cannot be filled at the Open Goldberg standard
— a deliberate professional open release, not a legally-clean amateur upload —
**the honest move is to report the shortfall and ship a smaller station**, not
to pad it with a noisy 78rpm transfer. A thin Brahms station is a known gap
somebody can later fill; a padded one is a quality problem nobody notices until
a listener does.

Verified starting point: the **Open Goldberg Variations** and the same
project's **Well-Tempered Clavier** (Kimiko Ishizaka, Bösendorfer 290, Teldex
Studio Berlin) are **CC0** and professionally produced. That is the standard —
a deliberate open release by a professional, not a legally-clean amateur
upload. **Musopen**'s explicit Public Domain filter is the source for the
orchestral repertoire, with per-file verification because Musopen itself does
not guarantee user uploads.

Known gap: CC0 *recordings* of Spanish guitar are scarce, although the
repertoire (Tárrega, Albéniz, Granados, Sor) is unambiguously public domain.
Do not fill this with something worse to hit a genre target.

Licensing consequence, and it survives the library getting larger: the win was
never the file *count*, it is the licence *class*. A CC0/public-domain-only
library needs no attribution list at any size, so the README says **one
confident sentence** whether that is ten tracks or ten hours. The 65 share-alike
tracks were the problem; the number 182 never was.

### 2. Local library — the actual feature

Point it at a folder. That is the entire user-facing design.

- **Recursive scan**, not one level. Real libraries are nested by
  artist/album.
- **Common formats**: mp3, flac, ogg, opus, m4a/aac, wav.
- **Tags read from the files** (ID3, Vorbis comments, MP4 atoms). Fall back to
  the filename when tags are absent, which for a lot of libraries is most of
  them. Never require the user to fix their metadata.
- **No import step, no conversion, no playlist format to learn.** The folder is
  the library.
- **Tens of thousands of files without freezing.** This is the requirement that
  dictates the architecture: scan on a background thread in Rust, stream
  results to the UI incrementally, persist an index so the second launch is
  instant, and re-validate lazily rather than re-scanning on every start. A
  synchronous scan of a 40,000-file library is a frozen window, and it is the
  single most likely way this feature ships broken.
- **Watch for changes** where cheap; otherwise a manual rescan that is honest
  about what it is doing.

Acceptance: *someone with a music folder is listening to it within a minute of
installing, having read nothing.*

### 3. Radio — a directory, not a list

Replace the static `RADIO_STATIONS` literal with **radio-browser**, keeping the
current list as seeded defaults so a first launch is not an empty search box.

- Search by name, browse by genre/tag, by country and by language.
- Favourite a station; favourites already persist, so this is wiring rather
  than new storage.
- **Send a descriptive `User-Agent` of the form `appname/appversion`** from the
  first request. It is a documented requirement of the API, it is free to do
  now, and it is rude to discover later.
- Terms verified: radio-browser's station *data* is explicitly public domain
  and reusable in free and non-free software. Only the server software is
  AGPL, which does not reach an API consumer. **We do not bundle a curated
  station list from anyone else.**
- Make it feel like a radio, not a database query: recently played, one-tap
  favourite, a station that fails to stream reports *why* rather than sitting
  silent.

### 4. One switcher over all stations

Bundled, local and radio are **peers** — see "One concept: the station" above.
The transport, the scrub bar, the volume model and the switcher take a station
and do not care which kind it is. Nothing privileges the shipped set.

Practically, the switcher shows composer stations, mood stations, the user's
local folders and their favourite radio stations in one list, grouped by kind
but browsed the same way. Someone who never touches the bundled library should
find their own music exactly where the shipped stations were.

## 5. Music is optional at every stage, and the lightweight path is first-class

> "don't make it a pita for people who just want to use this as a lightweight
> modern mud client" — Dan

The person who wants a fast modern MUD client and no music is **not** a degraded
user of the music feature. They are a first-class configuration, and the test
of the design is that they can forget music exists.

### Three moments, three plain choices

1. **In the box.** A few good tracks ship, so the app is not silent on first
   launch for anyone.
2. **The download button.** One button gets the rest. No wizard, no account, no
   explanation required, no interstitial arguing for it.
3. **The install toggle.** Offered once, and **declining is a normal choice
   rendered as a normal choice** — not a warning, not a dimmed "are you sure",
   no consequence copy.

### Removal is a feature, not an uninstall path

One action. Then:

- **The disk space actually comes back.** Including any partial download, any
  fetch cache, and any derived index. A removal that frees the audio but leaves
  a 400 MB cache is a bug, and it is the kind nobody notices because the
  feature *appears* to have worked.
- **No dead stations in the switcher.** See below — this is the one part with a
  real architectural consequence.
- **No errors.** Not on removal, not on the next launch, not when something
  still holds a reference to a track that is gone.
- **No re-prompting, ever.** The decision persists and is respected across
  updates. Asking a second time is the exact "pita" being designed out.

### The architectural consequence: stations are derived, never declared

**The station list must be computed from what is actually present, not read
from a manifest that assumes it.**

If stations come from a static list, removing the pack leaves entries that
select into silence or an error — the switcher confidently offering things that
are not there. That is the same defect as a declared-but-absent vital reading
as a real value, and the same answer applies: *absence is renderable,
wrongness is not.*

So: the manifest describes what a station **would** contain; the switcher shows
a station only when its tracks resolve. With the pack removed, composer and
mood stations are simply not in the list, and nothing anywhere needs to know
that music was ever installed. Local folders and radio are unaffected, because
they were never tied to the pack.

The corollary is that the bundled pack cannot be load-bearing for anything
else. No default station that must exist, no startup path that assumes a track,
no setting whose valid range depends on the pack being present.

### Test the lightweight path as a real configuration

Assumed-to-work is how this ships broken. Three configurations, each exercised
rather than reasoned about:

| Configuration | Must be true |
|---|---|
| Installed with music **declined** | App starts, plays the in-box tracks or nothing, switcher shows no missing stations, no prompt to reconsider |
| Music **downloaded**, then **removed** | Disk reclaimed including caches and index; switcher clean; no errors on removal or next launch; not asked again |
| Music **never downloaded**, app **updated** | Still not asked; no pack fetched implicitly by the updater |

The second row is the one most likely to be wrong, because it is the only one
that exercises teardown, and teardown is the path nobody runs twice.

Worth noting these are mechanically testable without a human: station-list
derivation against an empty pack directory is a unit test, and the reclaim
check is a size assertion before and after. The lightweight path should be in
the suite, not in a checklist somebody remembers.

## What stays

The manifest, the attribution generator and the verification test are good and
are kept unchanged. They simply govern ten files instead of 182.

The loudness machinery stays too, and matters more now, not less: a bundled
set, a user's own library and a radio stream will have wildly different
mastering, and per-source gain is what stops the player riding the volume knob
between them. Worth upgrading from `volumedetect` mean volume to EBU R128
integrated LUFS plus true peak — one `ffmpeg loudnorm` pass — so the same
machinery can *reject* a bad bundled track as well as correct a quiet one.
