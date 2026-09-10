#!/usr/bin/env node
/**
 * Break the play-first frame on purpose, and check the suite says so.
 *
 * `tools/play-first-layout-test.mjs` came back green the first time it was
 * run, which is exactly the moment a check is worth nothing until somebody has
 * made it fail. Each case below damages one property, runs the suite, and
 * asserts that **the named checks go red and no others do**. Asserting which
 * ones matters as much as asserting that something did: a sabotage that
 * reddens more than it should means the checks are entangled and the suite is
 * saying less than it appears to (CLAUDE.md section 19).
 *
 * Three rules this file follows, all of them earned:
 *
 *   - **A sabotage that changes nothing is a hard abort, not a pass.** If the
 *     edit does not match - a rename, a collapsed escape, a line that moved -
 *     the file is rewritten unchanged, the suite passes, and the output reads
 *     "this check is not needed" when it means "the test did nothing".
 *   - **The restore is verified by hash, not by intention.** These edits are
 *     to real source files in a real worktree; leaving one damaged is the only
 *     outcome worse than having no negative test.
 *   - **The suite must be green before any of it counts.** A run that fails
 *     for an unrelated reason satisfies "exit non-zero" exactly as well as a
 *     caught sabotage does.
 *
 * Usage: node tools/play-first-layout-break-check.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const md5 = (s) => createHash('md5').update(s).digest('hex')
const path = (rel) => join(root, rel)

function runSuite() {
  const r = spawnSync(process.execPath, [path('tools/play-first-layout-test.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    // Long enough for a cold vite start plus five window sizes, and bounded so
    // a hang is a failure rather than a session.
    timeout: 300000,
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return {
    // `status` read directly, never through a pipe: a null status means the
    // process was killed or never started, and that is a failure, not a zero.
    status: r.status,
    out,
    reds: [...out.matchAll(/^FAIL (.+?)\s{2,}/gm)].map((m) => m[1].trim()),
  }
}

/**
 * Each case: what it damages, and which check names must go red for it.
 *
 * `expect` is a list of substrings; every red line must match one of them and
 * every one of them must match at least one red line. Both directions,
 * because a vocabulary checked one way is half checked.
 */
const CASES = [
  {
    name: 'the rail eats the window, so the text falls under its floor',
    file: 'src/lib/scenePane.ts',
    from: 'export const DOCKED_RAIL_W = 480',
    to: 'export const DOCKED_RAIL_W = 1400',
    expect: ['the game text holds most of the width'],
  },
  {
    name: 'the pane moves out of the right corner into the middle',
    file: 'src/App.tsx',
    from: '            <div className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="Text">',
    to: '            <div className="flex min-w-0 flex-1 flex-col overflow-hidden order-last" aria-label="Text">',
    expect: ['the scene pane is in the right corner, not the middle'],
  },
  {
    name: 'a panel drops off the bar without being named as deliberately off it',
    file: 'src/lib/panelBar.ts',
    // No trailing newline in the needle. The worktree is checked out CRLF, so
    // a needle ending in a bare line feed matches nothing, the case aborts as
    // "did not match" - which is the abort doing its job, and still a case
    // that never ran.
    from: "  'inventory',",
    to: '',
    expect: [
      'every panel is either on the bar or named as deliberately off it',
      'and every panel not deliberately off the bar is on it',
    ],
  },
  {
    name: 'the pane state stops being remembered per size of window',
    file: 'src/lib/scenePane.ts',
    from: "  return `${w}-${h}`",
    to: "  return `one-size-for-everything ${w === h ? '' : ''}`",
    expect: ['and a different size keeps its own answer rather than inheriting that one'],
  },
  {
    name: 'the icons stop saying what they are for',
    file: 'src/components/layout/IconBar.tsx',
    from: '        title={`${title}. ${detail}`}',
    to: '        title={title}',
    expect: ['and what it is for, on hover and on focus'],
  },
]

let fails = 0
const say = (label, ok, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(70)} ${detail}`)
}

// The gate that goes first, and the one whose absence made an earlier version
// of a check like this certify a suite that no longer ran at all.
console.log('== control: the suite is green before anything is broken ==')
const control = runSuite()
say('unmodified: the suite passes', control.status === 0, `exit ${control.status}, ${control.reds.length} red`)
if (control.status !== 0) {
  console.log(control.out.slice(-3000))
  console.log('\nNothing below can be interpreted while the suite is red for its own reasons.')
  process.exit(1)
}

for (const c of CASES) {
  console.log(`\n== ${c.name} ==`)
  const original = readFileSync(path(c.file), 'utf8')
  const before = md5(original)
  const count = original.split(c.from).length - 1
  if (count !== 1) {
    console.log(`FAIL the sabotage did not match ${c.file} (${count} occurrences) - aborting rather than reporting a pass`)
    process.exit(1)
  }
  const damaged = original.replace(c.from, c.to)
  if (md5(damaged) === before) {
    console.log('FAIL the sabotage changed nothing - aborting rather than reporting a pass')
    process.exit(1)
  }
  writeFileSync(path(c.file), damaged)
  try {
    const r = runSuite()
    say('the suite goes red', r.status !== 0 && r.reds.length > 0, `exit ${r.status}, ${r.reds.length} red`)
    const unexpected = r.reds.filter((red) => !c.expect.some((want) => red.includes(want)))
    const missing = c.expect.filter((want) => !r.reds.some((red) => red.includes(want)))
    say('and names the check it should', missing.length === 0, missing.join(' | ') || c.expect.join(' | '))
    say('and nothing it should not', unexpected.length === 0, unexpected.slice(0, 4).join(' | ') || 'none')
    // The red lines carry the size or the state they are about, which is what
    // makes the failure actionable rather than merely present.
    const named = r.reds.filter((red) => /\d+x\d+/.test(red) || /size|state|corner|bar/.test(red))
    say('and says which size or which state', named.length > 0, named[0] ?? 'no red line named one')
  } finally {
    writeFileSync(path(c.file), original)
    const after = md5(readFileSync(path(c.file), 'utf8'))
    say('restored, by hash', after === before, `${before.slice(0, 8)} -> ${after.slice(0, 8)}`)
    if (after !== before) {
      console.log(`FAIL ${c.file} was NOT restored. Fix it before doing anything else.`)
      process.exit(1)
    }
  }
}

console.log(`\n${CASES.length} sabotages, ${fails} failed`)
process.exit(fails ? 1 : 0)
