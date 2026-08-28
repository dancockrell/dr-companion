/**
 * The step-condition grammar, tested for the property that matters: a step
 * gated on the wrong state must not run, and one gated on the right state
 * must not be blocked by a typo or a moment with no data yet.
 */
import {
  evaluateCondition,
  contextFromCharacter,
  describeCondition,
  parseGaugeCondition,
  formatGaugeCondition,
} from '../src/lib/flowConditions.ts'
import { FlowDriver } from '../src/lib/flowDriver.ts'

let failed = 0
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(58)}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const CHAR = (over = {}) => ({
  vitals: { health: 80, healthMax: 100, spirit: 100, spiritMax: 100, fatigue: 50, fatigueMax: 100, mana: 0, manaMax: 0 },
  situation: [],
  ...over,
})

console.log('-- no condition is always true --')
{
  ok('undefined', evaluateCondition(undefined, contextFromCharacter(null)), true)
  ok('blank string', evaluateCondition('   ', contextFromCharacter(null)), true)
}

console.log('-- gauge comparisons, as a percent of max --')
{
  const ctx = contextFromCharacter(CHAR()) // health 80%, spirit 100%, fatigue 50%
  ok('health<90 true at 80%', evaluateCondition('health<90', ctx), true)
  ok('health<50 false at 80%', evaluateCondition('health<50', ctx), false)
  ok('health>50 true at 80%', evaluateCondition('health>50', ctx), true)
  ok('fatigue>=50 true at exactly 50%', evaluateCondition('fatigue>=50', ctx), true)
  ok('fatigue<=50 true at exactly 50%', evaluateCondition('fatigue<=50', ctx), true)
  ok('spirit<100 false at exactly 100%', evaluateCondition('spirit<100', ctx), false)
}

console.log('-- situation flags, bare and negated --')
{
  const bleeding = contextFromCharacter(CHAR({ situation: ['bleeding', 'stunned'] }))
  const clean = contextFromCharacter(CHAR({ situation: [] }))
  ok('bleeding true when present', evaluateCondition('bleeding', bleeding), true)
  ok('bleeding false when absent', evaluateCondition('bleeding', clean), false)
  ok('!bleeding true when absent', evaluateCondition('!bleeding', clean), true)
  ok('!stunned false when present', evaluateCondition('!stunned', bleeding), false)
}

console.log('-- negated gauge comparisons --')
{
  const ctx = contextFromCharacter(CHAR()) // health 80%
  ok('!health<50 true (80% is not under 50%)', evaluateCondition('!health<50', ctx), true)
  ok('!health<90 false (80% is under 90%)', evaluateCondition('!health<90', ctx), false)
}

console.log('-- fails open: no data, or a name that is not a real gauge --')
{
  // This is the property most likely to be missed: a condition the app
  // cannot evaluate must not silently stall the flow. It fails open, the
  // same as no condition — the alternative is a step that can never run
  // because the app was not connected the instant it was checked.
  const noCharacter = contextFromCharacter(null)
  ok('unresolvable gauge (no character) reads true', evaluateCondition('health<50', noCharacter), true)
  ok('unknown gauge name reads true', evaluateCondition('luck<50', contextFromCharacter(CHAR())), true)
  ok('mana with no max reads true (0/0 is not a real percent)', evaluateCondition('mana<50', contextFromCharacter(CHAR())), true)
}

console.log('-- describeCondition, for the tooltip and the editor --')
{
  ok('undefined has no description', describeCondition(undefined), null)
  ok('blank has no description', describeCondition('  '), null)
  ok('a real condition describes itself', describeCondition('health<50'), 'only while health<50')
}

console.log('-- parseGaugeCondition/formatGaugeCondition round-trip, for the editor slider --')
{
  ok('parses a plain comparison', parseGaugeCondition('health<50'), { negate: false, gauge: 'health', op: '<', value: 50 })
  ok('parses negated', parseGaugeCondition('!spirit>=80'), { negate: true, gauge: 'spirit', op: '>=', value: 80 })
  ok('a bare flag does not parse as a gauge', parseGaugeCondition('bleeding'), null)
  ok('an unknown gauge name does not parse', parseGaugeCondition('luck<50'), null)
  ok('undefined parses to null', parseGaugeCondition(undefined), null)
  // The property that actually matters for the slider: format(parse(x)) must
  // reproduce a condition `evaluateCondition` reads identically to the
  // original, or dragging the slider back to where it started would change
  // the flow's meaning without the player touching anything.
  for (const original of ['health<50', '!fatigue>=30', 'mana>0']) {
    const parsed = parseGaugeCondition(original)
    ok(`round-trips "${original}"`, formatGaugeCondition(parsed), original)
  }
}

const twoStep = {
  id: 't', title: 'Two step', summary: '', loops: true,
  steps: [
    { label: 'gated', commands: ['g'], condition: 'health<50' },
    { label: 'open', commands: ['o'] },
  ],
}

console.log('\n-- FlowDriver skips a step whose condition is false, without sending it --')
{
  const sent = []
  const logs = []
  const driver = new FlowDriver({
    send: (c) => { sent.push(c); return true },
    onChange: () => {},
    log: (l) => logs.push(l),
    evaluateCondition: (cond) => evaluateCondition(cond, contextFromCharacter({ vitals: { health: 90, healthMax: 100 }, situation: [] })),
  })
  driver.start(twoStep)
  ok('the gated step never sent', sent, [['o']])
  ok('the skip was logged, not silent', logs.some((l) => /skipping.*gated/i.test(l)), true)
}

console.log('\n-- FlowDriver sends the step once its condition is true --')
{
  const sent = []
  const driver = new FlowDriver({
    send: (c) => { sent.push(c); return true },
    onChange: () => {},
    log: () => {},
    evaluateCondition: (cond) => evaluateCondition(cond, contextFromCharacter({ vitals: { health: 20, healthMax: 100 }, situation: [] })),
  })
  driver.start(twoStep) // sends 'g' synchronously, schedules 'o' after the settle floor
  await new Promise((resolve) => setTimeout(resolve, 900))
  ok('both steps sent, gated one included', sent, [['g'], ['o']])
}

console.log('\n-- a loop where nothing can ever run fails loudly instead of hanging --')
{
  // The property this guards: a synchronous skip-chain has to be bounded.
  // Without the guard in push(), this exact fixture — a looping flow whose
  // only step is permanently gated false — recurses forever in one tick,
  // which is indistinguishable from a frozen tab from the outside.
  const neverRuns = {
    id: 'n', title: 'Never', summary: '', loops: true,
    steps: [{ label: 'stuck', commands: ['x'], condition: 'health<0' }],
  }
  const sent = []
  let finalStatus = null
  const driver = new FlowDriver({
    send: (c) => { sent.push(c); return true },
    onChange: (s) => { finalStatus = s.status },
    log: () => {},
    evaluateCondition: (cond) => evaluateCondition(cond, contextFromCharacter({ vitals: { health: 90, healthMax: 100 }, situation: [] })),
  })
  driver.start(neverRuns) // must return control, not hang the process
  ok('nothing was ever sent', sent, [])
  ok('the flow failed rather than looping silently', finalStatus, 'failed')
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
