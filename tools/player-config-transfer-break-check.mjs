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

let bad = 0
const note = (s) => console.log(s)

{
  const { code, reds, out } = run()
  if (code !== 0 || reds.length > 0) {
    console.log(out.slice(-2000))
    console.log(`FAIL the suite is not green before any sabotage (exit ${code}, ${reds.length} red)`)
    process.exit(1)
  }
  note(`baseline: ${SUITE} is green`)
}

for (const c of CASES) {
  const before = md5(c.file)
  const original = readFileSync(c.file, 'utf8')
  // Line endings normalised before the anchor is matched: this repo checks out
  // CRLF on Windows, so an anchor written with plain newlines matches a file a
  // session just wrote and stops matching the moment git has touched it.
  const lf = original.split(CR).join('')
  const hits = lf.split(c.find).length - 1
  if (hits !== 1) {
    note(`\n== ${c.label}`)
    note(`   ABORT: the anchor matched ${hits} times in ${c.file}; nothing was changed`)
    bad += 1
    continue
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
  note(`\n== ${c.label} (${c.file})`)
  note(`   md5 ${before} before, ${after} after restore: ${before === after ? 'same' : 'DIFFERENT'}`)
  if (before !== after) bad += 1
  if (result.reds.length === 0) {
    // Non-zero with no FAIL line is a crash, and a crash is not a catch.
    note(`   FAIL nothing reddened (exit ${result.code}); a sabotage that only crashes the suite proves nothing`)
    bad += 1
    continue
  }
  note(`   ${result.reds.length} check(s) reddened:`)
  for (const r of result.reds) note(`     - ${r.slice(0, 96)}`)
  const joined = result.reds.join(' | ').toLowerCase()
  const missing = c.expect.filter((w) => !joined.includes(w.toLowerCase()))
  if (missing.length) {
    note(`   FAIL it did not redden the check(s) naming: ${missing.join(', ')}`)
    bad += 1
  }
}

{
  const { code, reds } = run()
  note(`\nrestored: exit ${code}, ${reds.length} red`)
  if (code !== 0 || reds.length > 0) bad += 1
}

note(`\n${CASES.length} sabotages, ${bad} problem(s)`)
if (CASES.length < 4) {
  note('FAIL fewer than four sabotage cases ran; this file has never had fewer')
  process.exit(1)
}
process.exit(bad ? 1 : 0)
