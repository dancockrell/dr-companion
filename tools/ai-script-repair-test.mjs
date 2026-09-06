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
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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
const RUBY_RUNNER = join(process.cwd(), 'ruby', 'runner.rb')
const RUBY_STUB = join(process.cwd(), 'ruby', 'lich_stub.rb')
const RUBY_FIXTURES = join(process.cwd(), 'ruby', 'fixtures')
const RUBY_STREAM = join(RUBY_FIXTURES, 'stream.txt')
/** Where each contained Ruby run gets its own sandbox. Under ROOT so the
 * suite's own `rmSync(ROOT)` takes it, and outside APP_DATA so the
 * candidate-count denominator at the end never sees these files. */
const RUBY_CONTAINMENT = join(ROOT, 'e7-ruby')
/** The one directory outside every Ruby sandbox that the escape fixtures aim
 * at. Each writes `ESCAPED_<class>.txt` here if its guard fails, so "did
 * anything get out" is one `readdirSync` rather than a different check per
 * fixture, and a fixture that escapes is a FAIL and not a note. It is a
 * sibling of the `run-N` sandboxes and still under ROOT, so the suite's own
 * cleanup takes it. */
const RUBY_OUTSIDE = join(RUBY_CONTAINMENT, 'outside')
/** Where this side's copy of each run's record goes: one file per run, outside
 * every sandbox, seeded with a nonce before the child starts. #486 got a
 * forged clean verdict past this driver three ways, all of them by producing
 * the object being judged inside the process being judged, so the object being
 * judged is now written here by the runner and cannot be reached from a
 * candidate - it is outside the fence, and the nonce is in no argument, no
 * environment variable and no local a candidate can name. */
const RUBY_LEDGERS = join(RUBY_CONTAINMENT, 'ledger')
/** How long past its own `--timeout` a contained run gets before this side
 * kills it. The runner's watchdog is a convenience a candidate can stop
 * (`Contain.watchdog.kill`, #486's third finding, which produced no JSON at
 * all and an external 124); this is the clock the verdict actually depends on,
 * and it is out here where nothing in the sandbox can reach it. */
const RUBY_GRACE_MS = 6000
let rubyContainmentRuns = 0
let rubyLedgerRuns = 0
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
 * E7 containment for Ruby.
 *
 * This was `not_checked` for as long as `ruby/runner.rb` did not exist, and
 * the reason was true: a Ruby script here is a Lich `.lic`, Lich is what runs
 * one, and Lich is attached to the player's character. The precondition that
 * skip named for lifting itself was "an out-of-process Ruby runner that takes
 * its task directory as an argument". `ruby/runner.rb` is that runner, and
 * this is the driver that uses it.
 *
 * Same shape as the TypeScript and Python drivers, for the same reasons. A
 * known-good fixture runs first as the denominator, and its failure downgrades
 * the whole result to `not_checked` rather than condemning a candidate for a
 * broken driver. The sandbox is a fresh directory per run holding the
 * candidate and nothing of the player's.
 *
 * Unlike the TypeScript driver there is no copy of the runner to check for
 * byte-identity: `runner.rb` takes its sandbox as an argument rather than
 * deriving it from its own location, so the shipped file is what runs. The
 * detail line carries its hash instead, so a run against a modified runner is
 * legible after the fact rather than silently equivalent.
 */
function rubyRun({ home, script, timeout = 10, wall = null }) {
  rubyLedgerRuns += 1
  mkdirSync(RUBY_LEDGERS, { recursive: true })
  const ledgerPath = join(RUBY_LEDGERS, `run-${rubyLedgerRuns}.jsonl`)
  // Seeded here, before the child exists. The nonce is what makes a ledger
  // line the runner's rather than anybody's: a candidate cannot read this file
  // (it is outside its sandbox and every read-shaped entry point is guarded)
  // and the value appears in no argument the child is given.
  const nonce = randomUUID()
  writeFileSync(ledgerPath, JSON.stringify({ t: 'open', nonce }) + '\n', 'utf8')

  // The wall is this side's, and it is derived from the run's own timeout
  // rather than being a large constant. A candidate that stops the runner's
  // watchdog buys this grace window and nothing else.
  const deadline = wall ?? timeout * 1000 + RUBY_GRACE_MS
  const startedAt = Date.now()
  const r = spawnSync(
    RUBY,
    [
      '-W0',
      '--disable-gems',
      RUBY_RUNNER,
      '--sandbox',
      home,
      '--script',
      script,
      '--fixture',
      RUBY_STREAM,
      '--timeout',
      String(timeout),
      '--ledger',
      ledgerPath,
    ],
    { encoding: 'utf8', timeout: deadline, cwd: home }
  )
  const elapsed = Date.now() - startedAt
  const text = ((r.stdout || '') + '').trim()
  // Stdout is advisory. It is parsed because a person reading a failure wants
  // to see what the run said, and because several checks below compare what
  // the candidate CLAIMED against what the ledger recorded - which is the only
  // way to show that the forgery happened and did not work.
  let result = null
  const last = text.split('\n').filter((l) => l.trim().startsWith('{')).pop()
  if (last) {
    try {
      result = JSON.parse(last)
    } catch {
      result = null
    }
  }
  return { spawn: r, result, text, stderr: (r.stderr || '').trim(), ledger: readRubyLedger(ledgerPath, nonce), elapsed, deadline, ledgerPath }
}

/**
 * The parent's record of one run: everything on the ledger stamped with the
 * nonce this side seeded, and nothing else.
 *
 * Three states rather than two. `verdict === null` is not "clean" and not
 * "violated": it is **the candidate left without one**, which is what `exit!`
 * and a killed watchdog both produce, and it is a FAIL that says so. A line
 * whose nonce does not match is counted separately rather than dropped
 * silently, because a non-zero `foreign` would mean the nonce leaked and this
 * whole mechanism is worth less than it looks.
 */
function readRubyLedger(path, nonce) {
  let lines = []
  try {
    lines = readFileSync(path, 'utf8').split('\n')
  } catch {
    return { violations: [], verdict: null, foreign: 0, records: 0, started: false }
  }
  const out = { violations: [], verdict: null, foreign: 0, records: 0, started: false }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let rec = null
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (rec.t === 'open') continue
    out.records += 1
    if (rec.nonce !== nonce) {
      out.foreign += 1
      continue
    }
    if (rec.t === 'violation') out.violations.push(String(rec.message))
    else if (rec.t === 'verdict') out.verdict = rec
    else if (rec.t === 'start') out.started = true
  }
  return out
}

/**
 * The verdict, computed from the parent's record and never from the child's.
 *
 * Every clause is one of #486's findings. `verdict === null` closes `exit!`
 * (finding 2) and the killed watchdog (finding 3) at once, and it is the third
 * state a two-valued check could not express. `ledger.violations` closes
 * `Contain.violations.clear` (finding 1), because the lines were written as
 * each violation was raised and clearing the in-process array clears a copy of
 * something this side already has. Reading neither from stdout closes the
 * forged last object (finding 5).
 */
function rubyVerdict(r) {
  if (r.spawn.error && r.spawn.error.code === 'ETIMEDOUT') {
    return { pass: false, why: `no verdict: this side killed the run after ${r.elapsed}ms (its wall was ${r.deadline}ms)` }
  }
  if (!r.ledger.started) return { pass: false, why: 'no verdict: the runner never reported starting, so nothing here ran contained' }
  if (r.ledger.foreign > 0) return { pass: false, why: `${r.ledger.foreign} ledger line(s) carry the wrong nonce` }
  if (!r.ledger.verdict) return { pass: false, why: 'no verdict: the candidate exited without one' }
  if (r.ledger.violations.length > 0) return { pass: false, why: `${r.ledger.violations.length} violation(s) on the parent's ledger: ${r.ledger.violations.join(' | ').slice(0, 200)}` }
  if (r.ledger.verdict.result?.timedOut) return { pass: false, why: 'the run timed out' }
  if (r.spawn.status !== 0) return { pass: false, why: `the runner exited ${r.spawn.status}` }
  return { pass: true, why: `verdict on the ledger, ${r.ledger.violations.length} violations, exit ${r.spawn.status}` }
}

/** Everything recorded about a run, from both sides. The needle checks below
 * use this so that a sabotage of the ledger reddens the checks that are ABOUT
 * the ledger rather than every escape check in the section. */
function rubyAllViolations(r) {
  // The runner's own list, taken from the ledger's copy of the result where
  // there is one - stdout's LAST object can be a candidate's forgery, and for
  // `escape_clear_record.lic` it deliberately is - plus every violation line
  // written as it happened.
  const reported = r.ledger.verdict?.result?.violations ?? r.result?.violations ?? []
  return [...reported, ...r.ledger.violations]
}

/** A fresh sandbox holding the fixtures and, optionally, a candidate. */
function rubySandbox(extraFiles = []) {
  rubyContainmentRuns += 1
  const home = join(RUBY_CONTAINMENT, `run-${rubyContainmentRuns}`)
  mkdirSync(home, { recursive: true })
  for (const name of readdirSync(RUBY_FIXTURES)) {
    if (name.endsWith('.lic')) copyFileSync(join(RUBY_FIXTURES, name), join(home, name))
  }
  for (const [from, to] of extraFiles) copyFileSync(from, join(home, to))
  return home
}

function rubyContainment(candidatePath) {
  const skip = (detail) => [{ name: 'E7 containment fixtures', status: 'not_checked', detail }]
  if (!RUBY) {
    return skip(`no working Ruby found; tried ${rubyCandidates().join(', ')}. This is not a pass.`)
  }
  if (!existsSync(RUBY_RUNNER) || !existsSync(RUBY_STUB)) {
    return skip(`${RUBY_RUNNER} does not exist, so there is no runner to contain a candidate in. This is not a pass.`)
  }

  const stem = candidatePath.slice(dirname(candidatePath).length + 1)
  const home = rubySandbox([[candidatePath, stem]])

  // The denominator: prove the driver can run something before letting it
  // judge anything.
  const control = rubyRun({ home, script: 'control_good.lic' })
  const controlVerdict = rubyVerdict(control)
  if (!controlVerdict.pass) {
    return skip(
      `the containment driver could not run its own known-good fixture: ` +
        `${controlVerdict.why}; ${(control.stderr || control.text).slice(0, 160)}. This is not a pass.`
    )
  }

  const r = rubyRun({ home, script: stem })
  const verdict = rubyVerdict(r)
  const runnerHash = md5(readFileSync(RUBY_RUNNER, 'utf8')).slice(0, 12)
  // The parent's record, not the child's. #486 got a clean-looking object past
  // the old form of this line three ways; what the candidate printed is still
  // shown, because a reviewer wants to see it, but it decides nothing.
  const detail =
    `ran out of process under ruby/runner.rb (md5 ${runnerHash}) sandboxed at ${home}; ` +
    `parent's ledger: ${verdict.why}; ` +
    (r.result
      ? `the run also printed sent=${JSON.stringify(r.result.sent)} violations=${JSON.stringify(r.result.violations)} errors=${JSON.stringify(r.result.errors).slice(0, 120)}`
      : `it printed no parseable JSON: ${(r.stderr || r.text).slice(0, 160)}`)
  return [
    {
      name: 'E7 containment fixtures',
      status: verdict.pass ? 'pass' : 'fail',
      detail,
    },
  ]
}

/** The Python driver's known-good fixture. A constant rather than an inline
 * literal because it is one string with several escapes in it, and this file
 * is edited by scripts often enough that `\n` collapsing to a real newline is
 * a live hazard rather than a theoretical one. */
const PY_GOOD_FIXTURE = ['"""A task that behaves."""', '', '', 'def main():', '    print("fixture: finished")', ''].join('\n')

function pythonContainment(candidatePath) {
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
  writeFileSync(join(dir, `${goodStem}.py`), PY_GOOD_FIXTURE, 'utf8')
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
}

/**
 * The one place that decides which containment driver runs a candidate.
 *
 * Keyed by language rather than by extension, because the language is what the
 * job already knows and an extension is a second name for the same fact - and
 * the app's Ruby scripts are `.lic` while this suite's fixtures are `.rb`, so
 * anything keyed on the extension would have to know both. A language with no
 * driver returns null and its caller says so; it never falls through to
 * somebody else's driver, which is the failure a dispatcher exists to prevent.
 */
const CONTAINMENT_DRIVERS = {
  ruby: { runner: 'ruby/runner.rb', drive: rubyContainment },
  typescript: { runner: 'typescript/runner.ts', drive: typescriptContainment },
  python: { runner: 'python/runner.py', drive: pythonContainment },
}
const containmentDriverFor = (lang) => CONTAINMENT_DRIVERS[lang] ?? null

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
      const driver = containmentDriverFor(lang)
      if (!driver || !driver.drive) {
        return [
          {
            name: 'E7 containment fixtures',
            status: 'not_checked',
            detail: `no containment driver is defined for ${lang}. This is not a pass.`,
          },
        ]
      }
      return driver.drive(candidatePath)
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

console.log('-- E7 containment for Ruby: the candidate runs out of process, in a sandbox, or not at all --')
{
  // This section used to be a skip and a check that the skip's reason was
  // still true ("no out-of-process Ruby runner exists"). `ruby/runner.rb`
  // exists now, so the reason is gone and the thing it stood in for runs.
  //
  // The denominator is the three task runners: all three must be where this
  // looks, or the section is measuring a broken path rather than a
  // containment property.
  const runners = [
    ['python/runner.py', existsSync(join(process.cwd(), 'python', 'runner.py'))],
    ['typescript/runner.ts', existsSync(TS_RUNNER)],
    ['ruby/runner.rb', existsSync(RUBY_RUNNER)],
  ]
  ok(
    'all three out-of-process task runners are where this check looks (positive control)',
    runners.every(([, found]) => found),
    runners.map(([p, found]) => `${p}=${found ? 'found' : 'MISSING'}`).join(' ')
  )

  if (!RUBY) {
    skip(
      'ruby E7 containment',
      `no working Ruby found; tried ${rubyCandidates().join(', ')}. ` +
        `ruby/runner.rb exists, so this is a missing interpreter and not a missing runner. ` +
        `Set DRC_RUBY to a ruby executable to run it. This is not a pass.`
    )
  } else {
    // ------------------------------------------------------------------
    // The shim, measured against what our own scripts call.
    // ------------------------------------------------------------------
    const shimOut = spawnSync(RUBY, [RUBY_RUNNER, '--shim'], { encoding: 'utf8', timeout: 60000 })
    let shim = null
    try {
      shim = JSON.parse(shimOut.stdout || '{}')
    } catch {
      shim = null
    }
    ok(
      'the shim prints its own surface, and every entry has a method behind it',
      shimOut.status === 0 && shim && Array.isArray(shim.missing) && shim.missing.length === 0 && shim.methods > 50,
      shim ? `${shim.methods} stub methods, ${shim.missing.length} advertised with nothing behind them` : (shimOut.stderr || '').slice(0, 200)
    )

    // Derived, not asserted: Ruby's own parser says which Lich names
    // `companion_bridge.lic` calls, and the shim is checked against that. A
    // grep could not tell a call from a word in a comment, and this list is
    // the whole reason to believe the shim is the right size.
    const BRIDGE = join(process.cwd(), 'lich-scripts', 'companion_bridge.lic')
    const surfaceOut = spawnSync(RUBY, [RUBY_RUNNER, '--surface', BRIDGE], { encoding: 'utf8', timeout: 60000 })
    let surface = null
    try {
      surface = JSON.parse(surfaceOut.stdout || '{}')
    } catch {
      surface = null
    }
    const provided = new Set(shim ? shim.surface.functions : [])
    if (shim) for (const [c, methods] of Object.entries(shim.surface.constants)) for (const m of methods) provided.add(`${c}.${m}`)
    const wanted = surface ? [...surface.functions, ...surface.constants] : []
    const uncovered = wanted.filter((w) => !provided.has(w))
    ok(
      'the shim covers every Lich name companion_bridge.lic actually calls',
      surface !== null && wanted.length >= 60 && uncovered.length === 0,
      `${wanted.length} calls found by Ruby's parser, ${uncovered.length} uncovered${uncovered.length ? `: ${uncovered.join(', ')}` : ''}`
    )
    // The negative control for that check: a name nothing provides must show
    // up as uncovered, or the comparison is a set that can only be empty.
    ok(
      'and that comparison can fail (negative control)',
      !provided.has('DRParanoia.definitely_not_a_real_call'),
      'a fabricated Lich name is not in the shim, so an uncovered call would be reported'
    )

    // ------------------------------------------------------------------
    // The fixtures. Each is one containment mechanism, run for real, and one
    // of the escape classes review pass 7 (#460) ran by hand against the
    // shipped runner. One fixture per class on purpose: `Contain::Violation`
    // descends from `Exception` and unwinds the whole script, so two classes in
    // one file means the second never executes - and a class that never ran
    // reads exactly like a class that was refused.
    //
    // The instrument is not the exit code. Every escape fixture writes
    // `ESCAPED_<class>.txt` into RUBY_OUTSIDE if its guard fails, and the
    // harness lists that directory after each run. An unguarded script doing
    // `File.write`, `system` and `IO.popen` into that directory was run first
    // and all three landed, so an empty listing here means a guard stopped
    // something rather than that this check cannot see a write.
    // ------------------------------------------------------------------
    const fixtureResults = []
    const escapeTable = []
    const rubyEscaped = () => (existsSync(RUBY_OUTSIDE) ? readdirSync(RUBY_OUTSIDE).filter((f) => f.startsWith('ESCAPED')) : [])

    /** A link inside the sandbox that resolves outside it: a junction on
     * Windows, a symlink on Linux, neither of which needs a privilege the CI
     * runner lacks. Created at test time and removed straight afterwards, so
     * nothing link-shaped is ever committed or left behind. The mechanism goes
     * into the check's detail line, which is how a CI log says which of the two
     * actually ran on that platform. */
    const rubyMakeLink = (home) => {
      const link = join(home, 'jlink')
      if (process.platform === 'win32') {
        const r = spawnSync('cmd', ['/c', 'mklink', '/J', link, RUBY_OUTSIDE], { encoding: 'utf8', timeout: 30000 })
        return { link, kind: 'junction (mklink /J)', made: r.status === 0, detail: ((r.stdout || '') + (r.stderr || '')).trim() }
      }
      try {
        symlinkSync(RUBY_OUTSIDE, link, 'dir')
        return { link, kind: 'symlink (ln -s)', made: true, detail: `${link} -> ${RUBY_OUTSIDE}` }
      } catch (e) {
        return { link, kind: 'symlink (ln -s)', made: false, detail: String(e && e.message) }
      }
    }
    /** `rmdir` and not `rmSync`, because a recursive delete through a junction
     * deletes what it points at. Everything here is under ROOT and goes anyway,
     * but a cleanup that follows a link is a habit worth not having. */
    const rubyRemoveLink = (link) => {
      try {
        if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', link], { encoding: 'utf8', timeout: 30000 })
        else unlinkSync(link)
      } catch {
        // The suite's own rmSync(ROOT) takes whatever is left.
      }
    }

    const runFixture = (script, { timeout = 10, wall = null, link = false } = {}) => {
      mkdirSync(RUBY_OUTSIDE, { recursive: true })
      for (const f of rubyEscaped()) rmSync(join(RUBY_OUTSIDE, f), { force: true })
      // What `escape_load.lic` tries to load. Written before every run and
      // checked afterwards: a `load` refused because the file was not there
      // would say nothing at all about the load guard.
      writeFileSync(join(RUBY_OUTSIDE, 'payload.rb'), 'PAYLOAD_RAN = true\n')
      const home = rubySandbox()
      const linked = link ? rubyMakeLink(home) : null
      const r = rubyRun({ home, script, timeout, wall })
      if (linked && linked.made) rubyRemoveLink(linked.link)
      const landed = rubyEscaped()
      fixtureResults.push(script)
      escapeTable.push({
        script,
        exit: r.spawn.status,
        violations: r.result ? r.result.violations.length : -1,
        ledgerViolations: r.ledger.violations.length,
        verdict: r.ledger.verdict ? 'yes' : 'NONE',
        landed,
      })
      return { ...r, home, landed, linked, payloadIntact: existsSync(join(RUBY_OUTSIDE, 'payload.rb')) }
    }

    /** Every escape fixture's shared shape: refused, named, and nothing on disk
     * outside the sandbox. All the needles are required, so a check cannot pass
     * on a violation belonging to a different class than the one under test -
     * which is how `escape_kernel_modfunc.lic` used to look refused when only
     * the first of its three attempts had run. */
    const refused = (r, ...needles) =>
      r.ledger.verdict !== null &&
      r.spawn.status === 3 &&
      r.landed.length === 0 &&
      needles.every((n) => rubyAllViolations(r).some((v) => v.includes(n)))
    const say = (r) =>
      r.ledger.verdict || r.result
        ? `exit ${r.spawn.status}, landed=[${r.landed.join(', ')}], ledger=${r.ledger.violations.length}v/${r.ledger.verdict ? 'verdict' : 'NO VERDICT'}, violations=${rubyAllViolations(r).join(' | ').slice(0, 220)}`
        : `NO RESULT AT ALL: ${(r.stderr || r.text).slice(0, 200)}`
    /** What the RUNNER reported, which is not always what stdout's last object
     * says: `escape_clear_record.lic` prints a forged object from its own
     * `at_exit`, after the real one, and that used to be the thing this driver
     * read. The ledger's copy is the runner's, so it is the one to quote when
     * a check is about what the run actually did. */
    const reported = (r) => r.ledger.verdict?.result ?? r.result
    const echoed = (r) => JSON.stringify(reported(r)?.echoed ?? []).slice(0, 260)

    const control = runFixture('control_good.lic')
    ok(
      'the known-good control runs clean under the runner (denominator)',
      control.spawn.status === 0 && control.result && control.result.violations.length === 0 && control.result.errors.length === 0,
      control.result ? `exit ${control.spawn.status}, ${control.result.echoed.length} echoed, ${control.result.violations.length} violations` : (control.stderr || control.text).slice(0, 200)
    )
    ok(
      'and what it tried to send is recorded rather than sent',
      control.result?.sent?.some((s) => s.via === 'fput' && s.text === 'kill rat'),
      JSON.stringify(control.result?.sent ?? [])
    )
    ok(
      'and a write INSIDE the sandbox is allowed, so the guard is a fence and not a wall',
      control.result?.echoed?.some((line) => line.includes('control_note.txt') && line.includes('control ran')),
      control.result?.echoed?.find((l) => l.includes('control_note')) ?? 'no line about the note'
    )

    const escapeFile = runFixture('escape_file.lic')
    ok(
      'a candidate reading outside the sandbox is a violation naming the path, not a crash',
      escapeFile.result !== null &&
        escapeFile.spawn.status === 3 &&
        escapeFile.result.violations.some((v) => v.includes('File.read') && v.includes('outside the sandbox')),
      escapeFile.result ? `exit ${escapeFile.spawn.status}: ${escapeFile.result.violations.join(' | ').slice(0, 150)}` : (escapeFile.stderr || escapeFile.text).slice(0, 200)
    )
    ok(
      'and the candidate could not swallow it with a bare rescue',
      escapeFile.result !== null && !escapeFile.result.echoed.some((l) => l.includes('swallowed')),
      JSON.stringify(escapeFile.result?.echoed ?? [])
    )

    const escapeSocket = runFixture('escape_socket.lic')
    ok(
      'a candidate opening a socket is a violation naming the host, not a NameError',
      escapeSocket.result !== null &&
        escapeSocket.spawn.status === 3 &&
        escapeSocket.result.violations.some((v) => v.includes('TCPSocket.new') && v.includes('example.invalid')),
      escapeSocket.result ? `exit ${escapeSocket.spawn.status}: ${escapeSocket.result.violations.join(' | ').slice(0, 150)}` : (escapeSocket.stderr || escapeSocket.text).slice(0, 200)
    )

    const escapeRequire = runFixture('escape_require.lic')
    ok(
      'the restricted load path refuses a require that is not on the allowlist',
      escapeRequire.result !== null &&
        escapeRequire.spawn.status === 3 &&
        escapeRequire.result.violations.some((v) => v.includes('require') && v.includes('socket')),
      escapeRequire.result ? `exit ${escapeRequire.spawn.status}: ${escapeRequire.result.violations.join(' | ').slice(0, 150)}` : (escapeRequire.stderr || escapeRequire.text).slice(0, 200)
    )

    // The parent's wall is the runner's own limit plus a grace window, so a
    // run that reported its own timeout at 2s and a run that had to be killed
    // at 8s are still distinguishable - which is what the sabotage turns on.
    // It used to be a flat 45s; #486 made it derived, because a constant wall
    // is one a candidate that stops the internal clock simply sits inside.
    const looping = runFixture('loop_forever.lic', { timeout: 2 })
    ok(
      'a candidate that loops forever is reported as a timeout by the runner itself',
      looping.result !== null && looping.result.timedOut === true && looping.spawn.status === 4,
      looping.result ? `exit ${looping.spawn.status}, timedOut=${looping.result.timedOut}, errors=${JSON.stringify(looping.result.errors)}` : `NO JSON RESULT - the child was killed from outside: ${(looping.stderr || looping.text).slice(0, 200)}`
    )
    ok(
      'and what it had already tried survives the clock',
      looping.result?.sent?.some((s) => s.text === 'search corpse'),
      JSON.stringify(looping.result?.sent ?? [])
    )

    // ------------------------------------------------------------------
    // The flags are a mechanism, so they are checked and not trusted.
    // ------------------------------------------------------------------
    {
      const home = rubySandbox()
      const withGems = spawnSync(RUBY, [RUBY_RUNNER, '--sandbox', home, '--script', 'control_good.lic'], { encoding: 'utf8', timeout: 60000 })
      ok(
        'the runner refuses to start without -W0 --disable-gems, naming what is missing',
        withGems.status === 2 && /--disable-gems/.test(withGems.stderr || ''),
        `exit ${withGems.status}: ${(withGems.stderr || '').trim().slice(0, 120)}`
      )

      const outside = spawnSync(
        RUBY,
        ['-W0', '--disable-gems', RUBY_RUNNER, '--sandbox', home, '--script', join('..', '..', 'control_good.lic')],
        { encoding: 'utf8', timeout: 60000 }
      )
      ok(
        'and refuses a script path that climbs out of the sandbox',
        outside.status === 2 && /outside the sandbox|no such script/.test(outside.stderr || ''),
        `exit ${outside.status}: ${(outside.stderr || '').trim().slice(0, 120)}`
      )
    }

    // ------------------------------------------------------------------
    // #460: the escape classes, one fixture each, all measured. Four of these
    // were open when review pass 7 ran them by hand and six more turned up
    // while closing those; the runner's header carries the before/after table.
    // ------------------------------------------------------------------

    // 1b/1c. The module-function forms of the load path. `Kernel.load` of an
    // absolute path outside the sandbox EXECUTED the payload before this, and
    // `Kernel.require` raised a silent LoadError that no report mentioned.
    const escapeLoad = runFixture('escape_load.lic')
    ok(
      "the load guard covers Kernel's own copies, not only the bare forms",
      refused(escapeLoad, 'load:', 'payload.rb', 'require: socket'),
      say(escapeLoad)
    )
    ok(
      'and the payload it was asked to load was really there (instrument)',
      escapeLoad.payloadIntact && !(escapeLoad.result?.echoed ?? []).some((l) => l.includes('LOADED IT')),
      `payload.rb still on disk=${escapeLoad.payloadIntact}; ${echoed(escapeLoad)}`
    )

    // 2. The junction. `File.expand_path` is lexical, so this wrote outside the
    // sandbox through a path that read as being inside it.
    const escapeJunction = runFixture('escape_junction.lic', { link: true })
    ok(
      `a link inside the sandbox that resolves outside it was created for this run: ${escapeJunction.linked?.kind}`,
      escapeJunction.linked?.made === true &&
        (escapeJunction.result?.echoed ?? []).some((l) => l.includes('link present=true resolves outside=true')),
      `${escapeJunction.linked?.kind}: made=${escapeJunction.linked?.made} ${escapeJunction.linked?.detail?.slice(0, 120)}; ${echoed(escapeJunction)}`
    )
    ok(
      'and a write through it is a violation naming the RESOLVED target, not a pass',
      refused(escapeJunction, 'File.write', 'resolves to', 'outside the sandbox'),
      say(escapeJunction)
    )

    // 3, 4, 5. The subprocess routes, each on its own so none is shadowed by
    // another raising first.
    const escapePopen = runFixture('escape_popen.lic')
    ok('IO.popen is refused and nothing is written outside', refused(escapePopen, 'IO.popen', 'ESCAPED_popen'), say(escapePopen))

    const escapeBacktick = runFixture('escape_backtick.lic')
    ok('backticks are refused and nothing is written outside', refused(escapeBacktick, 'Kernel#`', 'ESCAPED_backtick'), say(escapeBacktick))

    const escapeSystem = runFixture('escape_system.lic')
    ok('a bare system() is refused and nothing is written outside', refused(escapeSystem, 'Kernel#system', 'ESCAPED_system'), say(escapeSystem))

    const escapeSpawn = runFixture('escape_spawn.lic')
    ok('Process.spawn is refused and nothing is written outside', refused(escapeSpawn, 'Process.spawn', 'ESCAPED_spawn'), say(escapeSpawn))
    ok(
      'and Method#super_method past the guard lands on another guard, not on the original',
      (escapeSpawn.result?.echoed ?? []).some((l) => l.includes('super_method swallowed Contain::Violation')) &&
        (escapeSpawn.result?.violations.length ?? 0) >= 2,
      echoed(escapeSpawn)
    )

    // fork gets its own fixture for the reason pass 7 named about itself: in a
    // combined attempt Process.spawn raised first and fork never executed, so
    // the class was reported refused without having run.
    const escapeFork = runFixture('escape_fork.lic')
    ok(
      'fork is refused by this file and not by the platform',
      refused(escapeFork, 'Process.fork', 'Kernel#fork'),
      say(escapeFork)
    )

    // 5b/5c. The widest gap #460 left open: the guard was a module prepended to
    // Object, and module_function had already given Kernel its own singleton
    // copies, which are not in Object's ancestors at all.
    const escapeModfunc = runFixture('escape_kernel_modfunc.lic')
    ok(
      'Kernel.system, Kernel.spawn and an unbound Kernel#system are all refused',
      refused(escapeModfunc, 'Kernel#system', 'Kernel#spawn') && (escapeModfunc.result?.violations.length ?? 0) >= 3,
      say(escapeModfunc)
    )

    // 6. ObjectSpace needs no require, so the header's dismissal of it was
    // wrong; freezing Contain is what actually stops the widening.
    const escapeObjectSpace = runFixture('escape_objectspace.lic')
    ok(
      'ObjectSpace is a violation a reviewer can read, not a NoMethodError',
      refused(escapeObjectSpace, 'ObjectSpace.each_object', 'File.write'),
      say(escapeObjectSpace)
    )
    ok(
      'and widening the fence by instance_variable_set raises FrozenError',
      (escapeObjectSpace.result?.echoed ?? []).some((l) => l.includes('widening swallowed FrozenError')),
      echoed(escapeObjectSpace)
    )

    // 7. The guard's own methods, and the constant they hang from.
    const escapeDisarm = runFixture('escape_disarm.lic')
    ok(
      'redefining the guard raises before the escape, which is still refused',
      refused(escapeDisarm, 'File.write', 'ESCAPED_disarm'),
      say(escapeDisarm)
    )
    ok(
      'and the mechanism is Ruby freezing the module, named in the report',
      (escapeDisarm.result?.echoed ?? []).some((l) => l.includes('redefinition swallowed FrozenError')) &&
        (escapeDisarm.result?.echoed ?? []).some((l) => l.includes('removed the Contain constant')),
      echoed(escapeDisarm)
    )
    ok(
      'and removing the Contain constant still leaves one JSON object to read',
      escapeDisarm.result !== null && (escapeDisarm.result?.errors ?? []).every((e) => !e.includes('at_exit')),
      `${escapeDisarm.result ? 'parsed' : 'NO JSON'}; errors=${JSON.stringify(escapeDisarm.result?.errors ?? []).slice(0, 200)}`
    )

    // 8. The reporting hole. Nothing escaped here before either - the guards
    // never tear down - but the object a reviewer reads said violations: [].
    const escapeAtExit = runFixture('escape_atexit.lic')
    ok(
      'a violation raised inside at_exit reaches the JSON instead of vanishing',
      refused(escapeAtExit, 'File.write', 'ESCAPED_atexit') &&
        (escapeAtExit.result?.errors ?? []).some((e) => e.includes('at_exit')),
      say(escapeAtExit)
    )
    ok(
      'and the handler really ran (denominator: a marker written inside the sandbox)',
      existsSync(join(escapeAtExit.home, 'atexit_ran.txt')),
      `${join(escapeAtExit.home, 'atexit_ran.txt')} exists=${existsSync(join(escapeAtExit.home, 'atexit_ran.txt'))}`
    )

    // 9b/9c. Kernel#open, the pipe form of it, and the definition the guard
    // used to be merely sitting on top of.
    const escapeKernelOpen = runFixture('escape_kernel_open.lic')
    ok(
      "Kernel#open outside the sandbox is refused, and so is open('|cmd')",
      refused(escapeKernelOpen, 'Kernel#open', 'is a pipe, not a path'),
      say(escapeKernelOpen)
    )

    const escapeSuper = runFixture('escape_super_method.lic')
    ok(
      'IO.method(:write).super_method has nothing to call and nothing is written outside',
      escapeSuper.result !== null &&
        escapeSuper.landed.length === 0 &&
        (escapeSuper.result?.echoed ?? []).some((l) => l.includes('super_method swallowed NoMethodError')) &&
        (escapeSuper.result?.echoed ?? []).some((l) => l.includes('remove_method swallowed FrozenError')),
      `${say(escapeSuper)}; ${echoed(escapeSuper)}`
    )

    // ------------------------------------------------------------------
    // #486, review pass 8. Four more classes got a clean verdict past the
    // shipped runner, and the first three are one defect: the object this
    // driver judged was produced inside the process being judged. The verdict
    // is the parent's ledger now, and these are the checks that say so.
    // ------------------------------------------------------------------

    // The instrument for all of it. Without a nonce on the ledger there is no
    // parent-side record, and every check below would be reading an empty file
    // and finding nothing wrong with it - the exact shape of a check that
    // cannot fail.
    ok(
      'the parent seeds a nonce the candidate cannot read, and the runner stamps every line with it (instrument)',
      control.ledger.started === true && control.ledger.verdict !== null && control.ledger.foreign === 0 && control.ledger.records >= 2,
      `${control.ledger.records} stamped records, ${control.ledger.foreign} with the wrong nonce, verdict=${control.ledger.verdict ? 'present' : 'MISSING'}, ledger=${control.ledgerPath}`
    )

    // 10. `Contain.violations.clear`. The accessor handed out the live array,
    // `freeze` on a module is shallow, and `at_exit`'s re-check compares a
    // length that had gone DOWN, so `extra.positive?` was false. Measured
    // before: `violations: []`, `errors: []`, EXIT=0.
    const escapeClear = runFixture('escape_clear_record.lic')
    ok(
      'a candidate cannot empty the violation list: the accessor hands out a frozen copy',
      refused(escapeClear, 'File.write', 'ESCAPED_clear') &&
        (reported(escapeClear)?.echoed ?? []).some((l) => l.includes('clearing raised FrozenError')),
      `${say(escapeClear)}; ${echoed(escapeClear)}`
    )
    ok(
      "and the parent's ledger holds the violation whatever the candidate does to the copy",
      escapeClear.ledger.violations.length >= 1 && escapeClear.ledger.violations.some((v) => v.includes('ESCAPED_clear')),
      `${escapeClear.ledger.violations.length} on the ledger: ${escapeClear.ledger.violations.join(' | ').slice(0, 200)}`
    )
    // 5 in #486's numbering, and it only ever mattered together with 10: the
    // driver read the LAST object on stdout, and a candidate's `at_exit` runs
    // after the runner's emit. Stdout is advisory now, so the forgery is
    // visible and inert - which is a better outcome than it being absent,
    // because this check can see the attempt.
    ok(
      'a forged last object on stdout is not the verdict; the ledger is',
      escapeClear.result !== null &&
        escapeClear.result.violations.length === 0 &&
        (escapeClear.result.echoed ?? []).includes('all clean') &&
        rubyVerdict(escapeClear).pass === false,
      `stdout claimed ${JSON.stringify(escapeClear.result?.echoed ?? [])} with ${escapeClear.result?.violations.length} violations; ledger says ${rubyVerdict(escapeClear).why}`
    )

    // 11. `exit!` skips every `at_exit` handler, including the reporter, and
    // `STDOUT` is untouched by the `$stdout` capture swap. Measured before: a
    // forged object was the only thing on stdout and EXIT=0.
    const escapeExitBang = runFixture('escape_exit_bang.lic')
    ok(
      'exit! and Process.exit! are refused and named, so a candidate cannot skip the reporter',
      refused(escapeExitBang, 'Kernel#exit!', 'Process.exit!', 'ESCAPED_exitbang'),
      say(escapeExitBang)
    )
    ok(
      'and the forged object it printed through STDOUT first decides nothing',
      escapeExitBang.ledger.verdict !== null &&
        (escapeExitBang.ledger.verdict.result?.violations?.length ?? 0) >= 3 &&
        rubyVerdict(escapeExitBang).pass === false,
      `${rubyVerdict(escapeExitBang).why}; the run's first line on stdout was ${escapeExitBang.text.split('\n')[0]?.slice(0, 120)}`
    )

    // 12. `Contain.watchdog.kill`. Measured before: EXIT=124 from an external
    // limit and no JSON at all - the harness's own comment calls that the
    // interesting failure, and this was the reachable way to produce it.
    const escapeWatchdog = runFixture('escape_watchdog_kill.lic', { timeout: 3 })
    ok(
      'a candidate that stops the clock is killed by the parent inside its own grace window',
      escapeWatchdog.elapsed < 3000 + RUBY_GRACE_MS + 4000 && escapeWatchdog.spawn.error?.code === 'ETIMEDOUT',
      `killed after ${escapeWatchdog.elapsed}ms against a wall of ${escapeWatchdog.deadline}ms, spawn error ${escapeWatchdog.spawn.error?.code ?? 'none'}`
    )
    ok(
      'and a run that left no verdict is a FAIL naming that, never a pass',
      escapeWatchdog.ledger.verdict === null &&
        escapeWatchdog.ledger.started === true &&
        rubyVerdict(escapeWatchdog).pass === false &&
        /no verdict/.test(rubyVerdict(escapeWatchdog).why),
      `started=${escapeWatchdog.ledger.started}, verdict=${escapeWatchdog.ledger.verdict ? 'present' : 'none'}: ${rubyVerdict(escapeWatchdog).why}`
    )
    ok(
      'and it really did stop the clock, so this is the escape and not a slow fixture (denominator)',
      (escapeWatchdog.ledger.verdict === null) &&
        rubyEscaped().length === 0,
      `nothing outside the sandbox; the fixture sleeps 25s past a 3s runner timeout and produced no verdict in ${escapeWatchdog.elapsed}ms`
    )

    // 13. `Dir.new`, `Dir.home` and `File::Stat.new`: `Class#new` is inherited,
    // so neither constructor appeared in any hand-typed list here. Measured
    // before: a listing of `C:/Users`, a stat of a file outside, the home
    // directory, `violations: []`, EXIT=0.
    const escapeDirNew = runFixture('escape_dir_new.lic')
    ok(
      'Dir.new, File::Stat.new and Dir.home outside the sandbox are refused, naming the path',
      refused(escapeDirNew, 'Dir.new', 'File::Stat.new', 'Dir.home'),
      say(escapeDirNew)
    )
    ok(
      'and Dir.new INSIDE the sandbox still works, so the constructors are a fence and not a wall',
      (escapeDirNew.result?.echoed ?? []).some((l) => /Dir\.new INSIDE ok, \d+ entries/.test(l)),
      echoed(escapeDirNew)
    )

    // The denominator for the whole filesystem claim, and the thing whose
    // absence #486's fourth finding actually was: nothing had ever compared
    // the hand-typed lists in `runner.rb` against what Ruby provides. The
    // runner derives it at install time from `singleton_methods` plus the two
    // inherited constructors; a method in that set with no guard is a FAIL.
    const guards = control.result?.guards
    ok(
      `every read-shaped entry point on File, IO, Dir and File::Stat has a guard: ${guards?.examined ?? 0} examined`,
      guards && guards.examined >= 70 && Array.isArray(guards.unguarded) && guards.unguarded.length === 0,
      guards
        ? `${guards.guarded} of ${guards.examined} guarded${guards.unguarded.length ? `; UNGUARDED: ${guards.unguarded.join(', ')}` : ''}`
        : 'the control run reported no guard coverage at all'
    )

    // The hard rule, and the one that cannot be satisfied by a check nobody
    // wrote: whatever the individual assertions above say, nothing may be on
    // disk outside the sandboxes. A class that escapes is a FAIL here.
    const gotOut = escapeTable.filter((e) => e.landed.length > 0)
    ok(
      `no escape fixture put a file outside its sandbox: ${escapeTable.length} classes run`,
      gotOut.length === 0 && escapeTable.length >= 15,
      gotOut.length
        ? `ESCAPED: ${gotOut.map((e) => `${e.script} -> ${e.landed.join(', ')}`).join('; ')}`
        : escapeTable.map((e) => `${e.script}=exit${e.exit}/${e.ledgerViolations}v-ledger/${e.verdict}`).join(' ')
    )

    ok(
      `every containment fixture ran: ${fixtureResults.length} of ${readdirSync(RUBY_FIXTURES).filter((f) => f.endsWith('.lic')).length}`,
      fixtureResults.length === readdirSync(RUBY_FIXTURES).filter((f) => f.endsWith('.lic')).length,
      fixtureResults.join(', ')
    )
  }
}

console.log('-- the containment dispatcher picks by language, where the wrong answer is available --')
{
  // A chooser tested against a population with one option tests that the code
  // executes, which was never in doubt. Both runners exist and both can be
  // handed the other language's candidate, so the wrong answer is reachable.
  ok(
    'ruby is dispatched to ruby/runner.rb',
    containmentDriverFor('ruby')?.runner === 'ruby/runner.rb',
    String(containmentDriverFor('ruby')?.runner)
  )
  ok(
    'typescript is dispatched to typescript/runner.ts',
    containmentDriverFor('typescript')?.runner === 'typescript/runner.ts',
    String(containmentDriverFor('typescript')?.runner)
  )
  ok(
    'python is dispatched to python/runner.py',
    containmentDriverFor('python')?.runner === 'python/runner.py',
    String(containmentDriverFor('python')?.runner)
  )
  ok(
    'a language with no driver gets nothing rather than somebody else`s',
    containmentDriverFor('perl') === null && containmentDriverFor('') === null,
    'perl and "" both resolve to no driver'
  )

  if (!RUBY) {
    skip('the dispatcher choosing wrongly is detectable', `no working Ruby found; tried ${rubyCandidates().join(', ')}. This is not a pass.`)
  } else {
    // The half that makes the three checks above worth anything: if the two
    // drivers were interchangeable, choosing between them would not matter.
    const crossDir = join(ROOT, 'e7-cross')
    mkdirSync(crossDir, { recursive: true })
    const licPath = join(crossDir, 'crosscheck.lic')
    const tsPath = join(crossDir, 'crosscheck.ts')
    copyFileSync(join(RUBY_FIXTURES, 'control_good.lic'), licPath)
    writeFileSync(tsPath, '/** A task that behaves. */\nexport function main(): void {\n  console.log("cross: finished")\n}\n', 'utf8')

    const rubyOnRuby = containmentDriverFor('ruby').drive(licPath)
    ok('the Ruby driver passes a Ruby candidate', rubyOnRuby[0]?.status === 'pass', `${rubyOnRuby[0]?.status}: ${String(rubyOnRuby[0]?.detail).slice(0, 120)}`)

    const tsOnRuby = containmentDriverFor('typescript').drive(licPath)
    ok(
      'the TypeScript driver does NOT pass a Ruby candidate',
      tsOnRuby[0]?.status !== 'pass',
      `${tsOnRuby[0]?.status}: ${String(tsOnRuby[0]?.detail).slice(0, 120)}`
    )

    const rubyOnTs = containmentDriverFor('ruby').drive(tsPath)
    ok(
      'and the Ruby driver does NOT pass a TypeScript candidate',
      rubyOnTs[0]?.status !== 'pass',
      `${rubyOnTs[0]?.status}: ${String(rubyOnTs[0]?.detail).slice(0, 120)}`
    )
  }
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

// Sized well below the real count so it catches an empty or truncated run and
// never needs touching otherwise. Raised from 55 when the Ruby E7 section
// stopped being a skip and became real checks.
const FLOOR = 95
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
