/**
 * Break the Ruby containment on purpose and watch `test:ai-script-repair`
 * catch it.
 *
 * `ruby/runner.rb`'s own comments said, in the present tense, that removing
 * each guard block "is the suite's first/second/third/fourth sabotage", and
 * the commit that introduced them claimed "five sabotages, each reddening only
 * its own mechanism". Review pass 8 (#486, finding 6) went looking for them:
 *
 *     ls tools/ | grep -i "break\|sabot"      -> six break-checks, none for ruby
 *     grep -rlI "containment-break|runner-break|ruby-sabotage|contain-break" .
 *                                             -> nothing
 *
 * with a positive control on that grep (`command-lane-break-check` hits
 * `package.json`), so the search worked and the answer was real. The five had
 * been run by hand and left nothing behind, which makes the guard blocks'
 * removability a claim rather than a check - the exact thing this project
 * refuses to accept about anything else.
 *
 * This is the file that should have existed. Five sabotages, two files, each
 * one asserted to redden **exactly** the checks named beside it.
 *
 * # What this file is careful about
 *
 * **A green run first.** The unmodified tree must pass, or a red result later
 * could be this harness mangling a file rather than a sabotage landing.
 *
 * **A sabotage that changes nothing must abort, not pass.** Every fragment has
 * to be present exactly once before anything is written, and the damaged bytes
 * must differ. A `sed` that quietly edited the wrong line and reported a clean
 * pass is a documented afternoon lost on this machine.
 *
 * **Each case names what goes red AND what stays green.** A sabotage that
 * reddens more than its own mechanism means the checks are entangled and each
 * is saying less than it appears to. Asserting only "something failed" would
 * pass for a sabotage that broke the suite's own imports.
 *
 * **Restoration is verified by hash, before the next case runs.** A case that
 * starts from a damaged file measures the previous sabotage.
 *
 * Run: node tools/ai-script-repair-break-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { findRuby, rubyCandidates } from './find-ruby.mjs'
import { watchTree } from './break-check-tree.mjs'

const RUNNER = 'ruby/runner.rb'
const SUITE = 'tools/ai-script-repair-test.mjs'

/** The two files a case may damage, read once and restored from these bytes. */
const FILES = {
  [RUNNER]: readFileSync(RUNNER),
  [SUITE]: readFileSync(SUITE),
}
const HASHES = Object.fromEntries(
  Object.entries(FILES).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')])
)
/** Line endings differ between the two - `.gitattributes` pins `*.rb` to LF
 * while this repo's `.mjs` files are CRLF here - so a fragment typed with the
 * wrong one matches nothing and the "present exactly once" guard fires. Each
 * fragment is normalised to its own file's ending rather than assumed. */
const NL = Object.fromEntries(
  Object.entries(FILES).map(([path, bytes]) => [path, bytes.toString('utf8').includes('\r\n') ? '\r\n' : '\n'])
)
const eol = (path, text) => text.replace(/\r?\n/g, NL[path])

let checks = 0
let failures = 0
let notChecked = 0

function ok(pass, what, detail = '') {
  checks++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${what}${!pass && detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}

function restoreAll() {
  for (const [path, bytes] of Object.entries(FILES)) writeFileSync(path, bytes)
}

function hashesMatch() {
  return Object.entries(HASHES).every(
    ([path, want]) => createHash('sha256').update(readFileSync(path)).digest('hex') === want
  )
}

// The "before" reading, taken before anything is damaged. It asserts that this
// run changed nothing, not that the checkout was tidy - these harnesses are run
// while somebody is editing. See tools/break-check-tree.mjs.
const treeBack = watchTree([RUNNER, SUITE])

// Both files are tracked and one of them is the runner a reviewer's candidate
// is contained by. Leaving either damaged is the only outcome worse than
// having no negative test at all.
process.on('exit', () => {
  if (!hashesMatch()) {
    console.log('FAIL a file was left damaged — restoring')
    restoreAll()
    process.exitCode = 1
    return
  }
  // The hashes prove these two files came back; only git can see anything else
  // this run left behind - a fixture written and not removed, a restore with
  // the wrong line endings. See tools/break-check-tree.mjs.
  if (treeBack(0) !== 0) process.exitCode = 1
})

/** Run the suite and return every `FAIL <name>` it printed. */
function runSuite() {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', SUITE], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15 * 60 * 1000,
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const failed = out
    .split('\n')
    .filter((l) => l.startsWith('FAIL '))
    .map((l) => l.slice(5).trim())
  const tally = out.match(/(\d+) passed, (\d+) failed, (\d+) not checked/)
  return { status: r.status, out, failed, tally: tally ? tally[0] : 'no tally line' }
}

/* ---------------------------------------------------------------- green -- */

const ruby = findRuby()
if (!ruby) {
  // Three states. Without an interpreter every sabotage below would produce a
  // NOT CHECKED from the suite rather than a red, and reading that as a pass
  // is the whole failure this file exists to prevent.
  console.log(
    `NOT CHECKED  no working Ruby found; tried ${rubyCandidates().join(', ')}. ` +
      `Every sabotage here reddens a Ruby containment check, so there is nothing to measure. This is not a pass.`
  )
  console.log('\nno failures, but 1 not checked: the whole of this break-check')
  process.exitCode = 0
} else {
  console.log('-- the undamaged tree passes, or nothing below means anything --')
  const baseline = runSuite()
  ok(baseline.status === 0 && baseline.failed.length === 0, `${SUITE} passes unmodified`, `${baseline.tally}; ${baseline.failed.join(' | ').slice(0, 400)}`)
  ok(/0 not checked/.test(baseline.out), 'and with nothing unchecked, so a skip cannot be standing in for a red', baseline.tally)
  if (baseline.status !== 0 || baseline.failed.length > 0) {
    console.log('\naborting: the baseline is not green, so a red sabotage would prove nothing')
    process.exitCode = 1
    process.exit()
  }
  console.log(`     baseline: ${baseline.tally}`)

  /* ------------------------------------------------------------ sabotages -- */

  /**
   * The five the runner's comments have been claiming since #469, plus the
   * two #486 added. `red` is the exact set of check names that must go red -
   * exact, so a sabotage that reddens a neighbour is a failure of this file
   * and not a detail.
   */
  const CASES = [
    {
      name: '1. the junction fence: File.realpath goes back to the lexical File.expand_path',
      file: RUNNER,
      from: '        return canonical(File.realpath(abs))',
      to: '        return canonical(File.expand_path(abs))',
      red: [
        'and a write through it is a violation naming the RESOLVED target, not a pass',
        'no escape fixture put a file outside its sandbox: 22 classes run',
      ],
    },
    {
      name: '2. the guard is left unfrozen, so it can be reopened and widened',
      file: RUNNER,
      from: '      Kernel.freeze\n      freeze\n      singleton_class.freeze',
      to: '      Kernel.freeze',
      red: [
        'and widening the fence by instance_variable_set raises FrozenError',
        'redefining the guard raises before the escape, which is still refused',
        'and the mechanism is Ruby freezing the module, named in the report',
        'ObjectSpace is a violation a reviewer can read, not a NoMethodError',
        'no escape fixture put a file outside its sandbox: 22 classes run',
      ],
    },
    {
      name: "3. the record stops leaving the process, so the parent's copy is the candidate's",
      file: RUNNER,
      from: "      ledger!('violation', 'message' => message)\n",
      to: '',
      red: ["and the parent's ledger holds the violation whatever the candidate does to the copy"],
    },
    {
      name: '4. exit! comes off the refused lists, so a candidate can skip the reporter',
      file: RUNNER,
      from: '  KERNEL_EXIT_OPS = %i[exit!].freeze\n  PROCESS_REFUSED = %i[spawn exec fork _fork kill daemon detach exit!].freeze',
      to: '  KERNEL_EXIT_OPS = %i[].freeze\n  PROCESS_REFUSED = %i[spawn exec fork _fork kill daemon detach].freeze',
      red: [
        'exit! and Process.exit! are refused and named, so a candidate cannot skip the reporter',
        'and the forged object it printed through STDOUT first decides nothing',
      ],
    },
    {
      name: "5. the parent's wall becomes a large constant again, so stopping the clock works",
      file: SUITE,
      from: '  const deadline = wall ?? timeout * 1000 + RUBY_GRACE_MS',
      to: '  const deadline = wall ?? 60000',
      red: [
        'a candidate that stops the clock is killed by the parent inside its own grace window',
        'and a run that left no verdict is a FAIL naming that, never a pass',
        'and it really did stop the clock, so this is the escape and not a slow fixture (denominator)',
      ],
    },
  ]

  for (const c of CASES) {
    console.log(`\n-- sabotage: ${c.name} --`)
    const text = FILES[c.file].toString('utf8')
    const from = eol(c.file, c.from)
    const count = text.split(from).length - 1
    ok(count === 1, `the fragment is present exactly once in ${c.file} (found ${count})`)
    if (count !== 1) continue

    const damaged = text.replace(from, eol(c.file, c.to))
    ok(damaged !== text, 'and the sabotage actually changes the file')
    if (damaged === text) continue
    writeFileSync(c.file, damaged, 'utf8')

    let run
    try {
      run = runSuite()
    } finally {
      restoreAll()
    }

    // Not "something failed". The named set, exactly: a sabotage that reddens
    // a neighbour means the two checks were never independent, and a sabotage
    // that reddens everything usually means the file no longer parses.
    const want = [...c.red].sort()
    const got = [...new Set(run.failed.map((l) => l.split('  ')[0].trim()))].sort()
    const missing = want.filter((w) => !got.some((g) => g.startsWith(w)))
    const extra = got.filter((g) => !want.some((w) => g.startsWith(w)))
    ok(run.status !== 0, 'the suite goes red', run.tally)
    ok(missing.length === 0, `and it reddens every check this sabotage is aimed at (${want.length})`, `missing: ${missing.join(' | ')}`)
    ok(extra.length === 0, 'and reddens nothing else, so the checks are independent', `also red: ${extra.join(' | ')}`)
    console.log(`     ${run.tally}; red: ${got.join(' | ').slice(0, 500)}`)

    // Restored and verified before the next case, not only at exit.
    ok(hashesMatch(), 'both files are restored, verified by hash')
  }

  console.log(
    `${notChecked ? `\nno failures, but ${notChecked} not checked` : ''}` +
      (failures ? `\n${failures} of ${checks} break-check assertions failed` : `\nall ${checks} break-check assertions passed`)
  )
  process.exitCode = failures ? 1 : 0
}
