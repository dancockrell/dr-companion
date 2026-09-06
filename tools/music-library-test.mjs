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
  musicInstallRun,
  installMusicLibrary,
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


console.log('\n-- 9. an interrupted download is a state the panel can see (#402) --')
{
  // #402: `download_verified` deleted its temporary only on a checksum
  // mismatch, so a dropped connection left a `.part` that `present()` could
  // not see, that no retry read and that nothing ever removed. The fix keeps
  // it deliberately, as a resume point, which only helps if the side that
  // draws the panel can tell an interrupted group from an absent one.
  const [, second] = MUSIC_GROUPS
  const interrupted = filesOf(second.id).slice(0, 2)
  setInstalledMusicFiles([], interrupted)
  const byId = Object.fromEntries((musicLibraryStatus()?.groups ?? []).map((g) => [g.id, g]))
  const s = byId[second.id]
  check(
    'a group with nothing finished but a download interrupted is partial, not absent',
    s?.state === 'partial',
    s?.state
  )
  check(
    'and names how many of them are interrupted',
    s?.partial === interrupted.length,
    `${s?.partial} interrupted of ${s?.total}`
  )
  check(
    'while still counting none of them as installed',
    s?.installed === 0 && s?.bytesInstalled === 0 && s?.missing === s?.total,
    `${s?.installed} installed, ${s?.bytesInstalled} bytes`
  )
  check(
    'so a half-downloaded track is absent to the players, never present',
    trackPresence(interrupted[0]) === 'absent',
    trackPresence(interrupted[0])
  )
  // The other side of the same fact. Without it the checks above would also
  // pass if presence had simply stopped answering `present` at all.
  setInstalledMusicFiles(filesOf(second.id))
  check(
    'control: the same group with the files finished reports installed',
    Object.fromEntries((musicLibraryStatus()?.groups ?? []).map((g) => [g.id, g]))[second.id]
      ?.state === 'installed'
  )
  // A group with nothing at all is still absent, so `partial` did not simply
  // swallow the third state.
  setInstalledMusicFiles([])
  check(
    'control: a group with nothing on disk is still absent',
    Object.fromEntries((musicLibraryStatus()?.groups ?? []).map((g) => [g.id, g]))[second.id]
      ?.state === 'absent'
  )
  setInstalledMusicFiles(null)
  resetInstalledMusicBase()

  // The producing side and the consuming side, checked against each other -
  // a field Rust reports and nothing reads is the same absence with more
  // steps.
  const rust = readFileSync('src-tauri/src/music.rs', 'utf8')
  const lib = readFileSync('src/lib/musicLibrary.ts', 'utf8')
  const panel = readFileSync('src/components/game/MusicInstall.tsx', 'utf8')
  check(
    'Rust reports the interrupted downloads on the status walk',
    /pub partial_files: Vec<String>/.test(rust) && /partial_files\.push/.test(rust),
    'src-tauri/src/music.rs'
  )
  check(
    'and this side reads that field rather than ignoring it',
    /raw\.partial_files/.test(lib),
    'src/lib/musicLibrary.ts'
  )
  check(
    'and the panel puts the count in front of a person',
    /s\.partial > 0/.test(panel) && /interrupted/.test(panel),
    'src/components/game/MusicInstall.tsx'
  )

  // The three checks above name `partial_files`, and nothing anywhere named
  // `installed_files` - the field every group's state is derived from.
  // Measured 6 Sep 2026: adding `#[serde(rename_all = "camelCase")]` to
  // `MusicLibraryStatus` left `cargo test --lib music::` at 18 passed and this
  // suite at 96 checks / 0 failures, while `refreshMusicLibrary` would have
  // read `raw.installed_files` as `undefined`, fallen through its `?? []`, and
  // reported every group `absent` - a 4.36 GB re-download offered for a
  // library already on the disk, and `trackPresence` stepping past every
  // track that is actually there.
  //
  // So the pairing is checked by walking the struct rather than by naming one
  // field: every key Rust puts on the wire has to be read on this side under
  // that exact name, and a field added tomorrow is covered without anybody
  // adding a line here. The serde check is the other half, because a rename
  // attribute changes every key on the wire while leaving every
  // `pub <field>` below untouched - a text check on the identifiers alone
  // cannot see it, which is precisely how the sabotage above stayed green.
  const statusStruct = /pub struct MusicLibraryStatus \{([\s\S]*?)\r?\n\}/.exec(rust)?.[1] ?? ''
  const statusFields = [...statusStruct.matchAll(/^\s*pub (\w+):/gm)].map((m) => m[1])
  // The denominator, and it is the fragile thing: a regex that stopped
  // matching would otherwise report a struct with no fields and pass the loop
  // below by having nothing to iterate.
  check(
    'the status struct parses at all',
    statusFields.length >= 3,
    statusFields.join(', ') || 'nothing parsed - suspect the regex, not the struct'
  )
  const attributes = rust
    .slice(0, rust.indexOf('pub struct MusicLibraryStatus'))
    .split(/\r?\n/)
    .slice(-4)
    .join('\n')
  check(
    'nothing renames the status keys between Rust and the wire',
    !/serde\s*\([^)]*rename/.test(attributes) && !/serde\s*\([^)]*rename/.test(statusStruct),
    'src-tauri/src/music.rs'
  )
  for (const field of statusFields) {
    check(
      `and this side reads status.${field} under that exact name`,
      new RegExp(`raw\\.${field}\\b`).test(lib),
      'src/lib/musicLibrary.ts'
    )
  }
}

console.log('\n-- 10. a refusal reaches the transport where progress would be (#402) --')
{
  // #402 item 2: nothing checked free space before a multi-gigabyte install,
  // so a full disk surfaced as a raw OS error some minutes in. Rust now
  // refuses before the first request. The property here is that the sentence
  // it refuses with survives the trip and is shown, rather than being
  // swallowed or replaced by a generic failure.
  const REFUSAL =
    'not enough free space: this needs 1.6 GB and the disk has 900 MB free, of which 400 MB is usable after leaving a 500 MB margin. Nothing was downloaded.'
  const invoked = []
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: (cmd, args) => {
        invoked.push({ cmd, args })
        if (cmd === 'install_music_library') return Promise.reject(new Error(REFUSAL))
        return Promise.resolve(undefined)
      },
    },
  }
  let caught = null
  try {
    await installMusicLibrary(MUSIC_GROUPS[0])
  } catch (e) {
    caught = e
  }
  // The denominator: the call really did reach the backend seam, so the
  // message below is one that travelled rather than one written here.
  check(
    'the install reached the backend at all',
    invoked.some((c) => c.cmd === 'install_music_library'),
    invoked.map((c) => c.cmd).join(', ') || 'nothing invoked'
  )
  check(
    'a refused install rejects rather than resolving quietly',
    caught !== null,
    caught === null ? 'resolved' : 'rejected'
  )
  check(
    'and the refusal arrives word for word, numbers and all',
    caught?.message === REFUSAL,
    caught?.message
  )
  check(
    'and it names what is needed and what is there',
    /needs .*and the disk has .*free/.test(caught?.message ?? ''),
    caught?.message
  )
  // Nothing was refreshed off the back of a failed install, so a refusal
  // cannot leave the panel claiming a library it did not get.
  check(
    'and no status was read as though the install had happened',
    !invoked.some((c) => c.cmd === 'music_library_status'),
    invoked.map((c) => c.cmd).join(', ')
  )
  delete globalThis.window

  // Where it is shown: the same span the progress readout occupies, in the
  // one component both the footer transport and the Sound panel render.
  const panel = readFileSync('src/components/game/MusicInstall.tsx', 'utf8')
  check(
    'the button stores whatever the install rejected with, not a fixed string',
    /\.catch\(\(e: unknown\) => \{[\s\S]{0,200}?setError\(e instanceof Error \? e\.message : String\(e\)\)/.test(
      panel
    )
  )
  check(
    'and renders it, announced, where the progress readout would be',
    /phase === 'failed' &&[\s\S]{0,300}?role="alert"[\s\S]{0,200}?\{error\}/.test(panel)
  )
  check(
    'and still offers no Retry beside it',
    !/>\s*Retry\s*</.test(panel),
    'src/components/game/MusicInstall.tsx'
  )
}

console.log('\n-- 11. cancel stops inside a file, and the row offers Resume (#402) --')
{
  // #402's last item. Cancel used to be read once per track, so pressing it
  // during a 90 MB download did nothing until that file finished. The read
  // loop now takes the same flag and checks it per chunk, which means a
  // cancelled install ends *mid-file* - and what that leaves is exactly what
  // an interrupted download leaves, a `.part` shorter than the pinned size.
  // So the state this produces on the panel is `partial`, with Resume, not a
  // failure and not a restart from zero.
  const panel = readFileSync('src/components/game/MusicInstall.tsx', 'utf8')
  const [, second] = MUSIC_GROUPS
  const stoppedMidFile = filesOf(second.id).slice(0, 1)
  setInstalledMusicFiles(filesOf(second.id).slice(1, 3), stoppedMidFile)
  const s = Object.fromEntries((musicLibraryStatus()?.groups ?? []).map((g) => [g.id, g]))[
    second.id
  ]
  check(
    'a group cancelled part-way through a file is partial, not failed',
    s?.state === 'partial',
    s?.state
  )
  check(
    'and the file the cancel stopped in counts as interrupted, not installed',
    s?.partial === 1 && s?.installed === 2,
    `${s?.installed} installed, ${s?.partial} interrupted`
  )
  check(
    'so the row a person sees says Resume rather than Install',
    s?.state === 'partial' && /s\.state === 'partial'\s*\?\s*`Resume \(/.test(panel),
    'src/components/game/MusicInstall.tsx'
  )
  setInstalledMusicFiles(null)
  resetInstalledMusicBase()

  // The producing side: the flag the Cancel button sets is the one the read
  // loop reads. A cancel token nothing passes down is the same gap this
  // section exists to close.
  const rust = readFileSync('src-tauri/src/music.rs', 'utf8')
  const downloads = readFileSync('src-tauri/src/setup/downloads.rs', 'utf8')
  check(
    'the download loop checks a cancel flag per chunk rather than per file',
    /received \+= bytes\.len\(\) as u64;[\s\S]{0,200}?if cancel\.load\(Ordering::SeqCst\)/.test(
      downloads
    ),
    'src-tauri/src/setup/downloads.rs'
  )
  check(
    'and a cancel is an outcome rather than an error string to recognise',
    /enum DownloadOutcome/.test(downloads) && /Cancelled \{ bytes: u64 \}/.test(downloads),
    'src-tauri/src/setup/downloads.rs'
  )
  check(
    'the installer passes the running install its own flag rather than keeping a second one',
    /install_into\(dir, tracks, free, allowed, guard\.cancel\(\), on_progress\)/.test(rust) &&
      (rust.match(/cancel: AtomicBool::new\(false\)/g) ?? []).length === 1,
    'src-tauri/src/music.rs'
  )
  check(
    'and stops the run when a track comes back cancelled part-way',
    /if let DownloadOutcome::Cancelled \{ bytes \} = outcome \{[\s\S]{0,700}?cancelled: true/.test(
      rust
    ),
    'src-tauri/src/music.rs'
  )
  check(
    'while the setup wizard, which has no Cancel, passes a flag nothing sets',
    /pub static NEVER_CANCELLED: AtomicBool/.test(downloads) &&
      /&NEVER_CANCELLED,/.test(downloads),
    'src-tauri/src/setup/downloads.rs'
  )
}

console.log('\n-- 12. one install at a time, and anything on disk can be removed (#422, #423) --')
{
  const install = readFileSync('src/components/game/MusicInstall.tsx', 'utf8')
  const lib = readFileSync('src/lib/musicLibrary.ts', 'utf8')
  const rust = readFileSync('src-tauri/src/music.rs', 'utf8')

  // #422, the Rust side. The cancel flag used to be one process-wide
  // `AtomicBool` that every install cleared as its first act, so a Cancel
  // followed by any second Install was discarded and the first download ran to
  // completion. The flag now belongs to the running install, and there is one
  // owner of "is an install running".
  check(
    'Rust keeps one install slot rather than a process-wide cancel flag',
    /static RUNNING: Mutex<Option<Arc<RunningInstall>>>/.test(rust) &&
      !/static CANCELLED: AtomicBool/.test(rust),
    'src-tauri/src/music.rs'
  )
  check(
    'a Cancel reaches the install that is running, not the process',
    /pub fn cancel_music_install\(\) \{[\s\S]{0,300}?running\.cancel\.store\(true/.test(rust),
    'src-tauri/src/music.rs'
  )
  check(
    'a second install is refused as busy before any flag or disk is touched',
    /InstallGuard::claim\([\s\S]{0,400}?busy: true/.test(rust) &&
      /install_guarded[\s\S]{0,900}?InstallGuard::claim/.test(rust),
    'src-tauri/src/music.rs'
  )
  check(
    'and the slot is released however the install ends, error included',
    /impl Drop for InstallGuard/.test(rust),
    'src-tauri/src/music.rs'
  )
  check(
    'the shipping command goes through the guard rather than straight to install_into',
    /pub async fn install_music_library\([\s\S]{0,700}?install_guarded\(/.test(rust),
    'src-tauri/src/music.rs'
  )

  // #422, this side. The property is that no component keeps an install phase
  // of its own: that is what made every button in the app clickable while
  // another install ran.
  const { readdirSync } = await import('node:fs')
  const withOwnPhase = []
  let scanned = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        scanned++
        const text = readFileSync(full, 'utf8')
        if (/useState<[^>]*'installing'/.test(text) || /setPhase\('installing'\)/.test(text)) {
          withOwnPhase.push(full)
        }
      }
    }
  }
  walk('src')
  // The denominator, for the reason section 5 gives about its own walk.
  check('the scan for a private install phase read the source tree', scanned >= 100, `${scanned} files`)
  check(
    'no component keeps its own install phase',
    withOwnPhase.length === 0,
    withOwnPhase.join(', ')
  )
  check(
    'the buttons read the one running install instead',
    /export function useMusicInstall|function useMusicInstall/.test(install) &&
      /onMusicInstallChange/.test(lib) &&
      /musicInstallRun/.test(install),
    'src/components/game/MusicInstall.tsx'
  )
  check(
    // The condition as well as the markup: a disabled button nothing can
    // reach reads exactly like one that is never drawn, and the first version
    // of this check passed against a branch whose guard had been cut out.
    'and a button for any other group is disabled, saying what is running',
    /if \(run\) \{[\s\S]{0,700}?disabled\b[\s\S]{0,500}?Installing \{run\.groupName\}/.test(install),
    'src/components/game/MusicInstall.tsx'
  )

  // The store, driven rather than read: while an install is in flight one
  // place knows which group it is, and it is empty again afterwards.
  let release = null
  const invoked = []
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: (cmd, args) => {
        invoked.push({ cmd, args })
        if (cmd === 'install_music_library') {
          return new Promise((resolve) => {
            release = () =>
              resolve({ installed: 1, total: 1, bytes: 1, cancelled: false, busy: false })
          })
        }
        if (cmd === 'music_library_status') {
          return Promise.resolve({ dir: 'scratch', installed_files: [], partial_files: [] })
        }
        return Promise.resolve(undefined)
      },
    },
  }
  const [, second] = MUSIC_GROUPS
  const running = installMusicLibrary(second)
  await settle()
  check(
    'while an install runs, one place knows which group it is',
    musicInstallRun()?.groupId === second.id,
    musicInstallRun()?.groupId ?? 'nothing running'
  )
  check(
    'and Rust is told the name, so a refusal can say what to wait for',
    invoked.find((c) => c.cmd === 'install_music_library')?.args?.group === second.name,
    invoked.find((c) => c.cmd === 'install_music_library')?.args?.group ?? 'no group sent'
  )
  release()
  await running
  check('and nothing is running once it finishes', musicInstallRun() === null)

  // A busy answer is a refusal a person can act on, not a silent success.
  const busyInvoked = []
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: (cmd, args) => {
        busyInvoked.push({ cmd, args })
        if (cmd === 'install_music_library') {
          return Promise.resolve({
            installed: 0,
            total: 3,
            bytes: 0,
            cancelled: false,
            busy: true,
            busy_group: second.name,
          })
        }
        return Promise.resolve(undefined)
      },
    },
  }
  let caught = null
  try {
    await installMusicLibrary(MUSIC_GROUPS[0])
  } catch (e) {
    caught = e
  }
  check('a refused second install rejects rather than resolving quietly', caught !== null)
  check(
    'and the refusal names the install that has the slot',
    (caught?.message ?? '').includes(second.name),
    caught?.message
  )
  check(
    'and nothing was read back as though it had installed',
    !busyInvoked.some((c) => c.cmd === 'music_library_status'),
    busyInvoked.map((c) => c.cmd).join(', ')
  )
  check('and the store is not left claiming an install is running', musicInstallRun() === null)
  delete globalThis.window

  // #423. A group whose every track was cancelled part-way has nothing
  // finished and a `.part` for each one, and offered Resume and no Remove -
  // up to 1.65 GB with no way to delete it from anywhere in the app.
  check(
    'the Remove gate reads one derived number rather than counting at the button',
    /s\.removable > 0/.test(install) && /removable: installed \+ partial/.test(lib),
    'src/components/game/MusicInstall.tsx'
  )
  const worst = MUSIC_GROUPS.reduce((a, b) => (b.bytes > a.bytes ? b : a))
  setInstalledMusicFiles(
    [],
    worst.tracks.map((t) => t.file)
  )
  const allPart = (musicLibraryStatus()?.groups ?? []).find((g) => g.id === worst.id)
  check(
    'a group that is all half-files still reports partial with nothing installed',
    allPart?.state === 'partial' && allPart?.installed === 0 && allPart?.partial === worst.tracks.length,
    `${allPart?.installed} installed, ${allPart?.partial} interrupted`
  )
  check(
    'and it is removable, which is what the row now offers',
    (allPart?.removable ?? 0) > 0,
    `${allPart?.removable} removable, ${formatLibrarySize(worst.bytes)} at stake`
  )
  // The other side of the gate: a group with nothing on disk offers no Remove,
  // so the check above is the state and not a button that is always drawn.
  setInstalledMusicFiles([], [])
  const empty = (musicLibraryStatus()?.groups ?? []).find((g) => g.id === worst.id)
  check(
    'a group with nothing on disk is not removable',
    empty?.removable === 0 && empty?.state === 'absent',
    `${empty?.removable} removable, ${empty?.state}`
  )
  check(
    'and the tooltip names the interrupted downloads it also deletes',
    /interrupted download\$\{/.test(install) && /removedLabel\(s\)/.test(install),
    'src/components/game/MusicInstall.tsx'
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
