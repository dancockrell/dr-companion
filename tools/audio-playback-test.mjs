/** Browser-media failures exercised in Node with a small Audio stand-in. */
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
    if (MockAudio.behavior === 'reject') {
      const error = new Error('blocked')
      error.name = 'NotAllowedError'
      return Promise.reject(error)
    }
    if (MockAudio.behavior === 'resolve') {
      queueMicrotask(() => this.dispatchEvent(new Event('playing')))
    }
    return Promise.resolve()
  }

  pause() {
    this.paused = true
  }
}

globalThis.Audio = MockAudio
globalThis.HTMLAudioElement = MockAudio

const warnings = []
const originalWarn = console.warn
console.warn = (...parts) => warnings.push(parts.join(' '))

const {
  musicVolume,
  nowPlaying,
  pauseMusic,
  retryMusic,
  resumeMusic,
  setCrossfadeStyle,
  setCustomStream,
  setMusicVolume,
  stopMusic,
} = await import('../src/lib/ambientSound.ts')

let failed = 0
const check = (name, condition, detail = '') => {
  if (!condition) failed++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

console.log('-- playback state follows the media element --')
MockAudio.behavior = 'reject'
setCustomStream('https://user:secret@example.invalid/private-radio?token=hidden')
await settle()
check('a rejected play promise becomes failed, never playing', nowPlaying()?.status === 'failed')
check('the failure explains how to recover', nowPlaying()?.error?.includes('Retry'))
check('diagnostics do not leak a private source URL', warnings.every((line) => !line.includes('secret') && !line.includes('token=')))

console.log('\n-- Retry can recover without rebuilding the selection --')
const failedElement = MockAudio.instances.at(-1)
MockAudio.behavior = 'resolve'
retryMusic()
await settle()
check('Retry reuses the selected media element', MockAudio.instances.at(-1) === failedElement)
check('a confirmed playing event clears the prior failure', nowPlaying()?.status === 'playing' && !nowPlaying()?.error)

console.log('\n-- Pause freezes the media element and Resume is observable --')
setCrossfadeStyle('cut')
setMusicVolume(0.6)
pauseMusic()
await wait(650)
check('Pause reaches the media element after the fade', failedElement.paused === true)
check('the pause fade reaches silence', musicVolume() === 0, String(musicVolume()))

resumeMusic()
await settle()
await wait(650)
check('Resume continues the same media element', MockAudio.instances.at(-1) === failedElement && failedElement.paused === false)
check('Resume restores the exact pre-pause gain', Math.abs(musicVolume() - 0.6) < 0.001, String(musicVolume()))

pauseMusic()
resumeMusic()
await wait(650)
check('a quick Pause/Resume cannot leave a stale timer that pauses later', failedElement.paused === false)

pauseMusic()
await wait(650)
MockAudio.behavior = 'reject'
resumeMusic()
await settle()
check('a rejected Resume becomes a visible playback failure', nowPlaying()?.status === 'failed' && nowPlaying()?.error?.includes('Retry'))

MockAudio.behavior = 'resolve'
retryMusic()
await settle()
setMusicVolume(0.6)
pauseMusic()
stopMusic()
setCustomStream('https://example.invalid/after-reset')
await settle()
const afterReset = MockAudio.instances.at(-1)
await wait(650)
check('Stop cancels a pending pause before a new source starts', afterReset.paused === false)

console.log('\n-- media errors and stalls are visible failures --')
MockAudio.behavior = 'pending'
setCustomStream('https://example.invalid/broken-file')
const broken = MockAudio.instances.at(-1)
broken.error = { code: 3 }
broken.dispatchEvent(new Event('error'))
check('a media decode error is categorized and visible', nowPlaying()?.status === 'failed' && nowPlaying()?.error?.includes('decoded'))

setCustomStream('https://example.invalid/stalled-stream')
const stalled = MockAudio.instances.at(-1)
stalled.dispatchEvent(new Event('stalled'))
check('a stalled custom stream does not claim to be playing', nowPlaying()?.status === 'failed' && nowPlaying()?.error?.includes('stalled'))

MockAudio.behavior = 'resolve'
retryMusic()
await settle()
check('a stalled stream can recover through the same Retry', nowPlaying()?.status === 'playing')

const transport = await import('node:fs').then(({ readFileSync }) =>
  readFileSync('src/components/game/MusicTransport.tsx', 'utf8')
)
check('the shared transport renders a visible Retry action', transport.includes('failed &&') && />\s*Retry\s*</.test(transport))

stopMusic()
console.warn = originalWarn
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
