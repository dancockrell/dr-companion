/**
 * The Quick Queue driver, tested for the property that matters: items run
 * in order, exactly once, routed to the right hook by kind, and Stop
 * actually stops rather than merely reporting stopped while items keep
 * firing on the timer underneath it — the exact defect class flowDriver.ts
 * hit twice tonight, so it gets the same sabotage discipline here rather
 * than assuming a smaller class of code is exempt from the same bug.
 */
import { QueueDriver } from '../src/lib/queueDriver.ts'

let failed = 0
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(58)}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('-- items run in order, routed to the right hook by kind --')
{
  const commands = []
  const scripts = []
  const driver = new QueueDriver({
    sendCommand: (c) => commands.push(c),
    startScript: (s) => scripts.push(s),
    onChange: () => {},
    log: () => {},
  })
  driver.start([
    { id: '1', label: 'look', kind: 'command', value: 'look' },
    { id: '2', label: 'hunting-buddy', kind: 'script', value: 'hunting-buddy' },
    { id: '3', label: 'stance guarded', kind: 'command', value: 'stance guarded' },
  ])
  await wait(2200) // three items, 600ms floor each, plus margin
  ok('commands sent in order', commands, ['look', 'stance guarded'])
  ok('scripts started in order', scripts, ['hunting-buddy'])
  ok('finished after the last item', driver.current().status, 'done')
}

console.log('\n-- Stop halts before the remaining items ever fire --')
{
  const commands = []
  const driver = new QueueDriver({
    sendCommand: (c) => commands.push(c),
    startScript: () => {},
    onChange: () => {},
    log: () => {},
  })
  driver.start([
    { id: '1', label: 'a', kind: 'command', value: 'a' },
    { id: '2', label: 'b', kind: 'command', value: 'b' },
    { id: '3', label: 'c', kind: 'command', value: 'c' },
  ])
  await wait(50) // well before the first item's own 600ms timer fires
  driver.stop()
  await wait(2000) // long enough that b and c would have fired if Stop leaked
  ok('only the first item ever sent', commands, ['a'])
  ok('driver reports stopped', driver.current().status, 'stopped')
}

console.log('\n-- an empty queue does nothing, cleanly --')
{
  const changes = []
  const driver = new QueueDriver({
    sendCommand: () => { throw new Error('should never be called') },
    startScript: () => { throw new Error('should never be called') },
    onChange: (s) => changes.push(s),
    log: () => {},
  })
  driver.start([])
  ok('no state changes for an empty queue', changes, [])
  ok('stays idle', driver.current().status, 'idle')
}

console.log('\n-- dispose fully resets, and clears any pending timer --')
{
  const commands = []
  const driver = new QueueDriver({
    sendCommand: (c) => commands.push(c),
    startScript: () => {},
    onChange: () => {},
    log: () => {},
  })
  driver.start([
    { id: '1', label: 'a', kind: 'command', value: 'a' },
    { id: '2', label: 'b', kind: 'command', value: 'b' },
  ])
  await wait(50)
  driver.dispose()
  await wait(2000)
  ok('nothing further sent after dispose', commands, ['a'])
  ok('state fully reset', driver.current(), { status: 'idle', index: -1, total: 0 })
  ok('currentItem is null once disposed', driver.currentItem(), null)
}

console.log('\n-- a rejected command stops honestly and can retry in place --')
{
  const commands = []
  let rejectFirst = true
  const logs = []
  const driver = new QueueDriver({
    sendCommand: async (c) => {
      commands.push(c)
      if (rejectFirst) {
        rejectFirst = false
        throw new Error('connection closed')
      }
    },
    startScript: () => {},
    onChange: () => {},
    log: (line) => logs.push(line),
  }, 10)
  driver.start([
    { id: '1', label: 'look', kind: 'command', value: 'look' },
    { id: '2', label: 'health', kind: 'command', value: 'health' },
  ])
  await wait(30)
  ok('rejection enters failed state, never done', driver.current().status, 'failed')
  ok('item 2 did not run after item 1 failed', commands, ['look'])
  ok('failure reason remains available to the panel', driver.current().error, 'connection closed')
  ok('finished was not logged for a failed run', logs.includes('Queue: finished'), false)
  driver.retry()
  await wait(50)
  ok('retry repeats only the failed item, then continues', commands, ['look', 'look', 'health'])
  ok('retry can reach honest completion', driver.current().status, 'done')
}

console.log('\n-- Skip waives one failed item; Stop invalidates an in-flight continuation --')
{
  const commands = []
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const driver = new QueueDriver({
    sendCommand: async (c) => {
      commands.push(c)
      if (c === 'bad') throw new Error('refused')
      if (c === 'slow') await pending
    },
    startScript: () => {},
    onChange: () => {},
    log: () => {},
  }, 10)
  driver.start([
    { id: '1', label: 'bad', kind: 'command', value: 'bad' },
    { id: '2', label: 'next', kind: 'command', value: 'next' },
  ])
  await wait(20)
  driver.skip()
  await wait(40)
  ok('Skip continues without retrying the waived item', commands, ['bad', 'next'])
  ok('Skip can finish the remaining queue', driver.current().status, 'done')

  driver.start([
    { id: '3', label: 'slow', kind: 'command', value: 'slow' },
    { id: '4', label: 'must not run', kind: 'command', value: 'must not run' },
  ])
  await wait(10)
  driver.stop()
  release()
  await wait(40)
  ok('Stop prevents stale promise resolution from advancing', commands, ['bad', 'next', 'slow'])
  ok('stopped remains stopped after the promise resolves', driver.current().status, 'stopped')
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
