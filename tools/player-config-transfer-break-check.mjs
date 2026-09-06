/**
 * Sabotage `tools/player-config-transfer-test.mjs`: break one thing at a time
 * and prove the suite goes red for it, and only for it.
 *
 *   node tools/player-config-transfer-break-check.mjs
 *
 * # Why this is a committed tool and not a paragraph in a pull request
 *
 * "I broke it and the test caught it" is a claim; this is the command. It is
 * also the thing that keeps catching: a check that stops working stays green
 * forever otherwise, and the run that discovers it is the one where somebody
 * shipped the bug it was written for.
 *
 * # What each case has to do
 *
 * Four rules, and the first two are the ones that make a sabotage suite mean
 * anything:
 *
 * - **A sabotage that changes nothing is a hard abort, never a pass.** An
 *   anchor that has drifted rewrites the file unchanged, the suite passes, and
 *   the output reads "this check is not needed" when it means "the test did
 *   nothing".
 * - **A sabotage that reddens nothing while exiting non-zero is a crash, not a
 *   catch.** The dropped-domain case did exactly that when this was first
 *   written: `doc[domain].length` threw, the suite exited 1 with no FAIL line,
 *   and the runner would have counted it as caught. So a case must name the
 *   checks it expects to see reddened, and a red count of zero is a failure of
 *   the sabotage rather than a success of the test.
 * - **The named checks must actually appear.** Not merely "something failed".
 * - **The file is restored byte for byte and the md5 is compared**, because
 *   these edit the real tree.
 *
 * One case deliberately records what does *not* catch it. Dropping a domain
 * from the serialiser leaves the round trip byte-identical - both exports come
 * from the same broken serialiser and agree perfectly - which is why the suite
 * carries a manifest check naming the seven domains rather than relying on the
 * two exports matching. Counting what is present cannot detect what is absent.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { watchTree } from './break-check-tree.mjs'

const SUITE = 'tools/player-config-transfer-test.mjs'
const CR = String.fromCharCode(13)

const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex')

function run() {
  const r = spawnSync(process.execPath, [SUITE], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const reds = out
    .split('\n')
    .filter((l) => l.startsWith('FAIL'))
    .map((l) => l.slice(4).trim())
  // Read from `status` directly. A null status means the process was killed or
  // never started, which is not a zero.
  return { code: r.status === null ? -1 : r.status, reds, out }
}

/**
 * Each case names the file, the exact text to replace, and the substrings that
 * must appear among the reddened check names. The expectations are words a
 * reader can check against the suite's own output, not counts, because a count
 * goes stale the first time a check is added beside it.
 */
const CASES = [
  {
    label: 'the per-domain editor validation is dropped',
    file: 'src/lib/playerConfigTransfer.ts',
    find: '      const no = editorRefusal(domain, entry)',
    replace: '      const no = null && editorRefusal(domain, entry)',
    expect: ['bad highlight is refused', 'bookkeeping variable is refused'],
  },
  {
    label: 'the export stops passing expectedPrevious',
    file: 'src/lib/playerConfigTransfer.ts',
    find: [
      '  const written = await writePlayerFile(',
      '    PLAYER_CONFIG_LEAF,',
      '    text,',
      "    current.found ? current.text : ''",
      '  )',
    ].join('\n'),
    replace: ['  void current', '  const written = await writePlayerFile(PLAYER_CONFIG_LEAF, text)'].join('\n'),
    expect: ['stale view is refused', 'expectedPrevious'],
  },
  {
    label: 'a version this build cannot read is accepted',
    file: 'src/lib/exportEnvelope.ts',
    find: "  if (typeof version !== 'number' || (version !== spec.version && !migratable.includes(version))) {",
    replace: '  if (false) {',
    expect: ['version this build cannot read', 'names the version'],
  },
  {
    label: 'one domain is dropped from the export',
    file: 'src/lib/playerConfigTransfer.ts',
    find: '  for (const domain of DOMAINS) ordered[domain] = doc[domain]',
    replace: "  for (const domain of DOMAINS) if (domain !== 'gags') ordered[domain] = doc[domain]",
    expect: ['names every one of the seven domains', 'came back with the entries'],
  },
]

/*
 * Reported as OK/FAIL lines at the start of a line, because that is what
 * `tools/run-tests.mjs` counts, and a suite it counts zero checks in is filed
 * as NOT RUN rather than as a pass - correctly. The mutant runs' own output is
 * indented under each case so the runner does not read another suite's
 * failures as this one's.
 */
// The "before" reading, taken before anything is damaged: this asserts that
// the run changed nothing, not that the checkout was tidy. See
// tools/break-check-tree.mjs.
const treeBack = watchTree([...new Set(CASES.map((c) => c.file))])

let bad = 0
let checked = 0
const note = (s) => console.log(s)
const ok = (name, cond, detail = '') => {
  checked += 1
  if (!cond) bad += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}

{
  const { code, reds, out } = run()
  if (code !== 0 || reds.length > 0) console.log(out.slice(-2000))
  ok('the suite is green before any sabotage', code === 0 && reds.length === 0, `exit ${code}, ${reds.length} red`)
  if (code !== 0 || reds.length > 0) process.exit(1)
}

for (const c of CASES) {
  const before = md5(c.file)
  const original = readFileSync(c.file, 'utf8')
  // Line endings normalised before the anchor is matched: this repo checks out
  // CRLF on Windows, so an anchor written with plain newlines matches a file a
  // session just wrote and stops matching the moment git has touched it.
  const lf = original.split(CR).join('')
  const hits = lf.split(c.find).length - 1
  note(`\n== ${c.label} (${c.file})`)
  // A sabotage that changes nothing must abort naming the reason, never pass —
  // and naming the anchor, not only the file. An anchor that has drifted is
  // repaired by finding where the line went; "0 match(es)" sends nobody
  // looking. `first-screen-break-check.mjs`'s second case sat dead from #409
  // to #489 for exactly this reason.
  ok(`  its anchor is in ${c.file} exactly once`, hits === 1, `${hits} match(es); nothing was changed`)
  if (hits !== 1) {
    console.log(`ABORT ${c.label}: anchor ${JSON.stringify(c.find)}`)
    console.log('      find where it went (git log -S) and move the anchor; do not delete the case.')
    process.exit(treeBack(1))
  }
  const mutated = lf.split(c.find).join(c.replace)
  const restore = () => writeFileSync(c.file, original)
  writeFileSync(c.file, original.includes(CR) ? mutated.split('\n').join(`${CR}\n`) : mutated)
  let result
  try {
    result = run()
  } finally {
    restore()
  }
  const after = md5(c.file)
  ok('  the file is restored byte for byte', before === after, `md5 ${before} before, ${after} after`)
  for (const r of result.reds) note(`     - ${r.slice(0, 96)}`)
  // Non-zero with no FAIL line is a crash, and a crash is not a catch. The
  // dropped-domain case was exactly that when this was written.
  ok('  the suite went red rather than merely crashing', result.reds.length > 0, `exit ${result.code}, ${result.reds.length} reddened`)
  if (result.reds.length === 0) continue
  const joined = result.reds.join(' | ').toLowerCase()
  const missing = c.expect.filter((w) => !joined.includes(w.toLowerCase()))
  ok('  and it reddened the checks that name the property', missing.length === 0, missing.length ? `did not name: ${missing.join(', ')}` : `${result.reds.length} red`)
}

console.log('')
{
  const { code, reds } = run()
  ok('every file is back and the suite is green again', code === 0 && reds.length === 0, `exit ${code}, ${reds.length} red`)
}

console.log(`\n${CASES.length} sabotages, ${checked} checked, ${bad} failed`)
if (CASES.length < 4 || checked < 14) {
  console.log(`FAIL ${CASES.length} sabotages and ${checked} checks; this file has never had fewer than 4 and 14`)
  process.exit(1)
}
// git, not this file's own bookkeeping: the md5 per case proves each restore
// reproduced the bytes it read, and only git can see anything left behind.
process.exit(treeBack(bad ? 1 : 0))
