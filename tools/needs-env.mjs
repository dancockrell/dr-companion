#!/usr/bin/env node
// What `node tools/run-tests.mjs` does not run, and why.
//
// Two different absences look identical from the outside, and both look like
// nothing at all:
//
//   1. a suite deliberately left out because it needs something the build box
//      does not have (a submodule, a Godot binary, the running app);
//   2. a suite nobody registered, which therefore has never run since the day
//      it was written.
//
// The second is the expensive one and it is invisible: the run ends "all
// passed" whether the suite is absent or merely never invoked. So this walks
// package.json for every `test:` script the full suite cannot reach — directly
// through tools/test-suites.json or indirectly through an `npm run` inside a
// registered script — and requires every one of them to be accounted for here.
// An unlisted orphan fails; so does a listed one that has since been wired in.
// The list cannot quietly go stale in either direction.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Suites deliberately outside the build, with the thing they need.
const NEEDS_ENVIRONMENT = [
  {
    script: 'test:godot-export',
    requires: 'the godot/shared-assets submodule and a Godot 4 binary on PATH',
  },
  {
    script: 'test:live-chain',
    requires: 'the app running with the viewer attached',
    // Not written yet; it arrives with increment B4. Recorded now so the
    // requirement is written down before the suite exists rather than after.
    pending: 'B4',
  },
  {
    script: 'test:protocol-harness',
    requires:
      'Ruby, and a second shell: the harness serves the real protocol on 7419 and tools/ws-client.mjs connects to it',
  },
]

// Suites that need nothing special and are simply not wired in. This is a
// backlog, not a design: each one is a test that has not run since it was
// written. Removing a name from here without registering the suite is how the
// list would start lying, so the check below refuses that too.
const UNWIRED = [
  'test:map-state-sync',
  'test:splitter-range',
  'test:geometric-briefs',
  'test:primitive-world',
  'test:node-projection',
  'test:geometric-kit',
  'test:primitive-registry',
  'test:room-scene-patterns',
  'test:portrait-art',
  'test:editor-safety',
  'test:command-history',
  'test:dead-produced-values',
  'test:panel-window-lifecycle',
  'test:task-catalog-status',
  'test:game-connection-owner',
  'test:map-landmarks',
  'test:map-viewport',
  'test:map-keyboard',
  'test:sound-actions',
  'test:game-time',
  'test:scrollable-region',
]

// Not suites: the runner itself, and this list.
const NOT_A_SUITE = new Set(['test:all', 'test:needs-env'])

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const scripts = pkg.scripts
const registered = JSON.parse(readFileSync(join(root, 'tools/test-suites.json'), 'utf8'))

// A registered script may compose others with `npm run x && npm run y`; those
// run too, so they are not orphans.
const reachable = new Set()
const walk = (name) => {
  if (reachable.has(name) || !(name in scripts)) return
  reachable.add(name)
  for (const m of scripts[name].matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) walk(m[1])
}
registered.forEach(walk)

const orphans = Object.keys(scripts).filter(
  (k) => k.startsWith('test:') && !reachable.has(k) && !NOT_A_SUITE.has(k),
)

let failed = 0
const fail = (line) => {
  failed += 1
  console.log(`FAIL ${line}`)
}

console.log(`needs an environment the build box does not have (${NEEDS_ENVIRONMENT.length}):`)
for (const { script, requires, pending } of NEEDS_ENVIRONMENT) {
  const present = script in scripts
  if (!present && !pending) fail(`${script} — no such npm script`)
  else if (present && pending)
    fail(`${script} — listed as arriving with ${pending}, but it exists now: drop the pending marker`)
  else if (reachable.has(script))
    fail(`${script} — the full suite now runs it, so it is not outside the build`)
  else if (pending) console.log(`OK   ${script} — arrives with ${pending}; will need ${requires}`)
  else console.log(`OK   ${script} — needs ${requires}`)
}

console.log(`\nwritten but never run by the full suite (${UNWIRED.length}) — a backlog, not a design:`)
for (const script of UNWIRED) {
  if (!(script in scripts)) fail(`${script} — no such npm script; drop it from UNWIRED`)
  else if (reachable.has(script))
    fail(`${script} — now registered; drop it from UNWIRED in ${'tools/needs-env.mjs'}`)
  else console.log(`OK   ${script} — needs nothing; register it in tools/test-suites.json`)
}

// Anything orphaned and unaccounted for is the case this file exists to catch.
const accounted = new Set([...NEEDS_ENVIRONMENT.map((e) => e.script), ...UNWIRED])
for (const script of orphans) {
  if (!accounted.has(script)) {
    fail(`${script} — the full suite never runs it and nothing here says why`)
  }
}

// Without this line an empty package.json would print the same OK lines.
console.log(
  `\nchecked ${NEEDS_ENVIRONMENT.length + UNWIRED.length} listed entries and ${orphans.length} unreached test scripts against ${Object.keys(scripts).length} npm scripts and ${registered.length} registered suites`,
)
if (failed) {
  console.error(`${failed} entr${failed === 1 ? 'y has' : 'ies have'} drifted`)
  process.exit(1)
}
