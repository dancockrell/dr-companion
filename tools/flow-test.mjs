/**
 * The flow runner, tested where it actually matters.
 *
 * Not "does it advance" — the interesting cases are the ones that would look
 * like a hang to a player: what a looping flow does on its fortieth pass, what
 * Stop does when it lands between steps, and whether a failure stops the
 * sequence or quietly runs the rest against a state they were not written for.
 */
import {
  advance,
  begin,
  currentStep,
  describeFlow,
  fail,
  isFinished,
  pause,
  resume,
  stop,
} from '../src/lib/flowRunner.ts'
import { DEFAULT_FLOWS } from '../src/data/taskFlows.ts'
import { FlowDriver } from '../src/lib/flowDriver.ts'
import {
  onStopAll,
  requestStopAll,
  onPauseAll,
  requestPauseAll,
  onResumeAll,
  requestResumeAll,
} from '../src/lib/flowStop.ts'

let failed = 0
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`
  )
}

const finite = { id: 'f', title: 'Finite', summary: '', steps: [
  { label: 'one', commands: ['a'] },
  { label: 'two', commands: ['b'] },
]}
const looping = { ...finite, id: 'l', title: 'Looping', loops: true }

const run = (s, n) => { for (let i = 0; i < n; i++) s = advance(s); return s }

console.log('-- a finite flow ends, and ending is a state --')
{
  let s = begin(finite)
  ok('starts on the first step', currentStep(s).label, 'one')
  s = advance(s)
  ok('moves to the second', currentStep(s).label, 'two')
  s = advance(s)
  ok('is done', s.status, 'done')
  ok('has no current step', currentStep(s), null)
  ok('further advances change nothing', advance(s).status, 'done')
}

console.log('\n-- a looping flow returns to the start and counts passes --')
{
  let s = begin(looping)
  s = run(s, 2)
  ok('back to the first step', currentStep(s).label, 'one')
  ok('one pass done', s.pass, 1)
  s = run(s, 78)
  ok('fortieth pass, still running', s.status, 'running')
  ok('pass count is right', s.pass, 40)
  ok('steps sent counted', s.sent, 80)
}

console.log('\n-- Stop wins from anywhere --')
{
  ok('mid-flow', stop(advance(begin(looping))).status, 'stopped')
  ok('on the first step', stop(begin(finite)).status, 'stopped')
  ok('a stopped flow does not advance', advance(stop(begin(looping))).status, 'stopped')
  ok('a stopped flow has no step', currentStep(stop(begin(looping))), null)
  // The one that matters for an endless flow: Stop has to beat the loop.
  let s = begin(looping)
  s = run(s, 500)
  ok('still stoppable after 500 steps', stop(s).status, 'stopped')
}

console.log('\n-- Pause holds, Resume continues from the same step --')
{
  const midFlow = advance(begin(looping)) // on step two, pass 0
  const paused = pause(midFlow)
  ok('pause holds the flow', paused.status, 'paused')
  ok('pause keeps the step it was on', paused.step, midFlow.step)
  ok('a paused flow does not advance', advance(paused).status, 'paused')
  // Unlike done/stopped/failed, paused is not a "nothing left" state — it is
  // holding one specific step, and FlowDriver.resume() reads exactly this
  // value, while status is still 'paused', to know what to re-arm the wait
  // for. Returning null here would silently break resume().
  ok('a paused flow still reports the step it is held on', currentStep(paused)?.label, 'two')
  ok('resume carries on', resume(paused).status, 'running')
  ok('resume lands back on the held step', resume(paused).step, midFlow.step)
  ok('resuming something not paused changes nothing', resume(midFlow), midFlow)
  ok('pausing something already finished changes nothing', pause(stop(begin(finite))).status, 'stopped')
  ok('pausing something already paused changes nothing', pause(paused), paused)
  ok('the progress line says paused', describeFlow(paused), 'two (2 of 2), pass 1 — paused')
}

console.log('\n-- a failure stops the sequence rather than skipping on --')
{
  const s = fail(advance(begin(looping)), 'the bridge refused')
  ok('status', s.status, 'failed')
  ok('carries the reason', s.reason, 'the bridge refused')
  ok('does not keep looping', advance(s).status, 'failed')
  ok('a done flow cannot be failed after the fact', fail(run(begin(finite), 2), 'x').status, 'done')
  ok('a stopped flow keeps its status', fail(stop(begin(finite)), 'x').status, 'stopped')
}

console.log('\n-- the progress line says which part of the loop it is in --')
{
  ok('finite', describeFlow(begin(finite)), 'one (1 of 2)')
  ok('looping shows the pass', describeFlow(run(begin(looping), 2)), 'one (1 of 2), pass 2')
  ok('stopped', describeFlow(stop(begin(finite))), 'Finite — stopped')
  ok('done', describeFlow(run(begin(finite), 2)), 'Finite — done')
  ok('failed carries why', describeFlow(fail(begin(finite), 'no route')), 'Finite — stopped: no route')
}

console.log('\n-- isFinished agrees with the statuses --')
{
  ok('running is not finished', isFinished(begin(finite)), false)
  ok('done is', isFinished(run(begin(finite), 2)), true)
  ok('stopped is', isFinished(stop(begin(finite))), true)
  ok('failed is', isFinished(fail(begin(finite), 'x')), true)
}

console.log('\n-- the shipped flows are well formed --')
{
  ok('ids are unique', new Set(DEFAULT_FLOWS.map((f) => f.id)).size, DEFAULT_FLOWS.length)
  const empty = DEFAULT_FLOWS.filter((f) => !f.steps.length)
  ok('none is empty', empty.length, 0)
  const noCmd = DEFAULT_FLOWS.flatMap((f) => f.steps).filter((s) => !s.commands.length)
  ok('every step sends something', noCmd.length, 0)
  const unlabelled = DEFAULT_FLOWS.flatMap((f) => f.steps).filter((s) => !s.label)
  ok('every step is labelled', unlabelled.length, 0)
  // An endless flow that does not say so is the trap this replaces.
  const endless = DEFAULT_FLOWS.filter((f) => f.loops)
  ok('every looping flow says so in its summary',
    endless.every((f) => /repeat|until you stop/i.test(f.summary)), true)
  // Every finite flow must actually terminate when run.
  const runs = DEFAULT_FLOWS.filter((f) => !f.loops)
    .map((f) => run(begin(f), f.steps.length).status)
  ok('every finite flow reaches done', [...new Set(runs)], ['done'])
}

console.log('\n-- Stop all reaches a running flow driver, not just its own button --')
{
  // The property that matters: after Stop all fires, no further step goes
  // out. Asserting "the driver has a stop method" would pass on a wiring
  // that calls the wrong thing, or nothing at all, at the exact moment that
  // matters — the driver's own timer firing on schedule regardless.
  const sent = []
  const driver = new FlowDriver({
    send: (commands) => { sent.push(commands); return true },
    onChange: () => {},
    log: () => {},
  })
  const unsub = onStopAll(() => driver.stop())
  driver.start(looping) // sends step 'one' synchronously, schedules 'two'
  requestStopAll()
  await new Promise((resolve) => setTimeout(resolve, 900)) // past the 600ms settle floor
  unsub()
  ok('driver reports stopped', driver.current()?.status, 'stopped')
  ok('no step sent after Stop all', sent, [['a']])
}

console.log('\n-- an unsubscribed driver does not react to a later Stop all --')
{
  // Confirms unsubscribe (on unmount, in TaskFlowPanel) actually detaches —
  // a leftover subscription would stop a flow driver whose panel is gone,
  // which is a different bug in the same neighbourhood.
  const sent = []
  const driver = new FlowDriver({
    send: (commands) => { sent.push(commands); return true },
    onChange: () => {},
    log: () => {},
  })
  const unsub = onStopAll(() => driver.stop())
  unsub()
  driver.start(looping)
  requestStopAll()
  // 'waiting' (not 'stopped') is the point: start() sends step one and moves
  // straight to waiting out its settle time, so this is the same status an
  // untouched, still-running flow would show at this instant.
  ok('kept going: unsubscribed driver ignores Stop all', driver.current()?.status, 'waiting')
}

console.log('\n-- Pause all reaches a running flow driver, and holds the timer --')
{
  // The property: once paused, no further step is sent even after the
  // settle window that would otherwise have fired one — a flag the timer
  // ignores would pass "driver reports paused" while still sending.
  const sent = []
  const driver = new FlowDriver({
    send: (commands) => { sent.push(commands); return true },
    onChange: () => {},
    log: () => {},
  })
  const unsub = onPauseAll(() => driver.pause())
  driver.start(looping) // sends step 'one' synchronously, schedules 'two'
  requestPauseAll()
  await new Promise((resolve) => setTimeout(resolve, 900)) // past the 600ms settle floor
  unsub()
  ok('driver reports paused', driver.current()?.status, 'paused')
  ok('no step sent while paused', sent, [['a']])
}

console.log('\n-- Resume all continues from the held step, not from the start --')
{
  const sent = []
  const driver = new FlowDriver({
    send: (commands) => { sent.push(commands); return true },
    onChange: () => {},
    log: () => {},
  })
  const unsubPause = onPauseAll(() => driver.pause())
  const unsubResume = onResumeAll(() => driver.resume())
  driver.start(looping) // sends 'one' ['a'], schedules 'two'
  requestPauseAll()
  ok('paused before resuming', driver.current()?.status, 'paused')
  requestResumeAll()
  ok('resumed, still on the held step, not resent', sent, [['a']])
  ok('driver is waiting out the held step again, not re-running from the top', driver.current()?.status, 'waiting')
  await new Promise((resolve) => setTimeout(resolve, 900)) // let the re-armed wait fire
  unsubPause()
  unsubResume()
  ok('the next step went out exactly once, after resuming', sent, [['a'], ['b']])
}

console.log('\n-- Resume with nothing paused is a no-op that says so --')
{
  const logs = []
  const driver = new FlowDriver({ send: () => true, onChange: () => {}, log: (line) => logs.push(line) })
  driver.start(looping)
  const before = driver.current()
  driver.resume()
  ok('state is unchanged', driver.current(), before)
  ok('the log says nothing was paused, rather than staying silent',
    logs.some((l) => /nothing is paused/i.test(l)), true)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
