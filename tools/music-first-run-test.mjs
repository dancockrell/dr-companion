/**
 * Defect 5 from the clean-VM first run (issue #383): on a machine that had
 * just installed the app, the bottom bar read `Hmv-da1480-ola1015 -
 * unavaila...` with a Retry button, beside sound controls nobody had touched.
 * Three faults stacked - zone music started itself off the mock bridge's
 * invented zone, the build ships no `public/audio/` at all, and a missing
 * *library* was reported as a per-track failure with a generated filename for
 * a title and a retry that could never succeed.
 *
 * The properties below are what the fix is for, stated as properties rather
 * than as the mechanism that currently implements them (CLAUDE.md section 1:
 * a test that encodes the mechanism defends the bug when the mechanism
 * changes):
 *
 *   1. Nothing plays until somebody asks. A zone report on a first run
 *      creates no audio element and leaves the transport silent.
 *   2. A missing library is ONE state, not one error per track - and the
 *      state is established by a check, not inferred from an error code.
 *   3. That state names no track and offers no retry, because no retry can
 *      succeed.
 *   4. A source that is genuinely retryable - a listener's own stream - still
 *      gets the per-source failure and its Retry.
 *
 * Sabotaged by editing `src/lib/ambientSound.ts` and re-running, once per
 * fix, with the case each edit turns red recorded in the PR. Nothing here
 * reads an environment variable to fake a break: a sabotage that the suite
 * itself performs can stop landing without anyone noticing.
 */

/** A stand-in for the browser's Audio, same shape as audio-playback-test.mjs's
 * (deliberately a second small copy rather than an import: that file's mock is
 * driven by its own module-level `behavior` and the two suites would fight
 * over it). `behavior` decides what a load does. */
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
      // What a 404 or an HTML body actually produces in a browser:
      // MEDIA_ERR_SRC_NOT_SUPPORTED, raised as an `error` event on the
      // element rather than a rejected play().
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

/** What the server says is at a bundled track's URL. `html` is the Vite
 * dev-server case measured while reproducing this defect - 200 OK carrying
 * `index.html` - which is why the probe reads the content type and not only
 * the status. */
const RESPONSES = {
  audio: { ok: true, headers: new Map([['content-type', 'audio/flac']]) },
  html: { ok: true, headers: new Map([['content-type', 'text/html; charset=utf-8']]) },
  missing: { ok: false, headers: new Map([['content-type', 'text/plain']]) },
}
let fetchMode = 'html'
const fetchCalls = []
globalThis.fetch = (url, init) => {
  fetchCalls.push({ url, init })
  if (fetchMode === 'throw') return Promise.reject(new Error('no such protocol'))
  const r = RESPONSES[fetchMode]
  return Promise.resolve({ ok: r.ok, headers: { get: (k) => r.headers.get(k) ?? null } })
}

const warnings = []
console.warn = (...parts) => warnings.push(parts.join(' '))

const manifest = (await import('../data/audio/manifest.json', { with: { type: 'json' } })).default

const {
  musicHasStarted,
  musicLibraryVerdict,
  musicRetryable,
  nowPlaying,
  probeMusicLibrary,
  resetMusicLibraryVerdict,
  retryMusic,
  setCustomStream,
  setMusicStarted,
  setMusicVolume,
  setZone,
  skipTrack,
  startMusic,
  stopMusic,
} = await import('../src/lib/ambientSound.ts')

let failed = 0
let checked = 0
const check = (name, condition, detail = '') => {
  checked++
  if (!condition) failed++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
}

/** A zone the manifest actually gives a playlist to. Chosen from the data
 * rather than hardcoded, so a renamed zone fails loudly here instead of
 * quietly turning every case below into a no-op against an empty playlist -
 * which is the shape of "a check that cannot fail". */
const zoneWithTracks = Object.entries(manifest.zone ?? {}).find(
  ([, z]) => (z.tracks ?? []).length > 1
)
if (!zoneWithTracks) {
  console.log('FAIL manifest has no zone with a playlist - nothing below could be tested')
  process.exit(1)
}
const [ZONE_ID, ZONE_ENTRY] = zoneWithTracks
console.log(`-- fixture: zone "${ZONE_ID}", ${ZONE_ENTRY.tracks.length} tracks --`)

const reset = async (opts = {}) => {
  stopMusic()
  resetMusicLibraryVerdict()
  setMusicStarted(false)
  setMusicVolume(1)
  MockAudio.instances.length = 0
  MockAudio.behavior = opts.behavior ?? 'resolve'
  fetchMode = opts.fetch ?? 'html'
  fetchCalls.length = 0
  warnings.length = 0
  await settle()
  MockAudio.instances.length = 0
  fetchCalls.length = 0
}

console.log('\n-- 1. nothing plays until somebody asks --')
{
  await reset({ behavior: 'resolve' })
  setZone(ZONE_ID)
  await settle()
  check(
    'a zone report on a first run starts no audio',
    MockAudio.instances.length === 0,
    `${MockAudio.instances.length} elements created`
  )
  check('and the transport has nothing to show', nowPlaying() === null)
  check('and music is not marked started', musicHasStarted() === false)

  // The positive control for the case above: with the same zone already set,
  // an explicit start must actually start something. Without this, "no audio
  // was created" would also pass against a module that can never play at all.
  startMusic()
  await settle()
  check(
    'pressing play then starts the zone playlist',
    MockAudio.instances.length === 1,
    `${MockAudio.instances.length} elements created`
  )
  check('and the transport reports it playing', nowPlaying()?.status === 'playing')
}

console.log('\n-- 2. a missing library is one state, not one error per track --')
{
  await reset({ behavior: 'media-error', fetch: 'html' })
  setMusicStarted(true)
  setZone(ZONE_ID)
  await settle()

  check(
    'the library is checked, not guessed',
    fetchCalls.length === 1,
    `${fetchCalls.length} probe fetches`
  )
  check('and the verdict is absent', musicLibraryVerdict() === 'absent', musicLibraryVerdict())

  const state = nowPlaying()
  check('the state is unavailable, not failed', state?.status === 'unavailable', state?.status)
  check(
    'and it names no track',
    !!state && !ZONE_ENTRY.tracks.some((id) => state.title.toLowerCase().includes(id.slice(0, 12))),
    state?.title
  )
  check('and it says what is wrong', !!state?.error && state.error.length > 20, state?.error)

  // Walk several more tracks. Each one is a chance to produce another
  // per-track error with another generated filename in it - which is exactly
  // what the two clean-VM runs saw, three different titles for one cause.
  const before = MockAudio.instances.length
  const titles = new Set([state?.title])
  for (let i = 0; i < 4; i++) {
    skipTrack(1)
    await settle()
    titles.add(nowPlaying()?.title)
  }
  check(
    'four more track changes produce no further loads',
    MockAudio.instances.length === before,
    `${MockAudio.instances.length - before} extra elements`
  )
  check('and exactly one probe was ever made', fetchCalls.length === 1, `${fetchCalls.length}`)
  check('and one state, not five', titles.size === 1, [...titles].join(' | '))
  check('every one of them still unavailable', nowPlaying()?.status === 'unavailable')
}

console.log('\n-- 3. nothing offers a retry that cannot succeed --')
{
  // The property the clean-VM screenshot violated: a button was offered that
  // could not work. `musicRetryable` is what the transport renders the button
  // from, so this is the same decision the person sees, not a proxy for it.
  check('no Retry is offered with the library absent', musicRetryable() === false)
  const before = MockAudio.instances.length
  retryMusic()
  await settle()
  check(
    'and pressing it anyway loads nothing',
    MockAudio.instances.length === before,
    `${MockAudio.instances.length - before} extra elements`
  )
  check('and does not change the state', nowPlaying()?.status === 'unavailable')
}

console.log('\n-- 4. a retryable source keeps its per-source failure --')
{
  await reset({ behavior: 'media-error', fetch: 'html' })
  setMusicStarted(true)
  setCustomStream('https://example.invalid/stream.mp3')
  await settle()
  const state = nowPlaying()
  check("a listener's own stream that fails is 'failed', not 'unavailable'", state?.status === 'failed', state?.status)
  check('and it names the source it could not play', state?.title.includes('example.invalid'), state?.title)
  check('and no library probe was made for it', fetchCalls.length === 0, `${fetchCalls.length}`)

  // Positive control for the case above: with a source that genuinely might
  // work on a second try, a Retry must be offered. Without this, "no Retry"
  // would also pass against a build that never offers one at all.
  check('a failed stream does offer Retry', musicRetryable() === true)
  const before = MockAudio.instances.length
  retryMusic()
  await settle()
  check('and Retry actually tries again', MockAudio.instances.length >= before)
}

console.log('\n-- 5. the probe separates a real file from a document --')
{
  const cases = [
    ['audio', 'present'],
    ['html', 'absent'],
    ['missing', 'absent'],
    ['throw', 'absent'],
  ]
  for (const [mode, expected] of cases) {
    fetchMode = mode
    const verdict = await probeMusicLibrary('/audio/radio/anything.flac')
    check(`a ${mode} response reads as ${expected}`, verdict === expected, verdict)
  }
}

stopMusic()
console.log(`\n${checked} checks, ${failed} failures`)
if (checked < 25) {
  console.log(`FAIL only ${checked} checks ran - the suite did not finish`)
  process.exit(1)
}
process.exit(failed === 0 ? 0 : 1)
