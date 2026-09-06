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
 *   4. The unavailable state offers exactly one action and it is the install.
 *   5. Nothing is fetched before the click - the install has one call site and
 *      it is a click handler.
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
  MUSIC_TRACKS,
  MUSIC_LIBRARY_BYTES,
  audioUrl,
  formatLibrarySize,
  isLibraryUrl,
  resetInstalledMusicBase,
  setInstalledMusicBase,
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
  MockAudio.behavior = opts.behavior ?? 'resolve'
  fetchMode = opts.fetch ?? 'html'
  fetchCalls.length = 0
  await settle()
  MockAudio.instances.length = 0
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
    MockAudio.instances[0]?.src.startsWith('asset://localhost/lib/'),
    MockAudio.instances[0]?.src
  )
  check(
    'and it is not still reporting the library missing',
    state?.title !== 'Music not installed',
    state?.title
  )
}

console.log('\n-- 4. the unavailable state offers exactly one action --')
{
  const transport = readFileSync('src/components/game/MusicTransport.tsx', 'utf8')
  // Read from the transport source rather than a rendered tree: this suite
  // runs under Node's type stripping, which does not compile JSX. The
  // properties asserted are about which control exists in which state, and
  // each names the value the component actually branches on.
  check(
    'the unavailable state renders the install action',
    /\{unavailable && <MusicInstallAction \/>\}/.test(transport)
  )
  check(
    'the install action states the size before it is pressed',
    /Install music \(\{formatLibrarySize\(total\)\}\)/.test(transport)
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
    transport.includes('MusicInstallAction') && transport.includes('installMusicLibrary')
  )
  check('a cancel is offered while it runs', transport.includes('cancelMusicInstall'))
  check(
    'and a failure is shown rather than swallowed',
    transport.includes("setPhase('failed')") && /role="alert"/.test(transport)
  )
}

console.log('\n-- 5. nothing is fetched before the click --')
{
  // The property, not the mechanism: the install must have exactly one caller
  // in the app, and that caller must be a click.
  const callers = []
  const walk = async (dir) => {
    const { readdirSync, statSync } = await import('node:fs')
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`
      if (statSync(full).isDirectory()) await walk(full)
      else if (/\.tsx?$/.test(name) && !full.endsWith('lib/musicLibrary.ts')) {
        const text = readFileSync(full, 'utf8')
        if (/\binstallMusicLibrary\s*\(/.test(text)) callers.push(full)
      }
    }
  }
  await walk('src')
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

stopMusic()
console.log(`\n${checked} checks, ${failed} failures`)
if (checked < 30) {
  console.log(`FAIL only ${checked} checks ran - the suite did not finish`)
  process.exit(1)
}
process.exit(failed === 0 ? 0 : 1)
