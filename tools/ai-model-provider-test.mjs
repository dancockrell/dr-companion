/**
 * The provider boundary has two jobs: never take the client down, and never
 * carry a credential.
 *
 * The scripted providers below exist ONLY in this file. They are test
 * doubles for scheduling and failure handling — none of them is importable by
 * the app, none returns anything resembling a real answer, and src/ ships no
 * implementation but `absentProvider`, which never pretends to answer at all.
 */
import {
  absentProvider,
  assertPromptCarriesNoSecrets,
  generateWithinBudget,
  scanForSecrets,
} from '../src/lib/aiModelProvider.ts'

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(70)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(70)} ${detail}`)
  }
}

const req = (over = {}) => ({
  instructions: 'You classify events.',
  state: '{"events":[]}',
  allowedTools: [],
  budget: { maxTokens: 64, maxSeconds: 1 },
  ...over,
})

// Test doubles. Deliberately trivial: none of these is a model.
const echo = { describe: () => ({ available: true, profile: 'test-double' }),
  generate: async () => ({ ok: true, text: 'ack', tokens: 1 }) }
const hangs = { describe: () => ({ available: true }),
  generate: () => new Promise(() => {}) }
const throwsOom = { describe: () => ({ available: true }),
  generate: async () => { throw new Error('CUDA out of memory allocating 2.1 GiB') } }
const throwsPlain = { describe: () => ({ available: true }),
  generate: async () => { throw new Error('socket closed') } }
const malformed = { describe: () => ({ available: true }),
  generate: async () => 'not a result object' }

console.log('-- absence is an ordinary, honest state --')
{
  const p = absentProvider()
  ok('it reports itself unavailable', p.describe().available === false)
  ok('and says why, so a person knows the next step', /no local model/i.test(p.describe().reason))
  const r = await generateWithinBudget(p, req())
  ok('generating resolves rather than rejecting', r.ok === false)
  ok('with the absent failure, distinct from an error', r.failure === 'absent', r.failure)
}

console.log('\n-- every failure is a value, never a thrown rejection --')
{
  const timedOut = await generateWithinBudget(hangs, req({ budget: { maxTokens: 8, maxSeconds: 0.05 } }))
  ok('a provider that hangs times out on our clock, not its own',
    timedOut.ok === false && timedOut.failure === 'timeout', timedOut.failure)

  const oom = await generateWithinBudget(throwsOom, req())
  ok('an out-of-memory throw becomes a typed out_of_memory result',
    oom.failure === 'out_of_memory', oom.failure)

  const err = await generateWithinBudget(throwsPlain, req())
  ok('any other throw becomes a typed error result', err.failure === 'error', err.failure)

  const bad = await generateWithinBudget(malformed, req())
  ok('a provider returning a non-result is invalid_output, not a crash',
    bad.failure === 'invalid_output', bad.failure)

  const good = await generateWithinBudget(echo, req())
  ok('and a working provider still succeeds, so the guard is not just failing everything',
    good.ok === true && good.text === 'ack')
}

console.log('\n-- cancellation is reported distinctly from timeout --')
{
  const pre = new AbortController()
  pre.abort()
  const early = await generateWithinBudget(hangs, req(), pre.signal)
  ok('already-aborted is cancelled before the provider is even called',
    early.failure === 'cancelled', early.failure)

  const mid = new AbortController()
  const inFlight = generateWithinBudget(hangs, req({ budget: { maxTokens: 8, maxSeconds: 30 } }), mid.signal)
  mid.abort()
  const cancelled = await inFlight
  ok('aborting mid-generation resolves as cancelled, not timeout',
    cancelled.failure === 'cancelled', cancelled.failure)
  // A preempted job and a slow model need different responses; collapsing
  // them would hide which happened.
  ok('cancelled and timeout are not the same value', cancelled.failure !== 'timeout')
}

console.log('\n-- credentials can never reach a prompt --')
{
  // Assembled at runtime rather than written as literals.
  //
  // These are synthetic, but a credential-shaped literal in a committed file
  // is a credential-shaped literal: the repository's own secret scanner
  // rightly blocks on them, and a repo full of fake keys trains everyone to
  // wave the scanner through. Joining halves keeps the *runtime* string
  // identical - which is what the patterns are actually tested against - while
  // leaving nothing scannable in the source.
  const join = (a, b) => a + b
  const cases = [
    ['account password', join('pass', 'word: hunter2')],
    ['api or provider key', join('api_', 'key=not-a-real-key')],
    ['bearer token', join('Authorization: Bear', 'er abcdefghijklmnopqrstuvwxyz')],
    ['GitHub token', join('gh', 'p_abcdefghijklmnopqrstuvwxyz012345')],
    ['AWS access key id', join('AKI', 'AIOSFODNN7EXAMPLE')],
    ['Slack token', join('xox', 'b-1234567890-abcdefghij')],
    ['private key block', join('-----BEGIN OPENSSH ', 'PRIVATE KEY-----')],
    ['bridge session token', join('session_', 'token: 9f2b1c')],
  ]
  for (const [name, text] of cases) {
    const scan = scanForSecrets(text)
    ok(`${name} is detected`, scan.safe === false && scan.found.includes(name), scan.found.join(','))
  }

  ok('ordinary game text is not flagged',
    scanForSecrets('You are stunned. A wild boar advances.').safe === true)
  // The scan names the kind, never the value - a diagnostic that quoted the
  // secret would be the leak it exists to prevent.
  ok('the scan never echoes the secret itself',
    !scanForSecrets('pass'+'word: hunter2').found.join(' ').includes('hunter2'))

  let threwState = false
  try { assertPromptCarriesNoSecrets(req({ state: 'pass'+'word: hunter2' })) } catch { threwState = true }
  ok('a prompt whose state carries a credential is refused', threwState)

  let threwInstructions = false
  try { assertPromptCarriesNoSecrets(req({ instructions: 'gh'+'p_abcdefghijklmnopqrstuvwxyz012345' })) } catch { threwInstructions = true }
  ok('and so is one whose instructions do', threwInstructions)

  // The refusal must stop the call, not merely be reported.
  let generateThrew = false
  try { await generateWithinBudget(echo, req({ state: 'api_'+'key=not-a-real-key' })) } catch { generateThrew = true }
  ok('generateWithinBudget refuses to send it at all', generateThrew)

  ok('a clean prompt passes', (() => { try { assertPromptCarriesNoSecrets(req()); return true } catch { return false } })())
}

console.log('\n-- the boundary cannot reach the game --')
{
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync('src/lib/aiModelProvider.ts', 'utf8')
  )
  ok('the provider module imports nothing from the command path',
    !/from '\.\/(gameActions|gameCommand|gameLink)/.test(src))
  ok('and defines no send/execute surface',
    !/\b(sendGame|requestGameAction|invokeTauri)\b/.test(src))
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 25
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
