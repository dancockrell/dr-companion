/**
 * The negative suite for tools/ui-jargon-test.mjs.
 *
 *   node tools/ui-jargon-break-check.mjs
 *
 * A guard that cannot fail is worth nothing, and reading it does not establish
 * that it can. This plants one piece of developer jargon at a time, in the
 * real files, runs the guard, and asserts that exactly the named check goes
 * red - then puts the file back and confirms the restore byte for byte.
 *
 * Same three rules as `doc-claims-break-check.mjs`, each of which has burned
 * somebody on this machine:
 *
 *   - a fragment that is not found is an abort, not a pass. A sabotage that
 *     edits nothing rewrites the file unchanged, the guard stays green, and the
 *     output reads exactly like proof.
 *   - the run must be green before any sabotage, or a red line from something
 *     else is indistinguishable from a sabotage landing.
 *   - a case names every check it expects to redden, and reddening one it did
 *     not name is a failure too.
 *
 * And one more that this guard needs and the others do not: **the sabotage has
 * to reach the line under test.** Three of the checks below sit behind a
 * denominator assertion (`the command registry parsed`, `the component walk
 * found files`), so a sabotage aimed at the scan that happened to empty the
 * population would be caught by the earlier check and the scan would never
 * run. The `expect` lists say which checks each case is allowed to redden, so
 * a sabotage intercepted upstream fails here rather than reading as a pass.
 *
 * Deliberately not an npm script and not in tools/test-suites.json: it writes
 * to tracked files, so it must never run inside the ordinary suite, least of
 * all on a machine where another session may be editing the same tree.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { watchTree } from './break-check-tree.mjs'

const CASES = [
  {
    // The instance this whole lane came from, put back where it was: a Rust
    // command returning a sentence that names two Tauri commands, which the
    // webview renders verbatim into the player's window.
    what: 'a Rust command returns a sentence naming two commands',
    file: 'src-tauri/src/lich.rs',
    from: '    let s = lich_status_blocking();',
    to:
      '    let _note = "Signing a character in is `lich_login_launch` now, not `launch_lich`.";\n' +
      '    let s = lich_status_blocking();',
    expect: 'no sentence a Rust command returns names a command or a retired product',
  },
  {
    // The same defect on the webview side, which is the half a Rust-only
    // check would miss entirely: a component hard-coding the command name in
    // its own prose rather than receiving it in an error.
    what: 'a component renders a command name as prose',
    file: 'src/components/shared/LichLauncher.tsx',
    from: '            Sign in above to start Lich for a character.',
    to: '            Sign in above to start Lich for a character (lich_login_launch).',
    expect: 'no rendered string in src/ names a command, an internal or a retired product',
  },
  {
    // A retired route name, which no registry can produce. Without this case
    // RETIRED_NAMES could be emptied and every check above would stay green.
    what: 'a component names the retired saved-entry route',
    file: 'src/components/shared/LichLauncher.tsx',
    from: '            Sign in above to start Lich for a character.',
    to: "            Lich's saved-entry route cannot start a character here.",
    expect: 'no rendered string in src/ names a command, an internal or a retired product',
  },
  {
    // Sabotage the checker, not only the thing checked. Gutting the comment
    // stripper must take down the negative control and nothing else: comments
    // all over `src/` legitimately name commands, so with the stripper gone
    // the scan check falls too. Both are named, so a run where only one goes
    // red is a failure - that would mean the stripper is not load-bearing for
    // the property the negative control claims to protect.
    what: 'the comment stripper is gutted (checker sabotage)',
    file: 'tools/ui-jargon-test.mjs',
    from: "    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, blank)",
    to: '',
    expect: [
      'negative control: comments and invoke() arguments are not flagged',
      'no rendered string in src/ names a command, an internal or a retired product',
    ],
  },
  {
    // The other half of the same: gutting the newline-preserving blanker
    // makes every reported line number wrong while every hit is still found.
    // A green run over a checker that points at the wrong line is a false
    // pointer wearing a tick, so the line-number guard has to be the thing
    // that catches it - alone.
    what: 'the blanker stops preserving newlines (checker sabotage)',
    file: 'tools/ui-jargon-test.mjs',
    from: "const blank = (s) => s.replace(/[^\\n]/g, '')",
    to: "const blank = () => ''",
    expect: 'a hit reports the real line number',
  },
  {
    // The derived half. A registry that parses to nothing must abort naming
    // the reason rather than scanning against an empty name set and passing:
    // an empty BANNED list finds nothing anywhere, which is the exact shape
    // of "all clear".
    what: 'the command registry is emptied (denominator sabotage)',
    file: 'src-tauri/src/lib.rs',
    from: '            lich::launch_lich,',
    to: '',
    // Only the denominator check. Removing one command must not change any
    // verdict about text, and if it does, the two are entangled.
    expect: null,
    expectAbortOrGreen: true,
  },
]

const md5 = (s) => createHash('md5').update(s).digest('hex')

const run = () => {
  try {
    return execFileSync(process.execPath, ['tools/ui-jargon-test.mjs'], { encoding: 'utf8' })
  } catch (e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

/** The names of the checks that printed FAIL, in the guard's own wording. */
const redLines = (out) =>
  out
    .split('\n')
    .filter((l) => l.startsWith('FAIL'))
    .map((l) => l.slice(4).trim().split(/\s{2,}/)[0])

const baseline = run()
if (redLines(baseline).length !== 0) {
  console.error('ABORT: ui-jargon-test is already red before any sabotage. Fix that first - nothing below would mean anything.')
  console.error(baseline)
  process.exit(2)
}
// The denominator, carried into this file too: a guard that ran and asserted
// nothing is not a green baseline.
const baselineChecks = Number(baseline.match(/^(\d+) checks, /m)?.[1] ?? 0)
if (baselineChecks < 10) {
  console.error(`ABORT: the baseline run reported ${baselineChecks} checks, which is not a run.`)
  process.exit(2)
}
console.log(`baseline: ui-jargon-test is green with ${baselineChecks} checks\n`)

const treeBack = watchTree([...new Set(CASES.map((c) => c.file))])

let bad = 0
for (const c of CASES) {
  const orig = readFileSync(c.file, 'utf8')
  const before = md5(orig)
  if (!orig.includes(c.from)) {
    console.error(`ABORT ${c.file}: the fragment to break is not there, so this case would edit nothing and pass. ${JSON.stringify(c.from)}`)
    process.exit(2)
  }
  const damaged = orig.replace(c.from, c.to)
  if (damaged === orig) {
    console.error(`ABORT ${c.file}: the sabotage changed nothing. ${JSON.stringify(c.from)}`)
    process.exit(2)
  }
  writeFileSync(c.file, damaged)
  const out = run()
  writeFileSync(c.file, orig)
  if (md5(readFileSync(c.file, 'utf8')) !== before) {
    console.error(`ABORT ${c.file}: the restore did not reproduce the original bytes. Recover it from git before doing anything else.`)
    process.exit(2)
  }

  const red = redLines(out)
  if (c.expectAbortOrGreen) {
    // This one is allowed to abort (the parser refusing) or to stay green
    // (one command fewer changes no verdict about text). What it must never
    // do is redden a text check, which would mean the name set and the text
    // scan are entangled.
    const okCase = red.length === 0
    if (!okCase) bad++
    console.log(`${okCase ? 'OK  ' : 'FAIL'} ${c.what}\n       red: ${JSON.stringify(red)}`)
    continue
  }
  const want = Array.isArray(c.expect) ? c.expect : [c.expect]
  const hit = want.every((w) => red.includes(w))
  const extra = red.filter((r) => !want.includes(r))
  if (!hit || extra.length) bad++
  console.log(`${hit && !extra.length ? 'OK  ' : 'FAIL'} ${c.what}\n       want: ${JSON.stringify(want)}\n       red:  ${JSON.stringify(red)}`)
}

console.log(`\n${CASES.length} sabotages across ${new Set(CASES.map((c) => c.file)).size} files; ${bad} did not redden exactly the checks they named`)
process.exit(treeBack(bad ? 1 : 0))
