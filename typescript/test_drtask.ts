/**
 * drtask.ts against fixed strings and a fake Companion - no live app or even
 * a fake TCP server needed, since `Task.feed`'s parsing is a plain function
 * of a string and `do()`/rate-limiting only needs something with `send()`.
 *
 * Run with:
 *
 *     node --experimental-strip-types typescript/test_drtask.ts
 */

import { EventEmitter } from 'node:events'
import { MAX_COMMANDS_PER_MINUTE, RateLimited, stripTags, Task, Vital, type CleanLine } from './drtask.ts'

let failed = 0
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)}${detail}`)
  if (!cond) failed++
}

/** Enough of Companion's surface for Task: records sent commands, and lets
 * the test push lines in directly via the same 'line' event Task listens
 * for - it does not need a real socket underneath it. */
class FakeCompanion extends EventEmitter {
  sent: string[] = []
  async connect(): Promise<void> {}
  async send(command: string): Promise<void> {
    this.sent.push(command)
  }
  close(): void {}
  feed(text: string, seq = 0): void {
    this.emit('line', { seq, text })
  }
}

async function testVital(): Promise<void> {
  const known = new Vital(30, 100)
  ok('Vital.percent computes percent', Math.abs(known.percent - 30) < 1e-9)

  const unknown = new Vital(0, 0, false)
  ok('Vital.percent is NaN when unknown', Number.isNaN(unknown.percent))
  ok('NaN < 50 is false - a condition on it does nothing', !(unknown.percent < 50))
  ok('NaN > 50 is false too, both directions fail closed', !(unknown.percent > 50))

  const zeroMax = new Vital(0, 0, true)
  ok('Vital.percent does not divide by zero for a known-but-empty max', Number.isNaN(zeroMax.percent))
}

function testStripTags(): void {
  ok("stripTags removes a tag and keeps its content", stripTags("<d cmd='east'>east</d>") === 'east')
  ok('stripTags decodes entities, &amp; last', stripTags('a &amp;lt; b') === 'a &lt; b')
}

async function testFeed(): Promise<void> {
  const fake = new FakeCompanion()
  const clean: CleanLine[] = []
  const vitalsSeen: unknown[] = []

  class T extends Task {
    onClean(line: CleanLine): void {
      clean.push(line)
    }
    onVitals(v: Record<string, Vital>): void {
      vitalsSeen.push({ ...v })
    }
  }
  const task = new T(fake as unknown as import('./dr_companion.ts').Companion)

  // Drive run()'s wiring manually rather than calling run() (which awaits a
  // real connect()) - feed() is the private method under test, reached the
  // same way run() reaches it: a 'line' event.
  fake.on('line', (l: { seq: number; text: string }) => (task as unknown as { feed: (l: unknown) => void }).feed(l))

  fake.feed("<pushStream id='thoughts'/>hello there<popStream/>")
  ok('a stream-tagged line reports its channel', clean.length === 1 && clean[0].stream === 'thoughts', JSON.stringify(clean))
  ok('tags are stripped from the clean text', clean[0]?.text === 'hello there')

  fake.feed("<progressBar id='health' value='0' text='health 87/100'/>")
  ok('a progressBar line updates vitals and fires onVitals', vitalsSeen.length === 1, JSON.stringify(vitalsSeen))
  ok('the vital is read from text, not value', task.vitals.health?.current === 87 && task.vitals.health?.max === 100)

  fake.feed("<roundTime value='1000'/>")
  ok('roundTime sets roundtimeUntil from the epoch value', task.roundtimeUntil === 1_000_000)

  fake.feed('   ')
  ok('a line with nothing left after stripping fires no onClean', clean.length === 1)
}

async function testRateCap(): Promise<void> {
  const fake = new FakeCompanion()
  class T extends Task {}
  const task = new T(fake as unknown as import('./dr_companion.ts').Companion)

  for (let i = 0; i < MAX_COMMANDS_PER_MINUTE; i++) {
    await task.do('look', { waitRt: false })
  }
  ok(`sending exactly ${MAX_COMMANDS_PER_MINUTE} commands succeeds`, fake.sent.length === MAX_COMMANDS_PER_MINUTE)

  let threw = false
  try {
    await task.do('look', { waitRt: false })
  } catch (e) {
    threw = e instanceof RateLimited
  }
  ok('the next command over the cap throws RateLimited', threw)
}

async function main(): Promise<number> {
  await testVital()
  testStripTags()
  await testFeed()
  await testRateCap()

  if (failed) {
    console.log(`\n${failed} check(s) FAILED`)
    return 1
  }
  console.log('\nall checks OK')
  return 0
}

main().then((code) => process.exit(code))
