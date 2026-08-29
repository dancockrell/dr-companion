/**
 * The channel/throttle decision behind playAlert() (see alertSound.ts's own
 * header), tested without an Audio constructor - alertGate() is the pure
 * half of that function, extracted specifically so this doesn't need a
 * browser the way the actual playback path does.
 *
 * What this has to prove, because it's exactly the thing that regressed
 * twice already in this file's history (28 Aug: a fight-long ding on a
 * 3-second clock; before that: four unrelated meanings sharing one sound):
 * a wounds-class line has to share ONE cooldown across every distinct sound
 * file in that class, while every other class keeps a separate cooldown per
 * sound file the way playAlert always worked.
 */
import { alertGate } from '../src/lib/alertGate.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- known classes land on the channel they used to mean --')
{
  ok('alert -> system', alertGate('Thunder.wav', 'alert').channel === 'system')
  ok('learning -> system', alertGate('Bird.wav', 'learning').channel === 'system')
  ok('danger -> danger', alertGate('Growl.wav', 'danger').channel === 'danger')
  ok('wounds -> danger', alertGate('Hit.wav', 'wounds').channel === 'danger')
  ok('speech -> speech', alertGate('Whisper.wav', 'speech').channel === 'speech')
}

console.log('\n-- an unrecognized or missing class refuses to guess loud --')
{
  // System is the conservative default - it's where the one alert that costs
  // a session (the idle warning) lives, so an unrecognized class should not
  // silently land somewhere a listener has muted on purpose.
  ok('no class -> system', alertGate('Foo.wav').channel === 'system')
  ok('unknown class -> system', alertGate('Foo.wav', 'nonsense').channel === 'system')
}

console.log('\n-- wounds shares one cooldown key across distinct sounds --')
{
  const a = alertGate('Hit.wav', 'wounds')
  const b = alertGate('OtherHit.wav', 'wounds')
  ok(
    'two different wounds sounds throttle on the same key',
    a.throttleKey === b.throttleKey && a.throttleKey === 'class:wounds',
    `${a.throttleKey} vs ${b.throttleKey}`
  )
  ok('the wounds throttle is the 30s class floor, not the 3s default', a.throttleMs === 30_000, `${a.throttleMs}ms`)
}

console.log('\n-- every other class keeps a per-sound-file cooldown --')
{
  const dangerA = alertGate('Growl.wav', 'danger')
  const dangerB = alertGate('Growl.wav', 'danger')
  const speech = alertGate('Whisper.wav', 'speech')
  ok('danger keys by sound file name', dangerA.throttleKey === 'Growl.wav', dangerA.throttleKey)
  ok('two calls with the same file+class agree on the key', dangerA.throttleKey === dangerB.throttleKey)
  ok('a different class with a different file gets its own key', speech.throttleKey === 'Whisper.wav', speech.throttleKey)
  ok('non-wounds classes use the short default floor', dangerA.throttleMs < 30_000, `${dangerA.throttleMs}ms`)
}

console.log('\n-- sabotage: a class missing from THROTTLE_MS_FOR_CLASS must not silently share a key --')
{
  // Danger and wounds are different classes and must never collapse onto
  // one throttle key just because they share the same underlying channel -
  // "a creature enters" and "you're bleeding" are two different facts and a
  // listener should hear both, the same reasoning PER_SOUND_MS's own header
  // gives for keying per sound rather than globally.
  const danger = alertGate('Growl.wav', 'danger')
  const wounds = alertGate('Growl.wav', 'wounds')
  ok(
    'danger and wounds never share a throttle key even with the same file',
    danger.throttleKey !== wounds.throttleKey,
    `${danger.throttleKey} vs ${wounds.throttleKey}`
  )
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
