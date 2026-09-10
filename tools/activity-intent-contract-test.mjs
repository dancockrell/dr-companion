#!/usr/bin/env node
/**
 * R0 (docs/PLAN_TO_1_0.md §6b, Lane R). Reads docs/BRIDGE_CONTRACT.md's
 * "Status of the nine, and where each is tracked" table and asserts it
 * still describes exactly the nine activity intents this repo has never
 * had a written shape for — one row each, every row naming a real intent
 * (checked against IntentName in src/bridge/types.ts, not just against our
 * own hardcoded list), and every row claiming "deferred" naming its
 * blocker. Cross-checked against companion_bridge.lic's real HANDLERS so a
 * row that still says "not yet implemented" after its handler has actually
 * landed is caught too.
 *
 * Why three states and not two. R0 ships before any of R1-R7 land a
 * handler, so at the moment this test is first added, none of the nine is
 * in HANDLERS yet — a check that only accepted "in HANDLERS" or "deferred"
 * would be red the day it was written, which is not what
 * "the check must name the intent that lost its row" (the sabotage this is
 * built against) is asking for. The three real states a row can be in:
 *   - "not yet implemented"  - normal, pre-R1-R7, or an increment that just
 *                              hasn't landed yet. Not a failure on its own.
 *   - "implemented"          - must actually be in HANDLERS, or this is
 *                              exactly the run_macro-mock lie intent-drift-
 *                              test.mjs was written to catch, one document
 *                              over.
 *   - "deferred"             - must name a blocker (a literal "blocked-on:"
 *                              in the same cell). burgle is the one row
 *                              that starts here and is expected to stay
 *                              here until R8.
 * A row already in HANDLERS but still marked "not yet implemented" is not
 * failed — that is a stale-but-safe state (the doc understates reality,
 * never overstates it) and gets a warning, not a red exit. The dangerous
 * direction, claiming "implemented" for something HANDLERS does not have,
 * is the one this refuses to pass.
 *
 * Prints "N of N" — rows parsed vs. matched — so a parser that silently
 * matched nothing reports itself rather than certifying agreement (this
 * repo's own "a check that cannot fail is not a check" rule).
 *
 * Sabotage: delete one of the nine rows from the contract table -> this
 * names the missing intent and exits 1. Add a tenth row naming an intent
 * IntentName does not declare -> this names the bogus intent and exits 1.
 * Both are exercised by tools/activity-intent-contract-break-check.mjs
 * (run manually; not wired into the gate, matching how intent-drift-test's
 * own sabotage is exercised by hand per its header).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readNormalized, declaredIntents, implementedIntents } from './bridge-intent-parsing.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readAt(relPath) {
  const path = join(ROOT, relPath)
  try {
    return readNormalized(path)
  } catch (e) {
    throw new Error(`activity-intent-contract-test: could not read ${relPath}: ${e.message}`)
  }
}

/** The nine activity intents R0 was written to give a shape to. Fixed on
 * purpose: this is the population the contract is required to cover, not
 * whatever happens to be in the table today (see NEXT-50.md:434,
 * PLAN_TO_1_0.md's Lane R heading). */
export const ACTIVITY_INTENTS = [
  'start_combat', 'burgle', 'travel', 'escape_heal', 'go_healer',
  'town_run', 'start_training', 'loot', 'buffs',
]

/**
 * Parse the "Status of the nine" table in BRIDGE_CONTRACT.md into
 * { intent -> { increment, status, raw } }. Scoped to that one table by its
 * heading and the next `---`/`##`, so a `| \`foo\` |` row anywhere else in
 * this large document (there are other tables) is never picked up by
 * accident.
 */
function parseStatusTable(contractSrc) {
  const headingIdx = contractSrc.indexOf('### Status of the nine')
  if (headingIdx === -1) {
    throw new Error(
      'activity-intent-contract-test: could not find the "Status of the nine" ' +
      'heading in docs/BRIDGE_CONTRACT.md — did it get renamed? This script ' +
      'needs updating to match, not silencing.'
    )
  }
  const afterHeading = contractSrc.slice(headingIdx)
  const endMatch = afterHeading.slice(20).match(/\n---\n|\n## /)
  const region = endMatch ? afterHeading.slice(0, 20 + endMatch.index) : afterHeading

  const rows = new Map()
  const rowPattern = /^\|\s*`([a-z_]+)`\s*\|\s*([^|]*?)\s*\|\s*(.*?)\s*\|\s*$/gm
  for (const m of region.matchAll(rowPattern)) {
    const [, intent, increment, status] = m
    if (rows.has(intent)) {
      throw new Error(`activity-intent-contract-test: '${intent}' has more than one row in the Status table — one entry per intent, or the table is describing two different facts about it.`)
    }
    rows.set(intent, { increment, status })
  }
  if (rows.size === 0) {
    throw new Error('activity-intent-contract-test: found the Status table heading but extracted zero rows — the row regex is broken, not the file.')
  }
  return rows
}

const contractSrc = readAt('docs/BRIDGE_CONTRACT.md')
const typesSrc = readAt('src/bridge/types.ts')
const bridgeSrc = readAt('lich-scripts/companion_bridge.lic')

const declared = declaredIntents(typesSrc)
const implemented = implementedIntents(bridgeSrc)
const rows = parseStatusTable(contractSrc)

const errors = []
const warnings = []
let matched = 0

// Every row must name a real, declared intent — catches a tenth row added
// for a name IntentName does not declare (typo, or an intent invented for
// this table alone).
for (const intent of rows.keys()) {
  if (!declared.has(intent)) {
    errors.push(`'${intent}' has a row in the contract's Status table but is not declared in IntentName (src/bridge/types.ts) — the contract describes an intent that does not exist.`)
  }
}

// Every one of the nine must have exactly one row, and that row's claim
// must not overstate reality.
for (const intent of ACTIVITY_INTENTS) {
  const row = rows.get(intent)
  if (!row) {
    errors.push(`'${intent}' has no row in the contract's Status table — every one of the nine activity intents needs one, even while it is still "not yet implemented".`)
    continue
  }

  const statusLower = row.status.toLowerCase()
  const isDeferred = statusLower.includes('deferred')
  const claimsImplemented = statusLower.includes('implemented') && !statusLower.includes('not yet implemented') && !isDeferred
  const isReallyImplemented = implemented.has(intent)

  if (isDeferred) {
    if (!row.status.toLowerCase().includes('blocked-on')) {
      errors.push(`'${intent}' is marked deferred but names no blocker ("blocked-on:") in its Status cell — a deferred row must say what it is waiting on.`)
      continue
    }
    if (isReallyImplemented) {
      errors.push(`'${intent}' is marked deferred, but companion_bridge.lic's HANDLERS already has a handler for it — the row is stale in the dangerous direction (understating a real capability as absent is safer than the reverse, but this repo's own rule is that a stale doc gets fixed the moment it's found).`)
      continue
    }
    matched += 1
    continue
  }

  if (claimsImplemented && !isReallyImplemented) {
    errors.push(`'${intent}' is marked implemented in the contract, but companion_bridge.lic's HANDLERS has no entry for it — this is the exact shape of the run_macro mock lie intent-drift-test.mjs exists to catch, one document over.`)
    continue
  }

  if (!claimsImplemented && isReallyImplemented) {
    warnings.push(`'${intent}' says "${row.status}" but HANDLERS already implements it — update the Status table in the same commit that added the handler.`)
  }

  matched += 1
}

console.log(`Declared intents (types.ts):          ${declared.size}`)
console.log(`Implemented in bridge (HANDLERS):      ${implemented.size}`)
console.log(`Activity intents expected:             ${ACTIVITY_INTENTS.length}`)
console.log(`Contract rows parsed:                  ${rows.size}`)
console.log(`${matched} of ${ACTIVITY_INTENTS.length}`)

if (warnings.length > 0) {
  console.warn('\nWarnings (not failing the build):')
  for (const w of warnings) console.warn(`  - ${w}`)
}

if (errors.length > 0) {
  console.error('\nactivity-intent-contract-test: FAILED\n')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log('\nOK — every activity intent has a contract row, and no row overstates reality.')
process.exit(0)
