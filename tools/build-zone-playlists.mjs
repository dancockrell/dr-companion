/**
 * Assign every zone a roughly-one-hour playlist, aware of more than the
 * zone's biome - Dan's ask (28 Aug 2026): "build one hour playlists for
 * each region or location in the game. try to be aware of more than just
 * maps... what is going on... but don't switch songs with every room
 * change."
 *
 * The "don't switch with every room change" half is already handled
 * structurally: `setZone()` in ambientSound.ts is a no-op unless the zone id
 * itself changes, and `ZoneMusicPlayer` only starts walking a playlist on a
 * genuine zone entry. This script is the other half - actually building the
 * playlists - and it reuses the radio stations' track pool rather than
 * needing separate zone-only files, the same way RadioPlayer and
 * ZoneMusicPlayer share one `music` slot in the engine.
 *
 * # "Aware of more than maps"
 *
 * Biome alone (`zone-biomes.json`) is geography. `characterFor()` below
 * layers on what a zone actually *is* by reading its name for specific
 * signals a biome tag misses - a thief-passage zone is not merely "town", a
 * named clan hold is not merely "wilderness", "Dirge" and "Sorrow's Reach"
 * are not neutral wherever they sit on the map. `src/data/hunting.ts`'s
 * `HUNTING_GROUNDS` was checked as a source of confirmed undead/creature
 * associations and turned out too loosely named (`area: 'Zoluren'` covers a
 * whole region, not a specific zone id) to cross-reference reliably at this
 * scale - not used here for that reason, stated so the next person doesn't
 * assume it was overlooked. This is still a heuristic, not lore ground
 * truth; `character` is recorded per zone in the manifest specifically so
 * it can be revised by a human who knows the zone rather than re-derived
 * from scratch.
 *
 * Usage:
 *   node tools/build-zone-playlists.mjs              assign all 85 zones
 *   node tools/build-zone-playlists.mjs --zone 1      assign one zone, for review
 *   node tools/build-zone-playlists.mjs --dry-run      report without writing
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'data/audio/manifest.json')
const zoneBiomesPath = join(root, 'data/audio/zone-biomes.json')
const durationsCachePath = join(root, 'data/audio/.track-durations-cache.json')
const publicAudio = join(root, 'public/audio')

const ONE_HOUR = 3600
const DRY_RUN = process.argv.includes('--dry-run')
const onlyZoneArg = (() => {
  const i = process.argv.indexOf('--zone')
  return i > 0 ? process.argv[i + 1] : null
})()

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const zoneBiomes = JSON.parse(readFileSync(zoneBiomesPath, 'utf8'))

function durationsCache() {
  if (existsSync(durationsCachePath)) {
    return JSON.parse(readFileSync(durationsCachePath, 'utf8'))
  }
  return {}
}

function ffprobeSeconds(path) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
      { encoding: 'utf8' }
    )
    const n = Number(out.trim())
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** Every track's duration, ffprobed once and cached to disk - 195 files is slow to re-probe every run. */
function buildDurations() {
  const cache = durationsCache()
  let changed = false
  for (const t of manifest.radio ?? []) {
    if (cache[t.id] != null) continue
    const path = join(publicAudio, t.file)
    if (!existsSync(path)) continue
    const seconds = ffprobeSeconds(path)
    if (seconds != null) {
      cache[t.id] = Math.round(seconds)
      changed = true
    }
  }
  if (changed && !DRY_RUN) writeFileSync(durationsCachePath, JSON.stringify(cache, null, 2) + '\n')
  return cache
}

const STATIONS = {}
for (const t of manifest.radio ?? []) {
  ;(STATIONS[t.station] ??= []).push(t.id)
}

/**
 * A zone's character: a station-weight mix plus a short human-readable
 * reason, from biome + zone-name reading. Not exhaustive lore - see this
 * file's header.
 */
function characterFor(zoneId, biomeEntry) {
  const name = (biomeEntry?.name ?? '').toLowerCase()
  const biome = biomeEntry?.biome ?? 'wilderness'

  // Named-pattern overrides first - specific beats general.
  if (/thief passage|escape tunnel|tunnels/.test(name)) {
    return { mix: { 'halls-of-shadow': 0.8, 'six-strings': 0.2 }, character: 'hidden passages beneath a town - furtive, not grand' }
  }
  if (/cavern of fire|abandoned mine|dirge|sorrow|barrow|lost ground/.test(name)) {
    return { mix: { 'halls-of-shadow': 1.0 }, character: 'named for loss or ruin - leans on the dark/dramatic station entirely' }
  }
  if (biome === 'dungeon' || biome === 'cave') {
    return { mix: { 'halls-of-shadow': 0.6, 'six-strings': 0.4 }, character: `${biome}, no other signal - mostly dark/dramatic with some intimate solo string` }
  }
  if (/wyvern arena/.test(name)) {
    return { mix: { 'halls-of-shadow': 0.7, 'throne-and-temple': 0.3 }, character: 'a blood-sport arena - dramatic with a grand/ceremonial edge' }
  }
  if (/clan\b|tribe/.test(name)) {
    return { mix: { 'halls-of-shadow': 0.5, 'old-concert-hall': 0.5 }, character: 'a beast-tribe hold - dramatic orchestral rather than literal tribal instrumentation (Dan: avoid low-quality "tribal" demo material)' }
  }
  if (biome === 'water' || /gondola|cove|sea caves|bay|isle/.test(name)) {
    // Salt and Sail and Silk Road were both killed 29 Aug 2026 (too thin to
    // hold a station, and mostly never-actually-reviewed bulk-adds - see
    // docs/AUDIO.md) - the handful of genuinely good shanty/working-folk
    // tracks Salt and Sail had moved into Six Strings rather than being
    // discarded, so coastal zones still get that character, just from the
    // station that now actually holds it.
    return { mix: { 'six-strings': 1.0 }, character: 'coastal/maritime - the shanty/working-folk material lives in Six Strings now' }
  }
  if (biome === 'road') {
    return { mix: { 'old-concert-hall': 0.5, 'six-strings': 0.5 }, character: 'a trade road - pastoral orchestral and solo string for travel' }
  }
  if (biome === 'town') {
    return { mix: { 'throne-and-temple': 0.5, 'old-concert-hall': 0.5 }, character: 'a real town - grand/ceremonial mixed with general orchestral' }
  }
  if (biome === 'settlement') {
    return { mix: { 'six-strings': 0.6, 'old-concert-hall': 0.4 }, character: 'a non-human settlement - intimate solo string with pastoral orchestral under it' }
  }
  if (biome === 'interior') {
    return { mix: { 'throne-and-temple': 0.6, 'six-strings': 0.4 }, character: 'a notable interior (manor/keep/guild) - grand with some intimacy' }
  }
  if (biome === 'badlands') {
    return { mix: { 'halls-of-shadow': 0.6, 'six-strings': 0.4 }, character: 'a canyon/barrow badland - dark with some working-folk texture' }
  }
  if (biome === 'liminal') {
    // Was Silk Road alone (killed 29 Aug 2026 - see docs/AUDIO.md); the
    // dark/dramatic station reads as "unmoored from any real geography"
    // about as well as anything left in the pool does.
    return { mix: { 'halls-of-shadow': 0.7, 'old-concert-hall': 0.3 }, character: 'a liminal/otherworldly space (Transports, Microcosm) - dark and unmoored from any real geography' }
  }
  if (biome === 'forest') {
    return { mix: { 'six-strings': 0.6, 'old-concert-hall': 0.4 }, character: 'forest - intimate solo string leading, pastoral orchestral under it' }
  }
  // wilderness fallback, the largest bucket
  return { mix: { 'old-concert-hall': 0.6, 'six-strings': 0.4 }, character: 'open wilderness, no stronger signal - a broad mix' }
}

function weightedTrackPool(mix) {
  const pool = []
  for (const [stationId, weight] of Object.entries(mix)) {
    const tracks = STATIONS[stationId] ?? []
    // Repeat each id proportional to weight*10 so weighted random pick is a
    // plain array sample - simple, and fine at this scale (a few hundred
    // entries at most per zone's pool).
    const copies = Math.max(1, Math.round(weight * 10))
    for (let i = 0; i < copies; i++) pool.push(...tracks)
  }
  return pool
}

function pickHourFrom(pool, durations, targetSeconds = ONE_HOUR) {
  const chosen = []
  const used = new Set()
  let total = 0
  const shuffledPool = pool
    .slice()
    .sort(() => Math.random() - 0.5)

  let i = 0
  // Avoid an immediate repeat of the same track when the pool is small - not
  // a hard uniqueness constraint (an hour can need more tracks than a thin
  // station has), just spacing.
  while (total < targetSeconds && i < shuffledPool.length * 3) {
    const id = shuffledPool[i % shuffledPool.length]
    i++
    const dur = durations[id]
    if (!dur) continue
    if (chosen.length && chosen[chosen.length - 1] === id) continue
    chosen.push(id)
    used.add(id)
    total += dur
  }
  return { tracks: chosen, totalSeconds: total }
}

function main() {
  const durations = buildDurations()
  const targets = onlyZoneArg ? [onlyZoneArg] : Object.keys(zoneBiomes)

  let assigned = 0
  for (const zoneId of targets) {
    const biomeEntry = zoneBiomes[zoneId]
    if (!biomeEntry) {
      console.log(`SKIP ${zoneId} - not in zone-biomes.json`)
      continue
    }
    const { mix, character } = characterFor(zoneId, biomeEntry)
    const pool = weightedTrackPool(mix)
    if (!pool.length) {
      console.log(`SKIP ${biomeEntry.name} (${zoneId}) - no tracks available for its station mix`)
      continue
    }
    const { tracks, totalSeconds } = pickHourFrom(pool, durations)
    if (!tracks.length) {
      console.log(`SKIP ${biomeEntry.name} (${zoneId}) - no durations known yet, run vendor-audio.mjs first`)
      continue
    }

    manifest.zone[zoneId] = { tracks, character }
    assigned++
    console.log(
      `${biomeEntry.name.padEnd(40)} ${zoneId.padEnd(6)} ${tracks.length} tracks, ${(totalSeconds / 60).toFixed(0)}min - ${character}`
    )
  }

  console.log(`\n${assigned} zone playlist(s) ${DRY_RUN ? 'would be' : ''} assigned`)
  if (!DRY_RUN) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`manifest.json updated`)
  }
}

main()
