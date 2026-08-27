/**
 * The whole chain, over a real socket: fixture, TCP, parser, lines.
 *
 *   node tools/link-test.mjs
 *
 * `stream-test.mjs` proves the parser against strings. This proves it against
 * a network, which is a different claim: the socket decides where the bytes
 * break, and every interesting failure in this layer is about a boundary
 * falling somewhere the code did not expect.
 *
 * It starts the fixture in its tagged, split-across-reads mode - the mode that
 * cuts each payload inside a tag - because that is what a real connection does
 * constantly and what no string-based test can produce.
 *
 * Tauri is not involved. The Rust side reads bytes and emits them; this stands
 * in for that so the chain can be tested without a desktop app, and the piece
 * it cannot cover is stated at the bottom rather than glossed.
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { newStreamState, feed, looksTagged } from '../src/lib/gameStream.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${detail}`)
}

const PORT = 11731 // Not 11024: a real Lich or the other fixture may hold that.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fixture = spawn(
  process.execPath,
  ['tools/fake-lich.mjs', '--port', String(PORT), '--speed', '40', '--tagged', '--split'],
  { stdio: ['ignore', 'ignore', 'pipe'] }
)

let fixtureErr = ''
fixture.stderr.on('data', (d) => (fixtureErr += d.toString()))

try {
  // Wait for it to listen rather than sleeping a guessed amount.
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(50)
    up = /listening on/.test(fixtureErr)
  }
  ok('the fixture is listening', up, up ? `port ${PORT}` : fixtureErr.slice(0, 80))
  if (!up) throw new Error('fixture never came up')

  const state = newStreamState()
  const lines = []
  let sawTags = false

  const sock = connect(PORT, '127.0.0.1')
  sock.setNoDelay(true)

  await new Promise((resolve, reject) => {
    sock.on('error', reject)
    sock.on('connect', resolve)
  })

  sock.on('data', (chunk) => {
    const text = chunk.toString('utf8')
    if (looksTagged(text)) sawTags = true
    // Exactly what the app does: whatever arrived, in whatever size, straight
    // into the parser. No line splitting before this point, which is the
    // entire design decision being tested.
    lines.push(...feed(state, text))
  })

  // Long enough for a full pass of the fixture at 40x.
  await sleep(2500)
  sock.destroy()

  ok('bytes arrived tagged', sawTags)
  ok('lines came out', lines.length > 8, `${lines.length} lines`)

  // The denominator: every assertion below is trivially true of an empty list,
  // and an empty list is exactly what a broken parser produces.
  const streams = [...new Set(lines.map((l) => l.stream).filter(Boolean))].sort()
  ok('the game labelled its own channels', streams.length >= 3, streams.join(', '))
  ok('thoughts arrived as a stream', streams.includes('thoughts'))
  ok('death arrived as a stream', streams.includes('death'))
  ok('speech arrived as a stream', streams.includes('talk'))

  // The room title is bold and is main-window text, not a stream.
  const title = lines.find((l) => l.text.includes('Firulf Vista'))
  ok('the room title survived', !!title, title?.text ?? 'missing')
  ok('and it is bold', title?.bold === true)
  ok('and it is not in a stream', title?.stream === '')

  // No tag ever reached the text. This is the failure a line-first design
  // produces, and it produces it constantly under --split.
  const leaked = lines.filter((l) => /<\/?[a-zA-Z]/.test(l.text))
  ok('no markup leaked into the text', leaked.length === 0, leaked[0]?.text ?? '')

  // Entities decoded, including in a stream.
  const said = lines.find((l) => l.stream === 'talk')
  ok('entities are decoded inside a stream', said?.text.includes('"Well met."'), said?.text ?? '')

  // Prompts cost nothing.
  ok('no prompt text in the output', !lines.some((l) => l.text.trim() === '>'))

  // And a command reaches the other end, which is the half a read-only test
  // would miss entirely.
  const back = connect(PORT, '127.0.0.1')
  await new Promise((r) => back.on('connect', r))
  const replies = []
  back.on('data', (d) => replies.push(d.toString('utf8')))
  back.write('look\r\n')
  await sleep(400)
  back.destroy()
  ok('a command was answered', replies.join('').includes('Firulf Vista'), replies.join('').slice(0, 60))
} catch (e) {
  ok('the chain ran', false, String(e.message))
} finally {
  fixture.kill()
}

// Stated rather than implied: what this cannot see.
//
// The Rust reader is not in this chain. It is unit-tested separately for the
// two things that matter there - keeping blank lines and surviving a byte that
// is not UTF-8 - but nothing here proves the Tauri event boundary preserves a
// chunk. That needs the app running and a person to press Attach.
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
