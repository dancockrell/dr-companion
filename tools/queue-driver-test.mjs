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

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
