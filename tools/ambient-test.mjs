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
import manifest from '../data/audio/manifest.json' with { type: 'json' }
import { RADIO_STATIONS } from '../src/lib/ambientSound.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${detail}`)
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

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
