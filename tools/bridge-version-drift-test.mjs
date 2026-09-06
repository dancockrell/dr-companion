#!/usr/bin/env node
/**
 * Fails the build the moment EXPECTED_BRIDGE_VERSION (src/lib/versions.ts)
 * disagrees with BRIDGE_VERSION (lich-scripts/companion_bridge.lic).
 *
 * This constant has drifted twice in one day: once left at 0.10.0 against a
 * real bridge at 0.10.2, fixed, then drifted again to 0.10.2 against a real
 * bridge at 0.10.3 - a `list_vars` commit bumped BRIDGE_VERSION and nobody
 * grepped for the frontend's copy of the number. versions.ts's own doc
 * comment already names the cost: a freshly reinstalled, genuinely current
 * bridge tells the player it's "newer than expected," which is the exact
 * support-channel confusion this whole file exists to prevent, now aimed at
 * this project's own users instead of someone else's.
 *
 * Same shape as tools/intent-drift-test.mjs: read both sources of truth
 * directly, compare, and throw loudly if either extraction itself comes back
 * empty - a check that always passes because it stopped reading anything is
 * worse than no check.
 *
 * Run: node tools/bridge-version-drift-test.mjs
 * Wired into `npm run build`, and so into the full suite: the registered
 * `test:bundle` runs `npm run build`. #406 listed it as running nowhere; it
 * runs, and the chain is `test:bundle -> build -> here`. What it did not do
 * was *count*: a single trailing `OK —` sentence made the whole file one
 * check, and a version string that had silently become '' would still have
 * printed it. It now emits one counted line per proposition.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readAt(relPath) {
  const path = join(ROOT, relPath)
  try {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  } catch (e) {
    throw new Error(`bridge-version-drift-test: could not read ${relPath}: ${e.message}`)
  }
}

function expectedVersion(versionsSrc) {
  const m = versionsSrc.match(/export const EXPECTED_BRIDGE_VERSION = '([^']+)'/)
  if (!m) {
    throw new Error(
      'bridge-version-drift-test: could not find EXPECTED_BRIDGE_VERSION in ' +
        'src/lib/versions.ts - did the declaration move or change shape? This ' +
        'script needs updating to match, not silencing.'
    )
  }
  return m[1]
}

function realVersion(bridgeSrc) {
  const m = bridgeSrc.match(/BRIDGE_VERSION = '([^']+)'/)
  if (!m) {
    throw new Error(
      "bridge-version-drift-test: could not find BRIDGE_VERSION in " +
        'lich-scripts/companion_bridge.lic - did the constant move or change ' +
        'shape? This script needs updating to match, not silencing.'
    )
  }
  return m[1]
}

const versionsSrc = readAt('src/lib/versions.ts')
const bridgeSrc = readAt('lich-scripts/companion_bridge.lic')

const expected = expectedVersion(versionsSrc)
const real = realVersion(bridgeSrc)

console.log(`EXPECTED_BRIDGE_VERSION (src/lib/versions.ts):        ${expected}`)
console.log(`BRIDGE_VERSION (lich-scripts/companion_bridge.lic):   ${real}`)
console.log('')

// Counted, one line per proposition, because this suite is now registered in
// tools/test-suites.json as well as `npm run build`. The runner counts
// `OK`/`FAIL` lines: a single trailing `OK —` sentence made a whole suite
// worth one check, and a version string that silently became '' would still
// have printed it.
let pass = 0
let fail = 0
const ok = (label, condition) => {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (condition) pass++
  else fail++
}

ok('EXPECTED_BRIDGE_VERSION was extracted and is not empty', expected.length > 0)
ok('BRIDGE_VERSION was extracted and is not empty', real.length > 0)
ok('the app expects exactly the bridge version it ships', expected === real)

if (expected !== real) {
  console.log('')
  console.log(
    `Update EXPECTED_BRIDGE_VERSION in src/lib/versions.ts to '${real}' to match ` +
      'the bridge script you just changed. A mismatch here means a freshly ' +
      'reinstalled bridge reports itself "newer than expected" or "stale" to ' +
      'the app that just shipped it - the exact confusion this file exists to ' +
      'prevent, now happening to our own users.'
  )
}

console.log('')
const total = pass + fail
// Below the real count (3) on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 2
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `total`, not `pass`: the denominator has to be the number of checks that
// ran, or it shrinks by one per failure and reports a smaller suite on
// exactly the run where you need to know the size did not change.
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
