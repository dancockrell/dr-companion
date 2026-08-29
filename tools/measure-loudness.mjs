/**
 * Measures each radio track's loudness and writes a per-track `gainDb` into
 * `data/audio/manifest.json`, so playback can correct for it - see
 * ambientSound.ts's `trackGain` for where it's applied.
 *
 * # Why this exists
 *
 * The alert WAVs got exactly this treatment on 28 Aug 2026 (measured with
 * `ffmpeg -af volumedetect`, all six pegged at max_volume -0.0 dB, cut to -8
 * dB peak) and the radio/zone pool never did, despite being sourced from a
 * dozen-plus different uploaders across Wikimedia and OpenGameArt with no
 * consistent mastering between them. A real sample confirms it's not a
 * theoretical problem: fifteen random tracks measured -15.8 dB to -41.4 dB
 * mean volume - a 25+ dB spread, meaning the quietest track in that sample
 * is roughly a nineteenth the perceived loudness of the loudest at the same
 * slider position. A listener would either miss quiet tracks entirely or
 * get startled by loud ones every time the station advances.
 *
 * # Method
 *
 * `ffmpeg -t 30 ... volumedetect` rather than a full loudnorm two-pass -
 * fast (under 0.1s per file, so the whole 233-track pool takes well under a
 * minute) and a 30-second sample of mean volume is precise enough for what
 * this is actually for: correcting a 25 dB spread down to something a
 * listener doesn't have to keep reaching for the slider over, not mastering
 * to a broadcast spec. `-t 30` from the start of the file, not a random
 * window - simpler, deterministic, and every track here is a real
 * performance rather than something that fades in from silence.
 *
 * `gainDb` is `TARGET_MEAN_DB - measured`, clamped to +-9 dB
 * (`MAX_ADJUST_DB`) so one badly-mastered outlier - the -41.4 dB sample
 * above would ask for +25 dB, which would mostly amplify noise floor and
 * compression artifacts rather than the music - gets pulled toward the pack
 * rather than blown out trying to fully match it. `ambientSound.ts`'s Layer
 * additionally clamps the final applied volume to 1.0 regardless, the same
 * honest-ceiling pattern `alertSound.ts` already uses for alerts past 100%.
 *
 * Run after adding radio tracks (source-radio.mjs, vendor-audio.mjs) so new
 * ones get measured too: `node tools/measure-loudness.mjs`. `--dry-run`
 * reports without writing. Silently skips (and reports) any track whose
 * file isn't present locally - `public/audio/` is gitignored, so a track
 * added on another machine won't be measurable here until vendored.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifestPath = path.join(root, 'data/audio/manifest.json')
const audioDir = path.join(root, 'public/audio')

const TARGET_MEAN_DB = -20
const MAX_ADJUST_DB = 9
const dryRun = process.argv.includes('--dry-run')

function measureMeanDb(filePath) {
  // ffmpeg writes volumedetect's report to stderr, not stdout, and exits 0
  // on a clean decode. execFileSync only ever returns stdout, even with a
  // 'pipe' stdio entry for fd 2 - the first version of this used it and
  // silently measured nothing on all 233 tracks, which is exactly the "a
  // check that cannot fail is not a check" shape: no thrown error, no
  // non-zero exit, just an empty result read as "no tracks yet." spawnSync
  // exposes stderr on its result object directly.
  const res = spawnSync(
    'ffmpeg',
    ['-t', '30', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' }
  )
  if (res.error) throw res.error
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(res.stderr ?? '')
  return m ? Number(m[1]) : null
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const radio = manifest.radio ?? []

let measured = 0
let missing = 0
let clamped = 0
const results = []

for (const track of radio) {
  const filePath = path.join(audioDir, track.file)
  if (!existsSync(filePath)) {
    missing++
    continue
  }
  let meanDb
  try {
    meanDb = measureMeanDb(filePath)
  } catch (e) {
    console.log(`SKIP ${track.id} - ffmpeg failed: ${e.message.split('\n')[0]}`)
    continue
  }
  if (meanDb === null) {
    console.log(`SKIP ${track.id} - no mean_volume in ffmpeg output (silent or unreadable file?)`)
    continue
  }

  const raw = TARGET_MEAN_DB - meanDb
  const gainDb = Math.max(-MAX_ADJUST_DB, Math.min(MAX_ADJUST_DB, raw))
  if (raw !== gainDb) clamped++

  track.gainDb = Math.round(gainDb * 10) / 10
  measured++
  results.push({ id: track.id, meanDb, gainDb: track.gainDb, clamped: raw !== gainDb })
}

results.sort((a, b) => a.meanDb - b.meanDb)
console.log(`\nquietest 5 (largest boost):`)
for (const r of results.slice(0, 5)) {
  console.log(`  ${r.id.padEnd(40)} measured ${r.meanDb.toFixed(1)} dB -> gain ${r.gainDb > 0 ? '+' : ''}${r.gainDb} dB${r.clamped ? ' (clamped)' : ''}`)
}
console.log(`loudest 5 (largest cut):`)
for (const r of results.slice(-5)) {
  console.log(`  ${r.id.padEnd(40)} measured ${r.meanDb.toFixed(1)} dB -> gain ${r.gainDb > 0 ? '+' : ''}${r.gainDb} dB${r.clamped ? ' (clamped)' : ''}`)
}

console.log(`\n${measured} measured, ${missing} not present locally (skipped), ${clamped} hit the +-${MAX_ADJUST_DB} dB clamp`)

if (dryRun) {
  console.log('\n--dry-run: manifest.json not written')
} else {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\nwrote gainDb for ${measured} tracks to ${path.relative(root, manifestPath)}`)
}
