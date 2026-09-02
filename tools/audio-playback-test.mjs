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
  nowPlaying,
  retryMusic,
  setCustomStream,
  stopMusic,
} = await import('../src/lib/ambientSound.ts')

let failed = 0
const check = (name, condition, detail = '') => {
  if (!condition) failed++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

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
