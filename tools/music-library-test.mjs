/**
 * The music library is an install, and the "not installed" state is the place
 * that offers it.
 *
 * #383 established that no installer this project has ever produced carried a
 * single track: `public/audio/` is gitignored and pulled by
 * `tools/vendor-audio.mjs`, which nothing in `npm run build`,
 * `npm run tauri:build` or `release.yml` runs. PR #389 made that honest - one
 * `Music not installed` state, no track name, no Retry that could not work -
 * and left it a dead end, because there was nothing a listener could press.
 *
 * The library measures 4.36 GB across 182 files (measured by fetching all of
 * them and weighing what landed; the per-entry `bytes` in the manifest is that
 * measurement), against a 211 MB installer. So it is a download the player
 * asks for, the way docs/SETUP-POLICY.md has the setup wizard ask for Ruby and
 * Lich.
 *
 * The properties below, stated as properties rather than as the mechanism
 * that implements them today:
 *
 *   1. Every track the app would install is pinned. A manifest entry with no
 *      sha256 is not something to download unverified.
 *   2. One resolver. A track's URL is the bundled path when the build has the
 *      files and the installed copy when it does not, decided in one place, so
 *      the two locations cannot drift.
 *   3. A completed install makes the library present: the same zone playlist
 *      that reported `Music not installed` plays.
 *   4. The unavailable state offers only installs, never a Retry that could not
 *      work. It used to offer exactly one action, the whole 4.36 GB library;
 *      since #397 it offers the group that could not play *and* the whole
 *      library, so this property is now "every action here is an install"
 *      rather than a count of one. Said out loud, because editing a test so
 *      your own change passes is indistinguishable from that unless you name
 *      it: the property got wider on purpose, and the thing it was actually
 *      guarding - no dead Retry beside a missing library - is asserted exactly
 *      as tightly as before.
 *   5. Nothing is fetched before the click - the install has one call site and
 *      it is a click handler.
 *   6. The groups partition the library: every track is in exactly one group,
 *      the group sizes sum to the whole, and a track in zero groups or in two
 *      is a failure. This is the denominator that makes the rest mean
 *      anything.
 *   7. Presence is per group. An installed group plays while the others are
 *      absent, and a group half-installed reports partial with the exact count
 *      still missing rather than rounding to installed or to absent.
 *   8. The install offered is the group of the music that could not play, not
 *      the whole library - checked with the four wrong answers installed and
 *      available to be chosen by mistake.
 *
 * The Rust half - the sha256 verifier refusing a mismatched body and naming
 * the file, the allowlist, and a track path that cannot escape the audio
 * directory - is in `src-tauri/src/music.rs`'s own tests, where the real
 * `download_verified` can be driven against a local server.
 */
import { readFileSync } from 'node:fs'

/** Same stand-in the first-run suite uses, and a second small copy for the
 * same reason it gives: that file's mock is driven by its own module-level
 * `behavior`, and two suites sharing one would fight over it. */
class MockAudio extends EventTarget {
  static behavior = 'resolve'
  static instances = []
  /**
   * Every URL any element was ever pointed at.
   *
   * Counting *elements* is not the same question and is weaker in the exact
   * direction that matters: `Layer` reuses one element across tracks, so a
   * check on `instances.length` stays at zero while the layer happily loads a
   * track that is not there. Found by sabotaging the skip and watching two
   * checks that should have gone red stay green.
   */
  static sources = []

  constructor(src) {
    super()
    this.src = src
    this.dataset = {}
    this.volume = 0
    this.currentTime = 0
    this.duration = 180
    this.loop = false
    this.paused = true
    this.error = null
    MockAudio.instances.push(this)
  }

  set src(value) {
    this.currentSrc = value
    if (value) MockAudio.sources.push(value)
  }

  get src() {
    return this.currentSrc
  }

  play() {
    this.paused = false
    if (MockAudio.behavior === 'media-error') {
      queueMicrotask(() => {
        this.error = { code: 4 }
        this.dispatchEvent(new Event('error'))
      })
      return Promise.resolve()
    }
    queueMicrotask(() => this.dispatchEvent(new Event('playing')))
    return Promise.resolve()
  }

  pause() {
    this.paused = true
  }
}

globalThis.Audio = MockAudio
globalThis.HTMLAudioElement = MockAudio

const RESPONSES = {
  audio: { ok: true, headers: new Map([['content-type', 'audio/flac']]) },
  html: { ok: true, headers: new Map([['content-type', 'text/html; charset=utf-8']]) },
}
let fetchMode = 'html'
const fetchCalls = []
globalThis.fetch = (url, init) => {
  fetchCalls.push({ url, init })
  const r = RESPONSES[fetchMode]
  return Promise.resolve({ ok: r.ok, headers: { get: (k) => r.headers.get(k) ?? null } })
}

console.warn = () => {}

const manifest = (await import('../data/audio/manifest.json', { with: { type: 'json' } })).default

const {
  AMBIENCE_GROUP_ID,
  MUSIC_GROUPS,
  MUSIC_TRACKS,
  MUSIC_LIBRARY_BYTES,
  audioUrl,
  formatLibrarySize,
  groupIdForFile,
  isLibraryUrl,
  musicGroup,
  musicLibraryStatus,
  resetInstalledMusicBase,
  setInstalledMusicBase,
  setInstalledMusicFiles,
  trackPresence,
} = await import('../src/lib/musicLibrary.ts')

const {
  nowPlaying,
  resetMusicLibraryVerdict,
  setMusicStarted,
  setMusicVolume,
  setZone,
  stopMusic,
} = await import('../src/lib/ambientSound.ts')

let failed = 0
let checked = 0
const check = (name, condition, detail = '') => {
  checked++
  if (!condition) failed++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name.padEnd(66)}${detail}`)
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Every manifest entry that names a file - the definition of "the library",
 * read from the data rather than from a number written here, so a manifest
 * that shrinks fails loudly instead of turning the counts below into
 * assertions about nothing. */
const FILE_ENTRIES = [
  ...Object.values(manifest.biome ?? {}),
  ...Object.values(manifest.zone ?? {}),
  ...(manifest.radio ?? []),
].filter((e) => e.file)

console.log('\n-- 1. every track the app would install is pinned --')
{
  // A floor well under the real count, so a truncated or empty manifest is a
  // failure rather than a pass over nothing.
  check(
    'the manifest still names a whole library',
    FILE_ENTRIES.length >= 150,
    `${FILE_ENTRIES.length} entries`
  )
  const unpinned = FILE_ENTRIES.filter(
    (e) => typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)
  )
  check(
    'every entry carries a sha256',
    unpinned.length === 0,
    unpinned
      .slice(0, 3)
      .map((e) => e.file)
      .join(', ')
  )
  const unsized = FILE_ENTRIES.filter((e) => !(typeof e.bytes === 'number' && e.bytes > 0))
  check(
    'every entry carries a measured size',
    unsized.length === 0,
    unsized
      .slice(0, 3)
      .map((e) => e.file)
      .join(', ')
  )
  // The frontend drops an unpinned entry rather than downloading it
  // unverified, so "pinned" and "installable" have to be the same set. If they
  // ever differ the install quietly gets smaller, which is the failure this
  // pairs with the check above to make impossible.
  check(
    'and the installable set is exactly the pinned set',
    MUSIC_TRACKS.length === FILE_ENTRIES.length,
    `${MUSIC_TRACKS.length} installable vs ${FILE_ENTRIES.length} in the manifest`
  )
  const hosts = [...new Set(MUSIC_TRACKS.map((t) => new URL(t.download).origin))].sort()
  // The Rust allowlist names these two and nothing else. A third host arriving
  // in the manifest would be refused at install time with no explanation here,
  // so it fails here instead, next to the list that has to grow.
  check(
    'and comes from the two hosts src-tauri/src/music.rs allows',
    hosts.join(',') === 'https://opengameart.org,https://upload.wikimedia.org',
    hosts.join(',')
  )
  const rust = readFileSync('src-tauri/src/setup/downloads.rs', 'utf8')
  for (const host of hosts) {
    check(`${host} is in the Rust allowlist`, rust.includes(host))
  }
  check(
    'the library has a real measured size',
    MUSIC_LIBRARY_BYTES > 1024 ** 3,
    formatLibrarySize(MUSIC_LIBRARY_BYTES)
  )
  check('and it is reported in units a person reads', formatLibrarySize(MUSIC_LIBRARY_BYTES).endsWith(' GB'))
}

console.log('\n-- 2. one resolver decides where a track is --')
{
  resetInstalledMusicBase()
  const file = MUSIC_TRACKS[0].file
  check('with nothing installed a track is the bundled path', audioUrl(file) === `/audio/${file}`, audioUrl(file))
  check('and that counts as one of ours', isLibraryUrl(audioUrl(file)) === true)

  setInstalledMusicBase('asset://localhost/C%3A/data/audio')
  check(
    'once installed the same track resolves to the installed copy',
    audioUrl(file) === `asset://localhost/C%3A/data/audio/${file}`,
    audioUrl(file)
  )
  check('and that still counts as one of ours', isLibraryUrl(audioUrl(file)) === true)
  check(
    "a listener's own stream is not",
    isLibraryUrl('https://example.invalid/stream.mp3') === false
  )
  resetInstalledMusicBase()
  check('and forgetting the install goes back to the bundled path', audioUrl(file) === `/audio/${file}`)
}

/** A zone the manifest actually gives a playlist to - chosen from the data so
 * a renamed zone fails loudly rather than making every case below a no-op. */
const zoneWithTracks = Object.entries(manifest.zone ?? {}).find(
  ([, z]) => (z.tracks ?? []).length > 1
)
if (!zoneWithTracks) {
  console.log('FAIL manifest has no zone with a playlist - nothing below could be tested')
  process.exit(1)
}
const [ZONE_ID] = zoneWithTracks

/** Every fetch made while reaching the unavailable state, captured before the
 * next reset clears it. See section 5. */
let probeCalls = []

const reset = async (opts = {}) => {
  stopMusic()
  resetMusicLibraryVerdict()
  resetInstalledMusicBase()
  if (opts.installedAt) setInstalledMusicBase(opts.installedAt)
  setMusicStarted(true)
  setMusicVolume(1)
  MockAudio.instances.length = 0
  MockAudio.sources.length = 0
  MockAudio.behavior = opts.behavior ?? 'resolve'
  fetchMode = opts.fetch ?? 'html'
  fetchCalls.length = 0
  await settle()
  MockAudio.instances.length = 0
  MockAudio.sources.length = 0
  fetchCalls.length = 0
}

console.log('\n-- 3. a completed install makes the library present --')
{
  // The state this lane exists to get out of: no install, every bundled track
  // absent, one honest `unavailable`.
  await reset({ behavior: 'media-error', fetch: 'html' })
  setZone(ZONE_ID)
  await settle()
  check(
    'with nothing installed the zone playlist is unavailable',
    nowPlaying()?.status === 'unavailable',
    nowPlaying()?.status
  )
  check('and the state names the remedy, not a filename', nowPlaying()?.title === 'Music not installed')
  check(
    'and its explanation says the library can be installed',
    /install/i.test(nowPlaying()?.error ?? ''),
    nowPlaying()?.error
  )
  // Kept for section 5. Read here rather than there because the next `reset`
  // clears it, and an empty array would make that check vacuously true - the
  // shape of a check that cannot fail.
  probeCalls = [...fetchCalls]

  // The same playlist, after an install: the files exist where the resolver
  // now points, so the identical code path plays.
  await reset({ behavior: 'resolve', fetch: 'audio', installedAt: 'asset://localhost/lib' })
  setZone(ZONE_ID)
  await settle()
  const state = nowPlaying()
  check('after an install the same playlist plays', state?.status === 'playing', state?.status)
  check(
    'and it is playing from the installed copy',
    MockAudio.sources[0]?.startsWith('asset://localhost/lib/'),
    MockAudio.sources[0]
  )
  check(
    'and it is not still reporting the library missing',
    state?.title !== 'Music not installed',
    state?.title
  )
}

console.log('\n-- 4. the unavailable state offers only installs --')
{
  const transport = readFileSync('src/components/game/MusicTransport.tsx', 'utf8')
  const install = readFileSync('src/components/game/MusicInstall.tsx', 'utf8')
  // Read from the source rather than a rendered tree: this suite runs under
  // Node's type stripping, which does not compile JSX. The properties asserted
  // are about which control exists in which state, and each names the value the
  // component actually branches on.
  check(
    'the unavailable state renders the install action',
    /\{unavailable && <MusicInstallAction groupId=\{now\?\.groupId\} \/>\}/.test(transport)
  )
  check(
    'and hands it the group of the track that could not play',
    /groupId\?: string/.test(install) && /musicGroup\(groupId\)/.test(install)
  )
  check(
    'the install action states the size before it is pressed',
    /Install \$\{group\.name\} \(\$\{formatLibrarySize\(group\.bytes\)\}\)/.test(install)
  )
  check(
    'and the whole library is still offered, with its own size',
    /Install all \(\$\{formatLibrarySize\(MUSIC_LIBRARY_BYTES\)\}\)/.test(install)
  )
  // Exactly one: a Retry alongside it would be the dead button #383 was about.
  // `retryable` is false in this state by construction (musicRetryable reads
  // `status === 'failed'`), and this is the assertion that keeps the two from
  // ever being rendered from the same condition.
  check(
    'and the Retry control is still gated on retryable, not on failure',
    /\{retryable && \(/.test(transport) && transport.includes('musicRetryable()')
  )
  check(
    'and Retry is not rendered from the unavailable state',
    !/unavailable &&[^\n]*Retry/.test(transport)
  )
  check(
    'the transport can still be reached to install from the footer',
    transport.includes('MusicInstallAction') && install.includes('installMusicLibrary')
  )
  check('a cancel is offered while it runs', install.includes('cancelMusicInstall'))
  check(
    'and a failure is shown rather than swallowed',
    install.includes("setPhase('failed')") && /role="alert"/.test(install)
  )
  // The panel's own list, and its remove. Both read the same component, so a
  // future edit cannot give the footer and the panel two ideas of what an
  // install is.
  const panel = readFileSync('src/components/game/SoundControls.tsx', 'utf8')
  check('the Sound panel lists every group', panel.includes('<MusicLibraryGroups />'))
  check(
    'and that list is built from MUSIC_GROUPS, not a second list of stations',
    /MUSIC_GROUPS\.map/.test(install)
  )
  check(
    'each row can be removed, through the group-scoped command',
    install.includes('removeMusicGroup(group)')
  )
  check(
    'a partial group offers a resume rather than a fresh install',
    /Resume \(\$\{formatLibrarySize\(remaining\)\}\)/.test(install)
  )
  check(
    "and outside the app it says it could not check rather than 'absent'",
    install.includes('Could not check')
  )
}

console.log('\n-- 5. nothing is fetched before the click --')
{
  // The property, not the mechanism: the install must have exactly one caller
  // in the app, and that caller must be a click.
  const callers = []
  let scanned = 0
  // `withFileTypes` rather than a `statSync` before each read: the two-step
  // form checks one file and then reads whatever is at that path afterwards,
  // which is a different question from the one being asked and which CodeQL
  // flags as a race.
  const walk = async (dir) => {
    const { readdirSync } = await import('node:fs')
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !full.endsWith('lib/musicLibrary.ts')) {
        scanned++
        const text = readFileSync(full, 'utf8')
        if (/\binstallMusicLibrary\s*\(/.test(text)) callers.push(full)
      }
    }
  }
  await walk('src')
  // The denominator. Without it a walk that matched nothing would report "the
  // install has no callers" as a pass rather than as a broken scan.
  check('the scan actually read the source tree', scanned >= 100, `${scanned} files`)
  check(
    'the install has exactly one call site in the app',
    callers.length === 1,
    callers.join(', ')
  )
  const only = readFileSync(callers[0] ?? 'src/components/game/MusicTransport.tsx', 'utf8')
  const onClickToInstall = /onClick=\{\(\) => \{[\s\S]{0,400}?installMusicLibrary\(/.test(only)
  check('and it is inside a click handler', onClickToInstall)
  check(
    'no effect, timer or module body starts it',
    !/useEffect\([\s\S]{0,300}?installMusicLibrary\(/.test(only) &&
      !/setTimeout\([\s\S]{0,200}?installMusicLibrary\(/.test(only)
  )
  // And the run above proves it in behaviour as well as in shape: playing a
  // zone with no library made HEAD probes and nothing else.
  check(
    'reaching the unavailable state made at least one probe',
    probeCalls.length >= 1,
    `${probeCalls.length} calls`
  )
  check(
    'and every one of them was the HEAD probe, never a download',
    probeCalls.every((c) => c.init?.method === 'HEAD'),
    probeCalls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`).join(' | ')
  )
}

console.log('\n-- 6. the groups partition the library --')
{
  // The denominator for everything below. A group table that lost a station,
  // or counted a track twice, would make every per-group check further down an
  // assertion about a set that is not the library.
  check('there is more than one group to choose between', MUSIC_GROUPS.length >= 2, `${MUSIC_GROUPS.length} groups`)
  const seen = new Map()
  for (const g of MUSIC_GROUPS) for (const t of g.tracks) seen.set(t.file, (seen.get(t.file) ?? 0) + 1)
  const inTwo = [...seen.entries()].filter(([, n]) => n > 1).map(([f]) => f)
  const inNone = MUSIC_TRACKS.filter((t) => !seen.has(t.file)).map((t) => t.file)
  check('every track is in at least one group', inNone.length === 0, inNone.slice(0, 3).join(', '))
  check('and no track is in two', inTwo.length === 0, inTwo.slice(0, 3).join(', '))
  check(
    'so the groups hold exactly the installable tracks',
    seen.size === MUSIC_TRACKS.length,
    `${seen.size} grouped vs ${MUSIC_TRACKS.length} installable`
  )
  const summed = MUSIC_GROUPS.reduce((n, g) => n + g.bytes, 0)
  check(
    'and their sizes sum to the whole library',
    summed === MUSIC_LIBRARY_BYTES,
    `${summed} vs ${MUSIC_LIBRARY_BYTES}`
  )
  check(
    'no group is empty, and each has a name a person can read',
    MUSIC_GROUPS.every((g) => g.tracks.length > 0 && g.bytes > 0 && g.name.trim().length > 0),
    MUSIC_GROUPS.map((g) => `${g.name} ${g.tracks.length}/${formatLibrarySize(g.bytes)}`).join(' | ')
  )
  // The grouping is the manifest's own `station`, not a taxonomy invented here.
  const stations = new Set((manifest.radio ?? []).map((r) => r.station))
  check(
    'the radio groups are exactly the stations the manifest names',
    MUSIC_GROUPS.filter((g) => g.id !== AMBIENCE_GROUP_ID).length === stations.size,
    `${stations.size} stations`
  )
  check(
    'and the entries with no station land in one group rather than none',
    musicGroup(AMBIENCE_GROUP_ID)?.tracks.length === Object.keys(manifest.biome ?? {}).length,
    `${musicGroup(AMBIENCE_GROUP_ID)?.tracks.length} ambience tracks`
  )
  // Every group is smaller than the whole, which is the point of the change.
  const largest = Math.max(...MUSIC_GROUPS.map((g) => g.bytes))
  check(
    'the largest single choice is smaller than the library',
    largest < MUSIC_LIBRARY_BYTES,
    `${formatLibrarySize(largest)} of ${formatLibrarySize(MUSIC_LIBRARY_BYTES)}`
  )
}

/** Every file of a group, for standing in as "these are on disk". */
const filesOf = (id) => (musicGroup(id)?.tracks ?? []).map((t) => t.file)

console.log('\n-- 7. presence is per group --')
{
  const [first, second] = MUSIC_GROUPS
  setInstalledMusicFiles(filesOf(first.id))
  const status = musicLibraryStatus()
  const byId = Object.fromEntries((status?.groups ?? []).map((g) => [g.id, g]))
  check('an installed group reports installed', byId[first.id]?.state === 'installed', byId[first.id]?.state)
  check('and its missing count is zero', byId[first.id]?.missing === 0, `${byId[first.id]?.missing}`)
  check('another group reports absent', byId[second.id]?.state === 'absent', byId[second.id]?.state)
  check(
    'and the library as a whole is not complete',
    status?.complete === false && status?.installed === first.tracks.length,
    `${status?.installed} of ${status?.total}`
  )
  check(
    'the per-group counts add up to the library count',
    (status?.groups ?? []).reduce((n, g) => n + g.installed, 0) === status?.installed
  )
  check(
    'a track of the installed group is present and one of the other is absent',
    trackPresence(first.tracks[0].file) === 'present' &&
      trackPresence(second.tracks[0].file) === 'absent'
  )

  // A cancelled install: some of a group, not all of it. The exact count is
  // the assertion - "partial" alone would stay true if the number were wrong,
  // and the number is what the resume button puts in front of a person.
  const partial = filesOf(second.id).slice(0, 2)
  setInstalledMusicFiles([...filesOf(first.id), ...partial])
  const after = Object.fromEntries((musicLibraryStatus()?.groups ?? []).map((g) => [g.id, g]))
  check('a half-installed group reports partial', after[second.id]?.state === 'partial', after[second.id]?.state)
  check(
    'and names exactly how many tracks are still missing',
    after[second.id]?.missing === second.tracks.length - partial.length,
    `${after[second.id]?.missing} missing of ${second.tracks.length}`
  )
  check(
    'and the group that was already whole is untouched by that',
    after[first.id]?.state === 'installed'
  )

  // Nobody has looked is a third answer, not a polite "absent" - otherwise a
  // browser preview would skip every track it can actually play.
  setInstalledMusicFiles(null)
  check(
    'with nothing probed a track is unknown, not absent',
    trackPresence(MUSIC_TRACKS[0].file) === 'unknown',
    trackPresence(MUSIC_TRACKS[0].file)
  )
  resetInstalledMusicBase()
}

console.log('\n-- 8. the offered install is the group that could not play --')
{
  // A zone whose whole playlist sits in one group, so "all of it is missing"
  // is a state that can exist at all. Chosen from the data: a manifest that
  // regrouped its stations fails here loudly instead of testing nothing.
  const zoneGroups = (z) =>
    new Set(
      (manifest.zone[z]?.tracks ?? [])
        .map((id) => (manifest.radio ?? []).find((r) => r.id === id)?.file)
        .filter((f) => f !== undefined)
        .map((f) => groupIdForFile(f))
    )
  const singleGroupZone = Object.keys(manifest.zone ?? {}).find(
    (z) => (manifest.zone[z].tracks ?? []).length > 1 && zoneGroups(z).size === 1
  )
  check('the manifest has a zone drawn from one group', Boolean(singleGroupZone), singleGroupZone ?? 'none')
  const targetGroup = singleGroupZone ? [...zoneGroups(singleGroupZone)][0] : null

  // Every OTHER group installed. This is the chooser tested where the wrong
  // answers are present and reachable: four groups are on disk and one is not,
  // so "it offered the right group" cannot be a chooser with one option.
  const others = MUSIC_GROUPS.filter((g) => g.id !== targetGroup)
  check('and the wrong answers are available to be chosen', others.length >= 2, `${others.length} installed groups`)
  await reset({ behavior: 'resolve', fetch: 'audio', installedAt: 'asset://localhost/lib' })
  setInstalledMusicFiles(others.flatMap((g) => filesOf(g.id)))
  setZone(singleGroupZone)
  await settle()
  const state = nowPlaying()
  check(
    'a zone whose only group is absent reports unavailable',
    state?.status === 'unavailable',
    `${state?.status} - ${state?.title}`
  )
  check(
    'and names that group, not one of the four installed ones',
    state?.groupId === targetGroup,
    `${state?.groupId} vs ${targetGroup}`
  )
  check(
    'and nothing was loaded from the absent group',
    MockAudio.sources.length === 0,
    `${MockAudio.sources.length} loads: ${MockAudio.sources.join(' | ')}`
  )

  // The other side of the same fact: a zone drawn from an installed group
  // plays, while the group above is still absent. Without this the checks
  // above would also pass if presence had simply broken everything.
  const installedZone = Object.keys(manifest.zone ?? {}).find(
    (z) =>
      (manifest.zone[z].tracks ?? []).length > 1 &&
      zoneGroups(z).size === 1 &&
      [...zoneGroups(z)][0] !== targetGroup
  )
  check('the manifest has a zone in an installed group too', Boolean(installedZone), installedZone ?? 'none')
  setZone(installedZone)
  await settle()
  check(
    'and that zone plays while the other group is still absent',
    nowPlaying()?.status === 'playing',
    `${nowPlaying()?.status} - ${nowPlaying()?.title}`
  )
  check(
    'from the installed copy',
    MockAudio.sources[0]?.startsWith('asset://localhost/lib/'),
    MockAudio.sources[0]
  )

  // A zone that draws from both: the installed tracks play and the absent ones
  // are stepped past rather than erroring, which is the difference between one
  // missing station and a silent client.
  const mixedZone = Object.keys(manifest.zone ?? {}).find(
    (z) => zoneGroups(z).size > 1 && zoneGroups(z).has(targetGroup)
  )
  check('the manifest has a zone spanning two groups', Boolean(mixedZone), mixedZone ?? 'none')
  await reset({ behavior: 'resolve', fetch: 'audio', installedAt: 'asset://localhost/lib' })
  setInstalledMusicFiles(others.flatMap((g) => filesOf(g.id)))
  setZone(mixedZone)
  await settle()
  check(
    'a zone spanning an absent group still plays its installed tracks',
    nowPlaying()?.status === 'playing',
    `${nowPlaying()?.status} - ${nowPlaying()?.title}`
  )
  const absentFiles = new Set(filesOf(targetGroup).map((f) => `asset://localhost/lib/${f}`))
  check(
    'and never asked the element for one from the absent group',
    MockAudio.sources.every((s) => !absentFiles.has(s)),
    MockAudio.sources.join(' | ')
  )
  setInstalledMusicFiles(null)
  resetInstalledMusicBase()
}

stopMusic()
console.log(`\n${checked} checks, ${failed} failures`)
if (checked < 55) {
  console.log(`FAIL only ${checked} checks ran - the suite did not finish`)
  process.exit(1)
}
process.exit(failed === 0 ? 0 : 1)
