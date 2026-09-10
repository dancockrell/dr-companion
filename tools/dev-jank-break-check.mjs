/**
 * The negative suite for tools/dev-jank-test.mjs.
 *
 *   node tools/dev-jank-break-check.mjs
 *
 * A guard that cannot fail is worth nothing, and reading it does not establish
 * that it can. This plants one piece of developer furniture at a time, in the
 * real files, runs the guard, and asserts that exactly the named check goes
 * red - then puts the file back and confirms the restore byte for byte.
 *
 * The rules are `ui-jargon-break-check.mjs`'s, and each has burned somebody
 * on this machine:
 *
 *   - a fragment that is not found is an abort, not a pass. A sabotage that
 *     edits nothing rewrites the file unchanged, the guard stays green, and
 *     the output reads exactly like proof.
 *   - the run must be green before any sabotage, or a red line from something
 *     else is indistinguishable from a sabotage landing.
 *   - a case names every check it expects to redden, and reddening one it did
 *     not name is a failure too.
 *
 * # The case that matters most is the first one
 *
 * `the counter is moved back out of the disclosure` reconstructs the exact
 * defect Dan saw on 9 September 2026: a bare "Unreviewed events" counter in
 * front of a player. If that case ever stops reddening, this whole lane has
 * been undone and nothing else here would say so.
 *
 * Deliberately not an npm script and not in tools/test-suites.json: it writes
 * to tracked files, so it must never run inside the ordinary suite, least of
 * all on a machine where another session may be editing the same tree.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { watchTree } from './break-check-tree.mjs'

const PANEL = 'src/components/shared/AiWorkerPanel.tsx'
const GUARD = 'tools/dev-jank-test.mjs'

const CASES = [
  {
    // The instance. A counter, in front, with no disclosure around it - which
    // is what the panel looked like when it was called jank that does not
    // belong in front of a customer.
    what: 'a counter is rendered in front of the player again',
    file: PANEL,
    from: '          <p className="text-xs text-ink-muted leading-snug">\n            The assistant is off. It needs a model running on this computer.\n          </p>',
    to: '          <p className="text-xs text-ink-muted leading-snug">\n            Unreviewed events {status.journalPending}\n          </p>',
    expect: 'no default-visible surface renders a bare internal counter',
  },
  {
    // The other half: an internal state name as prose, outside any disclosure.
    what: 'an internal state name is rendered as prose',
    file: PANEL,
    from: '            The assistant is off. It needs a model running on this computer.',
    to: '            The assistant is off, and the job is awaiting_review.',
    expect: 'no default-visible surface renders an internal state name',
  },
  {
    // The fix itself, undone. Opening the disclosure into a plain div puts
    // every number back in front without changing one character of the text,
    // which is precisely the regression a wording-based check could not see.
    what: 'the disclosure is turned back into a plain div',
    file: PANEL,
    from: '    <details className="rounded border border-border bg-surface px-2 py-1.5">',
    to: '    <div className="rounded border border-border bg-surface px-2 py-1.5">',
    // Only the counter scan, and the reason is worth writing down rather than
    // being tuned into a pass: the disclosure holds six counters and no
    // *unquoted* internal state name - `state.replace('_', ' ')` builds the
    // job line from a variable, and every literal in there is quoted, which
    // the string stripper removes as code. So exposing the block exposes
    // counters only. Naming the state scan here would have been asserting
    // something untrue about what the block contains; this case was written
    // expecting both and corrected by running it.
    expect: 'no default-visible surface renders a bare internal counter',
  },
  {
    // Sabotage the checker, not only the thing checked. With the disclosure
    // stripper gutted, the panel's own committed details block reads as
    // exposed - so the two scans and the negative control all go red, and
    // naming all three is what proves the stripper is load-bearing for each.
    what: 'the disclosure stripper is gutted (checker sabotage)',
    file: GUARD,
    from: '  return stripDetails(noStrings)',
    to: '  return noStrings',
    // Three checks, for the same reason as the case above: the tree's only
    // committed disclosure contains counters, so the state scan has nothing to
    // find there. The two controls are what prove the stripper is load-bearing
    // for the exemption itself rather than only for this one file.
    expect: [
      'no default-visible surface renders a bare internal counter',
      'negative control: the same text inside a details disclosure is not flagged',
      'a nested disclosure does not expose the text after it',
    ],
  },
  {
    // The English filter. Without it `running`, `failed` and `absent` are
    // banned words and the tree lights up - the exact way this check would
    // become one that cries wolf and gets switched off. The guard asserts it
    // directly, and that assertion has to be the thing that catches this.
    what: 'the English filter is removed (checker sabotage)',
    file: GUARD,
    from: 'const BANNED_STATES = [...new Set(stateNames.filter((s) => s.includes(\'_\')))].sort(',
    to: 'const BANNED_STATES = [...new Set(stateNames)].sort(',
    expect: [
      'ordinary English state words are not banned',
      'no default-visible surface renders an internal state name',
    ],
  },
  {
    // The newline-preserving blanker. Every hit is still found and every line
    // number is wrong, which is a false pointer wearing a tick, so the
    // line-number guard has to catch it alone.
    what: 'the blanker stops preserving newlines (checker sabotage)',
    file: GUARD,
    from: "const blank = (s) => s.replace(/[^\\n]/g, '')",
    to: "const blank = () => ''",
    expect: 'a hit reports the real line number',
  },
  {
    // The denominator. A union that parses to nothing must abort naming the
    // reason rather than scanning against an empty name set and passing: an
    // empty BANNED_STATES finds nothing anywhere, which is the exact shape of
    // "all clear".
    what: 'the state union is emptied (denominator sabotage)',
    file: 'src/lib/aiJobStore.ts',
    from: "export type JobStatus =",
    to: "export type JobStatusRenamed =",
    expectAbort: true,
  },
]

const md5 = (s) => createHash('md5').update(s).digest('hex')

const run = () => {
  try {
    return { out: execFileSync(process.execPath, [GUARD], { encoding: 'utf8' }), code: 0 }
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: e.status ?? 1 }
  }
}

/** The names of the checks that printed FAIL, in the guard's own wording. */
const redLines = (out) =>
  out
    .split('\n')
    .filter((l) => l.startsWith('FAIL'))
    .map((l) => l.slice(4).trim().split(/\s{2,}/)[0])

const baseline = run()
if (redLines(baseline.out).length !== 0 || baseline.code !== 0) {
  console.error(
    'ABORT: dev-jank-test is already red before any sabotage. Fix that first - nothing below would mean anything.',
  )
  console.error(baseline.out)
  process.exit(2)
}
const baselineChecks = Number(baseline.out.match(/^(\d+) checks, /m)?.[1] ?? 0)
if (baselineChecks < 12) {
  console.error(`ABORT: the baseline run reported ${baselineChecks} checks, which is not a run.`)
  process.exit(2)
}
console.log(`baseline: dev-jank-test is green with ${baselineChecks} checks\n`)

const treeBack = watchTree([...new Set(CASES.map((c) => c.file))])

let bad = 0
for (const c of CASES) {
  const orig = readFileSync(c.file, 'utf8')
  const before = md5(orig)
  // The tree is CRLF here and these fragments are written with LF, so match
  // both. A fragment that "is not there" because of a carriage return is the
  // sabotage editing nothing and reading as a pass - CLAUDE.md section 17.
  const from = orig.includes(c.from) ? c.from : c.from.split('\n').join('\r\n')
  const to = orig.includes(c.from) ? c.to : c.to.split('\n').join('\r\n')
  if (!orig.includes(from)) {
    console.error(
      `ABORT ${c.file}: the fragment to break is not there, so this case would edit nothing and pass. ${JSON.stringify(c.from)}`,
    )
    process.exit(2)
  }
  const damaged = orig.replace(from, to)
  if (damaged === orig) {
    console.error(`ABORT ${c.file}: the sabotage changed nothing. ${JSON.stringify(c.from)}`)
    process.exit(2)
  }
  writeFileSync(c.file, damaged)
  const { out, code } = run()
  writeFileSync(c.file, orig)
  if (md5(readFileSync(c.file, 'utf8')) !== before) {
    console.error(
      `ABORT ${c.file}: the restore did not reproduce the original bytes. Recover it from git before doing anything else.`,
    )
    process.exit(2)
  }

  const red = redLines(out)
  if (c.expectAbort) {
    // The parser must refuse, naming the reason, and exit non-zero. A green
    // run here would mean an empty name set reads as a clean tree.
    const aborted = code !== 0 && /could not derive the name sets/.test(out)
    if (!aborted) bad++
    console.log(
      `${aborted ? 'OK  ' : 'FAIL'} ${c.what}\n       exit ${code}: ${out.split('\n')[0]}`,
    )
    continue
  }
  const want = Array.isArray(c.expect) ? c.expect : [c.expect]
  const hit = want.every((w) => red.includes(w))
  const extra = red.filter((r) => !want.includes(r))
  if (!hit || extra.length) bad++
  console.log(
    `${hit && !extra.length ? 'OK  ' : 'FAIL'} ${c.what}\n       want: ${JSON.stringify(want)}\n       red:  ${JSON.stringify(red)}`,
  )
}

console.log(
  `\n${CASES.length} sabotages across ${new Set(CASES.map((c) => c.file)).size} files; ${bad} did not redden exactly the checks they named`,
)
process.exit(treeBack(bad ? 1 : 0))
