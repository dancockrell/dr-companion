/**
 * The ambient soundscape's data logic, without a browser.
 *
 * `ambientSound.ts` imports `Audio`/`HTMLAudioElement`, which do not exist
 * in plain Node - but nothing at module load time calls `new Audio()`, only
 * `play()` does, and nothing here calls `play()`. So the module-level data
 * (station grouping, the biome table, the fallback) and the pure `shuffled`
 * helper are reachable and testable directly, the same way `trail-test.mjs`
 * and `flow-test.mjs` import other `.ts` sources straight into Node.
 *
 * What this does NOT prove: that a track actually plays, that a missing
 * file degrades to silence rather than an error, or that RadioPlayer
 * advances on a real `ended` event. Those need a real `<audio>` element and
 * were verified against the running app by measuring `Audio.play()` calls -
 * see the commit that added the alert-sound fix for why that discipline
 * matters, and data/audio/manifest.json's per-track `note` fields for the
 * two files (Ogg-FLAC, Ogg Skeleton) still owed that check.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import manifest from '../data/audio/manifest.json' with { type: 'json' }
import { RADIO_STATIONS } from '../src/lib/ambientSound.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const publicAudio = join(root, 'public/audio')

let failed = 0
const unchecked = []
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${detail}`)
}
const skip = (name, why) => {
  unchecked.push(name)
  console.log(`SKIP ${name.padEnd(50)}${why}`)
}

console.log('-- every station the manifest names actually groups --')
{
  const manifestStationIds = new Set((manifest.radio ?? []).map((t) => t.station))
  const builtStationIds = new Set(RADIO_STATIONS.map((s) => s.id))
  ok(
    'there are stations at all',
    RADIO_STATIONS.length > 0,
    `${RADIO_STATIONS.length} stations`
  )
  ok(
    'every station referenced by a track was built',
    [...manifestStationIds].every((id) => builtStationIds.has(id)),
    [...manifestStationIds].filter((id) => !builtStationIds.has(id)).join(', ')
  )
  ok(
    'every track landed in exactly one station',
    (manifest.radio ?? []).length === RADIO_STATIONS.reduce((n, s) => n + s.tracks.length, 0),
    `${(manifest.radio ?? []).length} tracks in manifest, ${RADIO_STATIONS.reduce((n, s) => n + s.tracks.length, 0)} across stations`
  )
}

console.log('\n-- no station is a one-song jukebox --')
{
  // The whole point of "station, not track" is a playlist that loops without
  // repeating the same file every cycle. One track technically loops, but it
  // is indistinguishable from the old per-track model this replaced.
  const thin = RADIO_STATIONS.filter((s) => s.tracks.length < 2)
  ok('every station has at least two tracks', thin.length === 0, thin.map((s) => s.id).join(', '))
}

console.log('\n-- every track names a station that exists in radioStations --')
{
  const known = new Set(Object.keys(manifest.radioStations ?? {}))
  const orphans = (manifest.radio ?? []).filter((t) => !known.has(t.station))
  ok(
    'no track points at an undeclared station',
    orphans.length === 0,
    orphans.map((t) => `${t.id}->${t.station}`).join(', ')
  )
}

console.log('\n-- every manifest entry the vendor script would fetch has what it needs --')
{
  const allEntries = [
    ...Object.entries(manifest.biome ?? {}).map(([k, v]) => ({ key: `biome/${k}`, ...v })),
    ...(manifest.radio ?? []).map((t) => ({ key: `radio/${t.id}`, ...t })),
  ]
  const missingFile = allEntries.filter((e) => !e.file)
  const missingDownload = allEntries.filter((e) => !e.download)
  const missingLicense = allEntries.filter((e) => !e.license)
  ok('there are entries to check', allEntries.length > 0, `${allEntries.length} entries`)
  ok('every entry names a file', missingFile.length === 0, missingFile.map((e) => e.key).join(', '))
  ok(
    'every entry names a download source',
    missingDownload.length === 0,
    missingDownload.map((e) => e.key).join(', ')
  )
  ok(
    'every entry records a licence',
    missingLicense.length === 0,
    missingLicense.map((e) => e.key).join(', ')
  )
  // Attribution isn't optional bookkeeping for a CC-BY/CC-BY-SA file - it's
  // the term of the licence. A file that requires it and doesn't carry the
  // text would ship silently non-compliant.
  const needsTextButLacksIt = allEntries.filter((e) => e.attributionRequired && !e.attributionText)
  ok(
    'every attribution-required entry carries its attribution text',
    needsTextButLacksIt.length === 0,
    needsTextButLacksIt.map((e) => e.key).join(', ')
  )
}

console.log('\n-- radio tracks are songs, not short loops --')
{
  // Only radio tracks are checked here - a biome ambient bed is *supposed*
  // to be a short seamless loop, the opposite property. Dan's correction,
  // after three radio tracks turned out to be 49s/63s/70s demo clips
  // wearing a song's metadata. ffprobe reads the real duration rather than
  // trusting the file size, which the earlier size-based "suspicious
  // response" guard in vendor-audio.mjs would not have caught - these were
  // genuine, complete downloads of genuinely short files.
  const MIN_MUSIC_SECONDS = 90

  let ffprobeOk = true
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
  } catch {
    ffprobeOk = false
  }

  if (!ffprobeOk) {
    skip('every radio track is at least 90 seconds', 'ffprobe not on PATH')
  } else {
    const short = []
    const missing = []
    for (const t of manifest.radio ?? []) {
      const path = join(publicAudio, t.file)
      if (!existsSync(path)) {
        missing.push(t.id)
        continue
      }
      const out = execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
        { encoding: 'utf8' }
      )
      const seconds = Number(out.trim())
      if (!Number.isFinite(seconds) || seconds < MIN_MUSIC_SECONDS) {
        short.push(`${t.id} (${Number.isFinite(seconds) ? seconds.toFixed(0) + 's' : 'unreadable'})`)
      }
    }
    if (missing.length) {
      skip(
        'every radio track is at least 90 seconds',
        `${missing.length} not fetched yet - run tools/vendor-audio.mjs first: ${missing.join(', ')}`
      )
    } else {
      ok(`every radio track is at least ${MIN_MUSIC_SECONDS} seconds`, short.length === 0, short.join(', '))
    }
  }
}

console.log('\n-- zone playlists reference real tracks and run roughly an hour --')
{
  const zoneEntries = Object.entries(manifest.zone ?? {})
  if (!zoneEntries.length) {
    skip('zone playlists exist', 'manifest.zone is empty - tools/build-zone-playlists.mjs has not run')
  } else {
    const knownTrackIds = new Set((manifest.radio ?? []).map((t) => t.id))
    const unknownRefs = []
    const empty = []
    for (const [zoneId, z] of zoneEntries) {
      if (!z.tracks || !z.tracks.length) {
        empty.push(zoneId)
        continue
      }
      for (const id of z.tracks) {
        if (!knownTrackIds.has(id)) unknownRefs.push(`${zoneId}:${id}`)
      }
    }
    ok('there are zone playlists to check', zoneEntries.length > 0, `${zoneEntries.length} zones`)
    ok('no zone playlist is empty', empty.length === 0, empty.join(', '))
    ok(
      'every zone playlist track id exists in the radio pool',
      unknownRefs.length === 0,
      unknownRefs.slice(0, 5).join(', ') + (unknownRefs.length > 5 ? ` (+${unknownRefs.length - 5} more)` : '')
    )

    // Duration check reuses the cache tools/build-zone-playlists.mjs writes,
    // rather than re-running ffprobe on hundreds of files here - a stale or
    // absent cache means "not checked", not a failure, since the cache is a
    // build artifact and its absence doesn't mean the playlists are wrong.
    const cachePath = join(root, 'data/audio/.track-durations-cache.json')
    if (!existsSync(cachePath)) {
      skip(
        'zone playlists run roughly an hour',
        'no duration cache - run tools/build-zone-playlists.mjs to generate it'
      )
    } else {
      const durations = JSON.parse(readFileSync(cachePath, 'utf8'))
      const MIN_ZONE_MINUTES = 45
      const short = []
      for (const [zoneId, z] of zoneEntries) {
        const total = (z.tracks ?? []).reduce((n, id) => n + (durations[id] ?? 0), 0)
        if (total < MIN_ZONE_MINUTES * 60) short.push(`${zoneId} (${(total / 60).toFixed(0)}min)`)
      }
      ok(
        `every zone playlist is at least ${MIN_ZONE_MINUTES} minutes`,
        short.length === 0,
        short.slice(0, 5).join(', ') + (short.length > 5 ? ` (+${short.length - 5} more)` : '')
      )
    }
  }
}

console.log(
  failed
    ? `\n${failed} failed`
    : unchecked.length
      ? `\nno failures, but ${unchecked.length} not checked: ${unchecked.join(', ')}`
      : '\nall passed'
)
process.exit(failed ? 1 : 0)
