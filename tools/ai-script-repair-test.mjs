/**
 * The script-repair job, end to end, against real files and real interpreters.
 *
 * One property is worth more than everything else here: **a generated patch is
 * a proposal.** The job may read a script, may write a copy somewhere else,
 * and may record a claim a person can look at. It may not write over the
 * script, may not activate anything, and may not reach the game. So the
 * decisive check is not "did a claim appear" - it is the original file's hash,
 * taken before the job runs and again after, on a real file on a real disk.
 *
 * # Why this suite touches the filesystem
 *
 * Because the invariant is about a filesystem. A test double that recorded
 * "writeCandidate was called with path X" would prove the worker's intention
 * and nothing about what ended up on disk, and the failure this exists to
 * catch is exactly a port that says one thing and does another. So the port
 * below is real: it reads real scripts, writes real candidates into a real
 * temporary app-data directory, and shells out to real `ruby -c`,
 * `python -m py_compile` and `tsc --noEmit`.
 *
 * # Three states, never two
 *
 * An interpreter this machine does not have produces `not_checked` with the
 * reason, never a pass. The counts at the end say how many checks were run and
 * how many were honestly skipped, and the suite refuses to end on "all passed"
 * while pretending a skipped language check was a clean one.
 *
 * The scripted providers here are test doubles and live only in this file.
 * `src/` ships no model implementation but `absentProvider`.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { findPython, pythonCandidates } from './find-python.mjs'
import { findRuby, rubyCandidates } from './find-ruby.mjs'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { EventJournal } = await import('../src/lib/aiEventJournal.ts')
const { AlertBroker } = await import('../src/lib/aiAlertBroker.ts')
const { JobStore } = await import('../src/lib/aiJobStore.ts')
const { ClaimStore } = await import('../src/lib/aiClaimStore.ts')
const { EvidenceStore } = await import('../src/lib/aiEvidenceStore.ts')
const { runWorkerOnce } = await import('../src/lib/aiWorker.ts')
const { callTool, TOOL_IDS } = await import('../src/lib/aiKnowledgeTools.ts')
const { readJSON, writeJSON } = await import('../src/lib/storage.ts')
const {
  applyUnifiedDiff,
  countRepeatedFailures,
  normalizeScriptError,
  proposeScriptRepair,
  validatePatchTarget,
} = await import('../src/lib/aiJobProducers.ts')

let pass = 0
let fail = 0
let notChecked = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(72)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(72)} ${detail}`)
  }
}
const skip = (what, why) => {
  notChecked++
  console.log(`NOT CHECKED  ${what.padEnd(64)} ${why}`)
}

/* ------------------------------------------------------------------------ *
 * A real workspace on a real disk.
 * ------------------------------------------------------------------------ */

const ROOT = mkdtempSync(join(tmpdir(), 'drc-h8-'))
const SCRIPT_ROOT = join(ROOT, 'scripts')
const APP_DATA = join(ROOT, 'appdata')
mkdirSync(APP_DATA, { recursive: true })
for (const lang of ['python', 'typescript', 'ruby']) mkdirSync(join(SCRIPT_ROOT, lang), { recursive: true })

const EXT = { python: '.py', typescript: '.ts', ruby: '.rb' }
const md5 = (text) => createHash('md5').update(text).digest('hex')
const safe = (s) => s.replace(/[^A-Za-z0-9._-]/g, '-')

const PY_DIR = join(process.cwd(), 'python')
/** E7's own driver, verbatim in shape: it runs the real `runner.main` in a
 * child with `USER_DIR` redirected at a directory of our choosing, so a
 * candidate is executed out of process and never near the player's tasks. */
const E7_DRIVER = [
  'import pathlib',
  'import sys',
  'sys.path.insert(0, sys.argv[1])',
  'import runner',
  'runner.USER_DIR = pathlib.Path(sys.argv[2])',
  'raise SystemExit(runner.main(["run", sys.argv[3]]))',
].join('\n')

const RUBY = findRuby()
const PYTHON = findPython()
const TSC = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')

const TS_RUNNER = join(process.cwd(), 'typescript', 'runner.ts')
/** Where the contained TypeScript runner and its throwaway task tree live.
 * Under ROOT so the suite's own `rmSync(ROOT)` takes it, and outside APP_DATA
 * so the candidate-count denominator at the end never sees these files. */
const TS_CONTAINMENT = join(ROOT, 'e7-ts')
let tsContainmentRuns = 0

/**
 * E7 containment for TypeScript, without changing a line of shipped code.
 *
 * This used to be `not_checked`, on the grounds that `typescript/runner.ts`
 * fixes `USER_DIR` at module scope (`const USER_DIR = join(__dirname, 'tasks',
 * 'user')`) so a candidate could not be run outside the player's own task
 * directory - unlike `python/runner.py`, whose module-level `USER_DIR` E7's
 * driver simply reassigns.
 *
 * That reading was one step short. `__dirname` is not a fixed path, it is
 * *this file's* directory - so copying the shipped runner into a scratch
 * directory moves USER_DIR with it. The copy looks for tasks in the scratch
 * tree, which holds the candidate and nothing of the player's, and the
 * candidate is executed in a child process exactly as E7 requires. The runner
 * under test is byte-identical to the one that ships, which is asserted rather
 * than assumed: a divergent copy would be testing a runner nobody installs.
 *
 * A known-good fixture goes first, same as the Python driver and for the same
 * reason: a driver that cannot run anything makes every candidate look broken,
 * so its failure downgrades the whole result to `not_checked` rather than
 * condemning the candidate.
 */
function typescriptContainment(candidatePath) {
  const skip = (detail) => [{ name: 'E7 containment fixtures', status: 'not_checked', detail }]
  if (!existsSync(TS_RUNNER)) {
    return skip(`${TS_RUNNER} does not exist, so there is no runner to contain a candidate in. This is not a pass.`)
  }

  tsContainmentRuns += 1
  const home = join(TS_CONTAINMENT, `run-${tsContainmentRuns}`)
  const userDir = join(home, 'tasks', 'user')
  mkdirSync(userDir, { recursive: true })
  const runnerCopy = join(home, 'runner.ts')
  copyFileSync(TS_RUNNER, runnerCopy)
  if (md5(readFileSync(runnerCopy, 'utf8')) !== md5(readFileSync(TS_RUNNER, 'utf8'))) {
    return skip('the contained runner is not byte-identical to typescript/runner.ts. This is not a pass.')
  }

  const drive = (taskId, timeout) =>
    spawnSync(process.execPath, ['--experimental-strip-types', runnerCopy, 'run', taskId], {
      encoding: 'utf8',
      timeout,
      // No cwd of the player's, and no environment pointing back at one.
      cwd: home,
    })

  // The denominator: prove the driver can run something before letting it
  // judge anything.
  const goodStem = 'drc_fixture_good'
  writeFileSync(
    join(userDir, `${goodStem}.ts`),
    '/** A task that behaves. */\nexport function main(): void {\n  console.log("fixture: finished")\n}\n',
    'utf8'
  )
  const control = drive(`user.${goodStem}`, 60000)
  if (control.status !== 0) {
    return skip(
      `the containment driver could not run its own known-good fixture: ` +
        `${((control.stderr || '') + (control.stdout || '')).trim().slice(0, 200)}. This is not a pass.`
    )
  }

  const stem = candidatePath.slice(dirname(candidatePath).length + 1).replace(/\.ts$/, '')
  copyFileSync(candidatePath, join(userDir, `${stem}.ts`))
  const r = drive(`user.${stem}`, 20000)
  const timedOut = r.error && String(r.error.message).includes('ETIMEDOUT')
  return [
    {
      name: 'E7 containment fixtures',
      status: r.status === 0 && !timedOut ? 'pass' : 'fail',
      detail: timedOut
        ? 'the candidate did not finish within 20s under the containment driver'
        : `ran out of process under a copy of typescript/runner.ts rooted at ${home}; ` +
          `${((r.stdout || '') + (r.stderr || '')).trim().slice(0, 200)}`,
    },
  ]
}

/**
 * The port the worker is given. Real, on purpose - see the header.
 *
 * `tamper` exists so the two sabotages can be run through the same object the
 * happy path uses rather than through a second one written to be broken,
 * which would prove nothing about the code that ships.
 */
function makePort(over = {}) {
  return {
    appDataDir: APP_DATA,
    read(lang, name) {
      const path = join(SCRIPT_ROOT, lang, `${name}${EXT[lang] ?? ''}`)
      if (!existsSync(path)) return null
      return { path, text: readFileSync(path, 'utf8') }
    },
    hash(path) {
      if (!existsSync(path)) return null
      return md5(readFileSync(path, 'utf8'))
    },
    candidatePathFor(jobId, lang, name) {
      return join(APP_DATA, 'script-candidates', safe(jobId), `${name}${EXT[lang] ?? ''}`)
    },
    writeCandidate(jobId, lang, name, text) {
      const path = this.candidatePathFor(jobId, lang, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text, 'utf8')
      return path
    },
    languageCheck(lang, candidatePath) {
      if (lang === 'ruby') {
        if (!RUBY) {
          return {
            name: 'ruby -c',
            status: 'not_checked',
            detail: `no working Ruby found; tried ${rubyCandidates().join(', ')}. This is not a pass.`,
          }
        }
        const r = spawnSync(RUBY, ['-c', candidatePath], { encoding: 'utf8', timeout: 60000 })
        return {
          name: 'ruby -c',
          status: r.status === 0 ? 'pass' : 'fail',
          detail: ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 300),
        }
      }
      if (lang === 'python') {
        if (!PYTHON) {
          return {
            name: 'python -m py_compile',
            status: 'not_checked',
            detail: `no working Python found; tried ${pythonCandidates().join(', ')}. This is not a pass.`,
          }
        }
        const r = spawnSync(PYTHON, ['-m', 'py_compile', candidatePath], { encoding: 'utf8', timeout: 60000 })
        return {
          name: 'python -m py_compile',
          status: r.status === 0 ? 'pass' : 'fail',
          detail: ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 300),
        }
      }
      if (lang === 'typescript') {
        if (!existsSync(TSC)) {
          return { name: 'tsc --noEmit', status: 'not_checked', detail: `no TypeScript compiler at ${TSC}. This is not a pass.` }
        }
        // Run from the candidate's own directory. Naming files on the command
        // line while a `tsconfig.json` is in scope is an error in this
        // compiler (TS5112), and the candidate directory has no config of its
        // own - which is also the honest thing to check, since a candidate is
        // judged on its own and not on the app's build settings.
        const r = spawnSync(
          process.execPath,
          [TSC, '--noEmit', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', candidatePath.slice(dirname(candidatePath).length + 1)],
          { encoding: 'utf8', timeout: 180000, cwd: dirname(candidatePath) }
        )
        return {
          name: 'tsc --noEmit',
          status: r.status === 0 ? 'pass' : 'fail',
          detail: ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 300),
        }
      }
      return { name: `syntax check for ${lang}`, status: 'not_checked', detail: `no syntax check is defined for ${lang}. This is not a pass.` }
    },
    fixtures(lang, candidatePath) {
      if (lang === 'typescript') return typescriptContainment(candidatePath)
      if (lang === 'ruby') {
        // Not "we could not be bothered": there is no out-of-process Ruby
        // runner in this repository to contain anything with. A Ruby script
        // here is a Lich `.lic`, and only Lich runs one. `assertRubySkipIsStillTrue`
        // below checks that this is still the case rather than leaving the
        // reason as a claim nobody re-derives - the day somebody adds
        // ruby/runner.rb, the suite says so instead of skipping forever.
        return [
          {
            name: 'E7 containment fixtures',
            status: 'not_checked',
            detail:
              'a Ruby script is a Lich script and runs only inside Lich: this repo has no ruby/runner.rb ' +
              'counterpart to python/runner.py, so there is no out-of-process runner to contain a candidate ' +
              'in. Precondition to lift it: an out-of-process Ruby runner that takes its task directory as ' +
              'an argument. This is not a pass.',
          },
        ]
      }
      if (lang !== 'python') {
        return [
          {
            name: 'E7 containment fixtures',
            status: 'not_checked',
            detail: `no containment driver is defined for ${lang}. This is not a pass.`,
          },
        ]
      }
      if (!PYTHON) {
        return [{ name: 'E7 containment fixtures', status: 'not_checked', detail: 'no working Python found. This is not a pass.' }]
      }
      const dir = dirname(candidatePath)
      const stem = candidatePath.slice(dir.length + 1).replace(/\.py$/, '')

      // The denominator. A driver that cannot run anything makes every
      // candidate look broken, so the known-good fixture goes first and its
      // failure downgrades the whole result to not_checked rather than
      // condemning the candidate.
      const goodStem = 'drc_fixture_good'
      writeFileSync(join(dir, `${goodStem}.py`), '"""A task that behaves."""\n\n\ndef main():\n    print("fixture: finished")\n', 'utf8')
      const control = spawnSync(PYTHON, ['-c', E7_DRIVER, PY_DIR, dir, `user.${goodStem}`], { encoding: 'utf8', timeout: 60000 })
      if (control.status !== 0) {
        return [
          {
            name: 'E7 containment fixtures',
            status: 'not_checked',
            detail: `the containment driver could not run its own known-good fixture: ${(control.stderr || '').trim().slice(0, 200)}. This is not a pass.`,
          },
        ]
      }

      const r = spawnSync(PYTHON, ['-c', E7_DRIVER, PY_DIR, dir, `user.${stem}`], { encoding: 'utf8', timeout: 20000 })
      const timedOut = r.error && String(r.error.message).includes('ETIMEDOUT')
      return [
        {
          name: 'E7 containment fixtures',
          status: r.status === 0 && !timedOut ? 'pass' : 'fail',
          detail: timedOut
            ? 'the candidate did not finish within 20s under the containment driver'
            : ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 300),
        },
      ]
    },
    ...over,
  }
}

/* ------------------------------------------------------------------------ *
 * Deterministic providers. Test doubles; nothing like these ships.
 * ------------------------------------------------------------------------ */

const providerReturning = (text) => ({ describe: () => ({ available: true }), generate: async () => ({ ok: true, text, tokens: 12 }) })
const absent = { describe: () => ({ available: false }), generate: async () => ({ ok: false, failure: 'absent', message: 'no model is installed' }) }
const prose = providerReturning('I had a look and it seems fine to me.')

const setup = (over = {}) => {
  store.clear()
  const journal = new EventJournal()
  const alerts = new AlertBroker()
  journal.append('line', { text: 'task failed' }, 1)
  journal.append('line', { text: 'task failed again' }, 2)
  const evidence = new EvidenceStore({ source: journal, capacity: 100 })
  evidence.load()
  const claims = new ClaimStore({ evidence, storage: { read: readJSON, write: writeJSON } })
  claims.load()
  const jobs = new JobStore({ evidence })
  jobs.load()
  return {
    journal,
    alerts,
    jobs,
    claims,
    evidence,
    provider: absent,
    // `idle` with a matching hash is the only decision that reaches the
    // background queue: anything else takes the live-review path instead.
    activity: 'idle',
    now: 100000,
    nowIso: '2026-09-05T13:00:00Z',
    lastReviewAt: null,
    stateHash: 'h1',
    lastReviewedHash: 'h1',
    instructions: 'repair',
    scriptRepair: makePort(),
    ...over,
  }
}

const writeScript = (lang, name, text) => {
  const path = join(SCRIPT_ROOT, lang, `${name}${EXT[lang]}`)
  writeFileSync(path, text, 'utf8')
  return path
}

const queueRepair = (deps, scriptId) =>
  deps.jobs.create({
    kind: 'script_repair',
    scope: { scriptId, error: 'NameError: harvest is not defined', failureCount: 2 },
    inputRefs: ['event:1', 'event:2'],
    allowedTools: ['read_script'],
    now: deps.nowIso,
  })

/* ------------------------------------------------------------------------ *
 * 1. The producer
 * ------------------------------------------------------------------------ */

console.log('-- a script is repaired only after it has failed the same way twice --')
{
  const d = setup()
  const at = d.nowIso
  const one = [{ scriptId: 'python:harvest', error: 'NameError: x', at }]
  const two = [...one, { scriptId: 'python:harvest', error: 'NameError:   x  ', at }]
  const mixed = [one[0], { scriptId: 'python:harvest', error: 'TypeError: y', at }]

  const first = proposeScriptRepair({ jobs: d.jobs, scriptId: 'python:harvest', failures: one, error: 'NameError: x', evidenceSeqs: [1], now: at })
  ok('one failure is an incident, not a pattern', first.job === null && first.created === false, first.reason)

  const differing = proposeScriptRepair({ jobs: d.jobs, scriptId: 'python:harvest', failures: mixed, error: 'TypeError: y', evidenceSeqs: [1], now: at })
  ok('two failures with different errors do not make a repair job', differing.job === null, differing.reason)

  const second = proposeScriptRepair({ jobs: d.jobs, scriptId: 'python:harvest', failures: two, error: 'NameError: x', evidenceSeqs: [1, 2], now: at })
  ok('the same error twice creates a script_repair job', second.created === true && second.job?.kind === 'script_repair', second.reason)
  ok('the job may only read', JSON.stringify(second.job?.allowedTools) === '["read_script"]', JSON.stringify(second.job?.allowedTools))
  ok('the job carries the script id and the failure count', second.job?.scope.scriptId === 'python:harvest' && second.job?.scope.failureCount === 2, JSON.stringify(second.job?.scope))

  const again = proposeScriptRepair({ jobs: d.jobs, scriptId: 'python:harvest', failures: two, error: 'NameError: x', evidenceSeqs: [1, 2], now: at })
  ok('a second call does not queue a second job for one script', again.created === false && again.job?.jobId === second.job?.jobId, again.reason)

  ok('whitespace is the only thing normalised away', normalizeScriptError(' a   b \n') === 'a b', normalizeScriptError(' a   b \n'))
  ok('an empty error matches nothing', countRepeatedFailures(two, 'python:harvest', '   ') === 0, '0')
}

/* ------------------------------------------------------------------------ *
 * 2. The tool, through the registry it must not go around
 * ------------------------------------------------------------------------ */

console.log('-- read_script is read-only, capped, traced and labelled untrusted --')
{
  writeScript('python', 'harvest', 'def main():\n    print("harvest")\n')
  const port = makePort()
  const ALL = [...TOOL_IDS]
  ok('read_script is in the registry', TOOL_IDS.includes('read_script'), TOOL_IDS.join(', '))

  const trace = []
  const r = callTool('read_script', { id: 'python:harvest' }, ALL, trace, { scripts: port, now: 7 })
  ok('a known script comes back', r.ok === true && r.value?.name === 'harvest', r.ok ? r.value.path : r.reason)
  ok('the source is labelled untrusted', r.ok && r.value.source?.untrusted === true && r.value.source.text.includes('harvest'), JSON.stringify(r.ok && r.value.source?.untrusted))
  ok('the call is traced without its payload', trace.length === 1 && trace[0].tool === 'read_script' && trace[0].argsSummary === 'id=str(14)' && !JSON.stringify(trace[0]).includes('def main'), JSON.stringify(trace[0]))

  const traversal = ['python:../../../etc/passwd', 'python:..', 'ruby:a/b', 'python:', 'perl:thing', 'python:harvest:extra']
  const refusals = traversal.map((id) => callTool('read_script', { id }, ALL, [], { scripts: port }))
  ok('every path-shaped id is refused', refusals.every((x) => x.ok === false), refusals.map((x) => (x.ok ? 'ALLOWED' : 'refused')).join(' '))
  ok('the refusal names the argument, not the file', refusals[0].reason.includes('path separators'), refusals[0].reason)

  const notAllowed = callTool('read_script', { id: 'python:harvest' }, ['flag_conflict'], [], { scripts: port })
  ok('a job without read_script in its allowedTools cannot call it', notAllowed.ok === false && notAllowed.reason.includes('allowedTools'), notAllowed.reason)

  const noPort = callTool('read_script', { id: 'python:harvest' }, ALL, [], {})
  ok('no script source attached yields nothing rather than an error', noPort.ok === true && noPort.value === null, String(noPort.ok))

  // A script over the ceiling must be refused whole. `capResult` shortens only
  // arrays, and half a script is a different script: a patch proposed against
  // it would apply to the wrong lines.
  writeScript('python', 'enormous', `# ${'x'.repeat(70000)}\n`)
  const big = callTool('read_script', { id: 'python:enormous' }, ALL, [], { scripts: port })
  ok('an over-size script is refused rather than truncated', big.ok === false && big.reason.includes('cannot be shortened honestly'), big.ok ? 'TRUNCATED' : big.reason)
}

/* ------------------------------------------------------------------------ *
 * 3. The diff applier and the path guard
 * ------------------------------------------------------------------------ */

console.log('-- a patch that does not fit the file is refused, never fudged --')
{
  const original = 'one\ntwo\nthree\n'
  const good = '--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n'
  const applied = applyUnifiedDiff(original, good)
  ok('a matching patch applies', applied.ok === true && applied.text === 'one\nTWO\nthree\n', applied.ok ? JSON.stringify(applied.text) : applied.reason)

  const wrongContext = '@@ -1,3 +1,3 @@\n one\n-TWO\n+two\n three\n'
  const bad = applyUnifiedDiff(original, wrongContext)
  ok('a patch whose context disagrees is refused naming the line', bad.ok === false && bad.reason.includes('line 2'), bad.ok ? 'APPLIED' : bad.reason)

  ok('a patch with no hunks is refused', applyUnifiedDiff(original, 'just a sentence').ok === false, applyUnifiedDiff(original, 'just a sentence').reason)
  ok('an empty patch is refused', applyUnifiedDiff(original, '   ').ok === false, 'refused')
  const past = applyUnifiedDiff(original, '@@ -40,1 +40,1 @@\n one\n')
  ok('a hunk past the end of the file is refused', past.ok === false && past.reason.includes('past the end'), past.reason)

  const crlf = 'one\r\ntwo\r\nthree\r\n'
  const kept = applyUnifiedDiff(crlf, good)
  ok('CRLF line endings survive the patch', kept.ok === true && kept.text.includes('\r\n') && !/[^\r]\n/.test(kept.text), kept.ok ? JSON.stringify(kept.text.slice(0, 12)) : kept.reason)
}

console.log('-- a candidate may not be written over, beside, or outside --')
{
  const originalPath = join(SCRIPT_ROOT, 'python', 'harvest.py')
  const cases = [
    ['the script itself', originalPath, 'the script itself', APP_DATA],
    ['somewhere outside the app data directory', join(ROOT, 'elsewhere', 'harvest.py'), 'outside the app data directory', APP_DATA],
    // The script-directory clause only bites when the app data directory
    // *contains* the script directory - an install where the player's tasks
    // live under the app's own data, which is a real shape and the only one
    // in which a `.patched` sibling would pass the ceiling check. Aimed at
    // deliberately, because a branch nobody can execute on purpose is a
    // branch nobody can prove they fixed.
    ['a sibling in the script directory', join(SCRIPT_ROOT, 'python', 'harvest.patched.py'), 'script directory', SCRIPT_ROOT],
  ]
  for (const [what, candidatePath, needle, home] of cases) {
    const v = validatePatchTarget({ originalPath, candidatePath, appDataDir: home })
    ok(`refuses ${what}`, v.ok === false && v.reason.includes(needle), v.ok ? 'ALLOWED' : v.reason)
  }
  const good = validatePatchTarget({ originalPath, candidatePath: join(APP_DATA, 'script-candidates', 'job-1', 'harvest.py'), appDataDir: APP_DATA })
  ok('allows a candidate under the app data directory', good.ok === true, JSON.stringify(good))
  const noHome = validatePatchTarget({ originalPath, candidatePath: join(APP_DATA, 'x.py'), appDataDir: '' })
  ok('refuses when no app data directory is configured', noHome.ok === false, noHome.reason)
}

/* ------------------------------------------------------------------------ *
 * 4. The vertical, against real interpreters and real files
 * ------------------------------------------------------------------------ */

const RUBY_ORIGINAL = 'def harvest\n  puts "harvest"\n  putz "done"\nend\n'
const RUBY_DIFF = '--- a/harvest.rb\n+++ b/harvest.rb\n@@ -1,4 +1,4 @@\n def harvest\n   puts "harvest"\n-  putz "done"\n+  puts "done"\n end\n'

const PY_ORIGINAL = 'def main():\n    print("before")\n    return 0\n'
const PY_DIFF = '--- a/harvest.py\n+++ b/harvest.py\n@@ -1,3 +1,3 @@\n def main():\n-    print("before")\n+    print("after")\n     return 0\n'

const TS_ORIGINAL = 'export function harvest(n: number): number {\n  return n + 1\n}\n'
const TS_DIFF = '--- a/harvest.ts\n+++ b/harvest.ts\n@@ -1,3 +1,3 @@\n export function harvest(n: number): number {\n-  return n + 1\n+  return n + 2\n }\n'

const runVertical = async (lang, name, source, diff, over = {}) => {
  const d = setup({ provider: providerReturning(JSON.stringify({ diff, rationale: 'a fix' })), ...over })
  const path = writeScript(lang, name, source)
  const before = md5(readFileSync(path, 'utf8'))
  const job = queueRepair(d, `${lang}:${name}`)
  const out = await runWorkerOnce(d)
  const after = md5(readFileSync(path, 'utf8'))
  return { d, job, out, path, before, after }
}

for (const [lang, name, source, diff] of [
  ['ruby', 'harvest', RUBY_ORIGINAL, RUBY_DIFF],
  ['python', 'harvest', PY_ORIGINAL, PY_DIFF],
  ['typescript', 'harvest', TS_ORIGINAL, TS_DIFF],
]) {
  console.log(`-- ${lang}: a known-good diff becomes a checked candidate and the script is untouched --`)
  const { out, path, before, after, d } = await runVertical(lang, name, source, diff)
  const claims = d.claims.all().filter((c) => c.predicate === 'script_patch')
  const claim = claims[0]

  ok(`${lang}: the job is awaiting review, never completed`, out.status === 'awaiting_review', `${out.status} :: ${d.jobs.get(out.jobId)?.note ?? ''}`)
  ok(`${lang}: exactly one script_patch claim, status candidate`, claims.length === 1 && claim?.status === 'candidate', `${claims.length} claim(s), ${claim?.status}`)
  ok(`${lang}: THE ORIGINAL FILE IS BYTE-IDENTICAL`, before === after, `${before} -> ${after}`)
  ok(`${lang}: the original still holds its own text`, readFileSync(path, 'utf8') === source, 'unchanged')

  const value = claim?.value ?? {}
  ok(`${lang}: the claim carries the diff`, value.diff === diff, typeof value.diff)
  ok(`${lang}: the candidate exists and is not the original`, typeof value.candidatePath === 'string' && existsSync(value.candidatePath) && value.candidatePath !== path, String(value.candidatePath))
  ok(`${lang}: the candidate holds the patched text, and only the candidate does`, readFileSync(value.candidatePath, 'utf8') !== source, 'patched')
  ok(`${lang}: the candidate is under the app data directory`, String(value.candidatePath).startsWith(APP_DATA), String(value.candidatePath))
  ok(`${lang}: the claim records the pre-job hash`, value.originalHash === before, String(value.originalHash))

  const checks = Array.isArray(value.checks) ? value.checks : []
  ok(`${lang}: the checks travel with the diff`, checks.length >= 2, checks.map((c) => `${c.name}=${c.status}`).join(' '))
  const language = checks[0]
  if (language?.status === 'not_checked') {
    skip(`${lang}: language check`, language.detail)
  } else {
    ok(`${lang}: the language check ran and passed on the candidate`, language?.status === 'pass', `${language?.name}: ${language?.status} ${language?.detail}`)
  }
  const fixture = checks[1]
  if (fixture?.status === 'not_checked') {
    skip(`${lang}: E7 containment fixtures`, fixture.detail)
  } else {
    ok(`${lang}: the E7 fixtures ran the candidate out of process`, fixture?.status === 'pass', `${fixture?.name}: ${fixture?.status} ${fixture?.detail}`)
  }
}

console.log('-- the reason Ruby containment is skipped is itself checked, not asserted --')
{
  // A skip whose reason nobody re-derives is a claim, and a claim rots. The
  // Ruby fixture is skipped because this repository has no out-of-process Ruby
  // runner - the counterpart to python/runner.py and typescript/runner.ts. If
  // one ever appears, the skip above is stale and the fixture should be wired,
  // so the precondition is measured rather than believed.
  //
  // The denominator is the pair: the two runners that DO exist must both be
  // found, or this is measuring a broken path rather than an absent runner.
  const runners = [
    ['python/runner.py', existsSync(join(process.cwd(), 'python', 'runner.py'))],
    ['typescript/runner.ts', existsSync(TS_RUNNER)],
  ]
  ok(
    'both known task runners are where this check looks (positive control)',
    runners.every(([, found]) => found),
    runners.map(([p, found]) => `${p}=${found ? 'found' : 'MISSING'}`).join(' ')
  )
  const rubyRunners = ['ruby/runner.rb', 'ruby/runner.lic', 'lich/runner.rb'].filter((p) =>
    existsSync(join(process.cwd(), ...p.split('/')))
  )
  ok(
    'no out-of-process Ruby runner exists, so the Ruby skip above is still true',
    rubyRunners.length === 0,
    rubyRunners.length === 0
      ? 'checked 3 candidate paths, none present'
      : `${rubyRunners.join(', ')} now exists - the skip reason is STALE, wire the fixture`
  )
}

console.log('-- a patch that breaks the file is still a candidate, with the failure recorded --')
{
  const broken = '--- a/broken.rb\n+++ b/broken.rb\n@@ -1,4 +1,4 @@\n def harvest\n   puts "harvest"\n-  putz "done"\n+  puts "done\n end\n'
  const { out, before, after, d } = await runVertical('ruby', 'broken', RUBY_ORIGINAL, broken)
  const claim = d.claims.all().find((c) => c.predicate === 'script_patch')
  ok('the original is untouched by a patch that does not compile', before === after, `${before} -> ${after}`)
  const language = claim?.value?.checks?.[0]
  if (!RUBY) {
    skip('a broken candidate fails ruby -c', `no working Ruby found; tried ${rubyCandidates().join(', ')}`)
    ok('the claim still exists so a reviewer sees the diff', claim !== undefined && out.status === 'awaiting_review', String(out.status))
  } else {
    ok('a broken candidate is recorded as failing, not hidden', language?.status === 'fail', `${language?.name}: ${language?.status}`)
    ok('and it is still a candidate a person can reject', claim?.status === 'candidate' && out.status === 'awaiting_review', `${claim?.status}/${out.status}`)
  }
}

console.log('-- every way the job can produce nothing leaves the script alone --')
{
  const cases = [
    ['no model is installed', { provider: absent }, 'absent'],
    ['the model answers in prose', { provider: prose }, 'invalid_output'],
    ['the patch does not apply to this file', { provider: providerReturning(JSON.stringify({ diff: '@@ -1,2 +1,2 @@\n not this line\n' })) }, 'does not apply'],
    ['no workspace is attached', { scriptRepair: null }, 'no script workspace'],
  ]
  for (const [what, over, needle] of cases) {
    const d = setup(over)
    const path = writeScript('ruby', 'quiet', RUBY_ORIGINAL)
    const before = md5(readFileSync(path, 'utf8'))
    queueRepair(d, 'ruby:quiet')
    const out = await runWorkerOnce(d)
    const note = d.jobs.get(out.jobId)?.note ?? ''
    const claims = d.claims.all().filter((c) => c.predicate === 'script_patch')
    ok(`${what}: the job fails and says why`, out.status === 'failed' && note.includes(needle), `${out.status}: ${note.slice(0, 90)}`)
    ok(`${what}: no claim, and the script is byte-identical`, claims.length === 0 && md5(readFileSync(path, 'utf8')) === before, `${claims.length} claims`)
  }
}

console.log('-- a script carrying a secret never reaches the model --')
{
  // Assembled at runtime: a credential-shaped literal in a committed file is
  // what gitleaks exists to stop, and a fixture is not an exception.
  const secret = 'pass' + 'word: hunter2swordfish\n'
  const d = setup({ provider: providerReturning(JSON.stringify({ diff: RUBY_DIFF })) })
  const path = writeScript('ruby', 'secretive', `# ${secret}${RUBY_ORIGINAL}`)
  const before = md5(readFileSync(path, 'utf8'))
  queueRepair(d, 'ruby:secretive')
  const out = await runWorkerOnce(d)
  const note = d.jobs.get(out.jobId)?.note ?? ''
  ok('the privacy gate stops the call', out.result?.ok === false && out.result.failure === 'privacy_gate', `${out.result?.failure}: ${out.result?.message}`)
  ok('the note names the pattern and never the value', !note.includes('hunter2swordfish') && note.includes('privacy_gate'), note.slice(0, 90))
  ok('and the script is byte-identical', md5(readFileSync(path, 'utf8')) === before, before)
}

/* ------------------------------------------------------------------------ *
 * 5. It cannot activate, by construction
 * ------------------------------------------------------------------------ */

console.log('-- nothing in this path can write a script or reach the game --')
{
  const worker = readFileSync(join(process.cwd(), 'src', 'lib', 'aiWorker.ts'), 'utf8')
  // Imports, not mentions. The first version of this matched the bare words
  // and flagged the file's own header comment - the one that says it imports
  // none of these - which is a check failing on its documentation rather than
  // on the code, and it would have taught the next reader to delete the
  // comment instead of keeping the property.
  const imported = [...worker.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1])
  const forbidden = ['scriptFiles', 'gameActions', 'gameCommand', 'gameLink', 'tauri']
  const found = imported.filter((spec) => forbidden.some((f) => spec.includes(f)))
  ok('aiWorker.ts imports nothing that writes a script or sends a command', found.length === 0, `${imported.length} imports; offending: ${found.join(', ') || 'none'}`)

  const tools = readFileSync(join(process.cwd(), 'src', 'lib', 'aiKnowledgeTools.ts'), 'utf8')
  ok('the tool registry offers no write_script', !tools.includes('write_script') && !TOOL_IDS.includes('write_script'), TOOL_IDS.join(', '))

  const producers = readFileSync(join(process.cwd(), 'src', 'lib', 'aiJobProducers.ts'), 'utf8')
  ok('applyUnifiedDiff takes and returns text, touching no filesystem', !producers.includes('node:fs') && !producers.includes("from 'fs'"), 'no fs import')

  // A repair job may not reach `completed` from this code at all: the only
  // transitions it asks for are awaiting_review, failed and cancelled.
  const asked = [...worker.matchAll(/status:\s*'(awaiting_review|failed|cancelled|completed)'/g)].map((m) => m[1])
  ok('the repair outcome type admits no completed status', !asked.includes('completed'), asked.join(', '))
}

console.log('-- SABOTAGE-SHAPED: a port that aims at the original is refused, before the write --')
{
  // The plan's sabotage is "write the patch over the original". Rather than
  // editing the source to do that and watching a check go red, this runs the
  // shipped code against a workspace that *tries* to, which is the same
  // hostile input a broken or malicious port would supply - and it must be
  // refused while the destination is still a string.
  const d = setup({
    provider: providerReturning(JSON.stringify({ diff: RUBY_DIFF })),
    scriptRepair: makePort({
      candidatePathFor(_jobId, lang, name) {
        return join(SCRIPT_ROOT, lang, `${name}${EXT[lang]}`)
      },
    }),
  })
  const path = writeScript('ruby', 'target', RUBY_ORIGINAL)
  const before = md5(readFileSync(path, 'utf8'))
  queueRepair(d, 'ruby:target')
  const out = await runWorkerOnce(d)
  const note = d.jobs.get(out.jobId)?.note ?? ''
  ok('the job refuses to write the candidate', out.status === 'failed' && note.includes('the script itself'), note.slice(0, 110))
  ok('the original is byte-identical and still its own text', md5(readFileSync(path, 'utf8')) === before && readFileSync(path, 'utf8') === RUBY_ORIGINAL, before)
  ok('no claim was recorded', d.claims.all().filter((c) => c.predicate === 'script_patch').length === 0, '0')
}

console.log('-- SABOTAGE-SHAPED: a port that lies about where it wrote is caught --')
{
  // `candidatePathFor` answers honestly and `writeCandidate` does something
  // else. Without the second check this is the one route past the first.
  const d = setup({
    provider: providerReturning(JSON.stringify({ diff: RUBY_DIFF })),
    scriptRepair: makePort({
      writeCandidate(_jobId, lang, name, text) {
        const path = join(ROOT, 'elsewhere', `${name}${EXT[lang]}`)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, text, 'utf8')
        return path
      },
    }),
  })
  const path = writeScript('ruby', 'liar', RUBY_ORIGINAL)
  const before = md5(readFileSync(path, 'utf8'))
  queueRepair(d, 'ruby:liar')
  const out = await runWorkerOnce(d)
  const note = d.jobs.get(out.jobId)?.note ?? ''
  ok('a candidate written outside the workspace is caught after the fact', out.status === 'failed' && note.includes('somewhere it may not be'), note.slice(0, 110))
  ok('and no claim was recorded for it', d.claims.all().filter((c) => c.predicate === 'script_patch').length === 0, '0')
  ok('the original is byte-identical', md5(readFileSync(path, 'utf8')) === before, before)
}

console.log('-- SABOTAGE-SHAPED: the original changing under the job aborts it --')
{
  // The hash check has to be reachable on purpose or nobody can prove it
  // works. This port modifies the script during `writeCandidate` - the
  // sequence a lost update would produce - and the job must abort naming it
  // rather than record a claim against a file that has moved.
  let originalPath = null
  const d = setup({
    provider: providerReturning(JSON.stringify({ diff: RUBY_DIFF })),
    scriptRepair: makePort({
      writeCandidate(jobId, lang, name, text) {
        const candidate = this.candidatePathFor(jobId, lang, name)
        mkdirSync(dirname(candidate), { recursive: true })
        writeFileSync(candidate, text, 'utf8')
        writeFileSync(originalPath, `# tampered\n${RUBY_ORIGINAL}`, 'utf8')
        return candidate
      },
    }),
  })
  originalPath = writeScript('ruby', 'moving', RUBY_ORIGINAL)
  queueRepair(d, 'ruby:moving')
  const out = await runWorkerOnce(d)
  const note = d.jobs.get(out.jobId)?.note ?? ''
  ok('the job aborts when the original changed under it', out.status === 'failed' && note.includes('ABORTED'), note.slice(0, 120))
  ok('and records no claim about a file that moved', d.claims.all().filter((c) => c.predicate === 'script_patch').length === 0, '0')
}

/* ------------------------------------------------------------------------ *
 * Denominator and verdict
 * ------------------------------------------------------------------------ */

const candidates = existsSync(join(APP_DATA, 'script-candidates'))
  ? readdirSync(join(APP_DATA, 'script-candidates'), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.(rb|py|ts)$/.test(e.name) && !e.name.startsWith('drc_fixture_'))
      .map((e) => e.name)
  : []
ok('candidates were written somewhere real', candidates.length >= 3, `${candidates.length} candidate files under ${APP_DATA}: ${candidates.join(', ')}`)
ok('no candidate was ever written into a script directory', readdirSync(join(SCRIPT_ROOT, 'ruby')).every((f) => !f.includes('patched')), readdirSync(join(SCRIPT_ROOT, 'ruby')).join(', '))

const FLOOR = 55
ok(`at least ${FLOOR} checks ran, so an empty run cannot pass`, pass + fail >= FLOOR, `${pass + fail} checks`)

rmSync(ROOT, { recursive: true, force: true })

console.log('')
console.log(`interpreters: ruby=${RUBY ?? 'NOT FOUND'} python=${PYTHON ?? 'NOT FOUND'} tsc=${existsSync(TSC) ? TSC : 'NOT FOUND'}`)
console.log(`${pass} passed, ${fail} failed, ${notChecked} not checked`)
// Deliberately does not contain the words the runner counts. `run-tests.mjs`
// treats every line matching /\bNOT CHECKED\b/ as one thing that went
// unchecked, and this line is a tally of the lines above it, not a further
// skip - so while it said "NOT CHECKED" the suite reported one more skipped
// thing than it had (three, for two). Each real skip is still printed above,
// each with its reason; only the double count is gone.
if (notChecked > 0) console.log(`A SKIP IS NOT A PASS: ${notChecked} check(s) above did not run - see their reasons.`)
console.log(fail === 0 ? 'all passed' : 'FAILURES')
process.exit(fail === 0 ? 0 : 1)
