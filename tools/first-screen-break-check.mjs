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
    file: 'src/App.tsx',
    find: "      {setupComplete && bridgeMode === 'mock' && <DemoBanner />}",
    replace: '      {false && <span />}',
    expect: [
      'App renders the banner exactly once',
      'and only when the demo is on',
    ],
  },
]

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
    console.log(`ABORT ${c.name}: fragment not found in ${c.file} - the sabotage would have changed nothing`)
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
process.exit(problems === 0 ? 0 : 1)
