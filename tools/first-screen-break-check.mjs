#!/usr/bin/env node
/**
 * Proves `tools/first-screen-test.mjs` can fail.
 *
 * Two sabotages, each aimed at one of the two halves of the fix, each
 * restored by byte copy and verified by hash afterwards - these edit tracked
 * source in a tree other sessions may be working in, so leaving one in place
 * would be worse than having no negative test at all.
 *
 *   1. put the mock default back in `persistence.ts`;
 *   2. hide the demo banner in `App.tsx`.
 *
 * Each case names the checks it expects to go red, and the run fails if a
 * sabotage reddens a different set than the one it declares - a sabotage that
 * breaks more than it aimed at means the checks are entangled and the suite
 * is saying less than it looks like it is saying.
 *
 * A sabotage that changes no bytes is a hard abort, never a pass: this tree
 * checks out CRLF, so a fragment assembled with '\n' matches nothing, the
 * file is rewritten identical, the suite stays green, and the output reads
 * exactly like proof.
 *
 * Run: node tools/first-screen-break-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { watchTree } from './break-check-tree.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const md5 = (buf) => createHash('md5').update(buf).digest('hex')

const CASES = [
  {
    name: 'the mock default comes back',
    file: 'src/lib/persistence.ts',
    find: "  bridgeMode: 'live',",
    replace: "  bridgeMode: 'mock',",
    expect: [
      'nothing stored: the persisted preference is live',
      'nothing stored and no flag: the selected bridge is the real one',
      // Deliberately not 'a stored live preference survives too': a profile
      // that has 'live' written into it still reads back 'live' when the
      // default is wrong, because `loadPrefs` merges the stored value over
      // the defaults. That check is about a returning user, not about the
      // first run, and it staying green here is the correct behaviour. The
      // first version of this list asserted it and this harness caught it.
      'the persisted default is live',
    ],
  },
  {
    name: 'the demo banner is hidden',
    // The mount moved out of `App.tsx` in 46c8d241 (#409): every window now
    // gets the band through the shell rather than only the main one, which is
    // what #400 was about. The fragment here followed it. Between #409 and
    // this commit the old `App.tsx` literal matched nothing, and the abort
    // below did not save anybody, because no npm script and no
    // `test-suites.json` entry ever ran this file. An abort nothing executes
    // is the same silence as no check at all.
    file: 'src/components/layout/WindowShell.tsx',
    // Moved again in the #523/#525 lane: the guard is now `source === 'demo'`,
    // which folds the game socket into the question so the banner cannot be
    // shown over live text. The mount and the file are unchanged.
    find: "      {setupComplete && source === 'demo' && <DemoBanner compact={aux} />}",
    replace: '      {false && <span />}',
    // Five, and all five are the same fact seen from different checks: with
    // the mount gone, nothing in `src/` renders the band, so it is not above
    // the view switch, the shell does not carry it, and there is no compact
    // variant to find. Measured rather than predicted — the first version of
    // this list named two and the harness reported the other three as
    // UNEXPECTED, which is the entanglement guard doing its job.
    expect: [
      'exactly one component in src/ mounts it',
      'and only when the demo is on',
      'the banner is mounted above the view switch',
      'the shell it goes through is the default export',
      'the pop-out windows get a compact variant of the same band',
    ],
  },
]

// The "before" reading, taken before anything is damaged: this asserts that
// the run changed nothing, not that the checkout was tidy. See
// tools/break-check-tree.mjs.
const treeBack = watchTree([...new Set(CASES.map((c) => c.file))])

function runSuite() {
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--experimental-test-module-mocks',
      join(root, 'tools/first-screen-test.mjs'),
    ],
    { encoding: 'utf8' }
  )
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const reds = [...out.matchAll(/^FAIL\s+(.+?)\s{2,}/gm)].map((m) => m[1].trim())
  return { code: r.status, reds, out }
}

let problems = 0

// The gate that goes before any sabotage: an unmodified tree must be green,
// or every red below could be something else entirely.
{
  const base = runSuite()
  if (base.code !== 0) {
    console.log('ABORT the suite is already red before any sabotage:')
    console.log(base.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'))
    process.exit(1)
  }
  console.log('OK   baseline green before sabotage')
}

for (const c of CASES) {
  const path = join(root, c.file)
  const original = readFileSync(path)
  const before = md5(original)
  const text = original.toString('utf8')

  if (!text.includes(c.find)) {
    // Naming the anchor, not merely the file: an anchor that has drifted is
    // repaired by finding where the line went, and "not found in App.tsx" sent
    // nobody looking for it. This one sat dead from #409 until #489.
    console.log(`ABORT ${c.name}: the anchor is not in ${c.file}, so the sabotage would have changed nothing.`)
    console.log(`      anchor: ${JSON.stringify(c.find)}`)
    console.log(`      find where it went (git log -S) and move the anchor; do not delete the case.`)
    process.exit(1)
  }
  writeFileSync(path, text.replace(c.find, c.replace))
  if (md5(readFileSync(path)) === before) {
    console.log(`ABORT ${c.name}: the file is byte-identical after the edit`)
    writeFileSync(path, original)
    process.exit(1)
  }

  const r = runSuite()
  writeFileSync(path, original)
  const after = md5(readFileSync(path))
  if (after !== before) {
    console.log(`ABORT ${c.name}: restore failed, ${c.file} is ${after}, was ${before}`)
    process.exit(1)
  }

  const missing = c.expect.filter((e) => !r.reds.includes(e))
  const extra = r.reds.filter((e) => !c.expect.includes(e))
  const good = r.code !== 0 && missing.length === 0 && extra.length === 0
  if (!good) problems += 1
  console.log(
    `${good ? 'OK  ' : 'FAIL'} ${c.name.padEnd(30)} exit=${r.code} red=${r.reds.length}` +
      (missing.length ? `  MISSING: ${missing.join(' | ')}` : '') +
      (extra.length ? `  UNEXPECTED: ${extra.join(' | ')}` : '')
  )
  console.log(`     ${c.file} restored, md5 ${after}`)
}

console.log(problems === 0 ? '\nboth sabotages were caught, both files restored' : `\n${problems} case(s) wrong`)
process.exit(treeBack(problems === 0 ? 0 : 1))
