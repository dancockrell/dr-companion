/**
 * The negative suite for tools/doc-claims-test.mjs.
 *
 *   node tools/doc-claims-break-check.mjs
 *
 * A guard that cannot fail is worth nothing, and reading it does not establish
 * that it can. This breaks one documented claim at a time, in the real files,
 * runs the guard, and asserts that exactly the named check goes red - then puts
 * the file back and confirms the restore byte for byte.
 *
 * Deliberately not an npm script and not in tools/test-suites.json: it writes
 * to tracked files, so it must never run inside the ordinary suite, least of
 * all on a machine where another session may be editing the same tree. Run it
 * by hand after changing the guard, or after changing a document the guard
 * checks.
 *
 * Three rules it enforces on itself, each of which has burned somebody:
 *
 *   - a fragment that is not found is an abort, not a pass. A sabotage that
 *     edits nothing rewrites the file unchanged, the guard stays green, and the
 *     output reads exactly like proof.
 *   - the run must be green before any sabotage. Otherwise a red line from
 *     something else is indistinguishable from a sabotage landing.
 *   - a case names every check it expects to redden, and reddening a check it
 *     did not name is a failure too. A sabotage that takes down more than its
 *     target means the checks are entangled and are saying less than they look.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const CASES = [
  {
    file: 'docs/TESTING.md',
    from: 'Implemented in bridge (real):       26',
    to: 'Implemented in bridge (real):       2',
    expect: 'TESTING quotes the real implemented-intent count',
  },
  {
    file: 'docs/TESTING.md',
    from: '`start_training`, `town_run` and `travel`',
    to: '`start_training` and `town_run`',
    expect: 'TESTING names as many unimplemented intents as there are',
  },
  {
    file: 'docs/TESTING.md',
    from: 'Almost nothing in this app has been exercised against DragonRealms.',
    to: 'Nothing in this app has ever talked to DragonRealms.',
    expect: 'TESTING no longer claims nothing has ever talked to DragonRealms',
  },
  {
    // The description this replaced was wrong in two ways at once, so it must
    // redden both checks. Naming only one would let the other rot unnoticed.
    file: 'src-tauri/tauri.conf.json',
    from: '"DragonRealms desktop client, built on Lich 5"',
    to: '"Dragon Realms Companion control panel"',
    expect: [
      'the bundle description does not call the app a panel',
      'the bundle description spells DragonRealms as one word',
    ],
  },
  {
    file: 'src-tauri/tauri.conf.json',
    from: '"width": 520',
    to: '"width": 640',
    expect: 'PACKAGING names the configured window size',
  },
  {
    file: 'src-tauri/tauri.conf.json',
    from: '"version": "0.1.1"',
    to: '"version": "0.9.9"',
    expect: 'package.json, Cargo.toml and tauri.conf.json agree',
  },
  {
    // Both directions of the same disagreement, because a one-way check would
    // go quiet the day the implementation actually lands.
    file: 'README.md',
    from:
      'the approved architecture for interruptible local-AI monitoring, alerts, and evidence-backed background work. ' +
      'Its own status line says the implementation is not yet complete, so it is a contract rather than a description of what runs today',
    to: 'interruptible local-AI monitoring, alerts, and evidence-backed background work',
    expect: 'README’s local-AI entry matches that document’s status',
  },
  {
    file: 'docs/LOCAL_AI_BACKGROUND_WORKER.md',
    from: 'implementation is not yet complete',
    to: 'implementation has shipped',
    expect: 'README’s local-AI entry matches that document’s status',
  },
  {
    file: 'README.md',
    from: '(docs/PACKAGING.md)',
    to: '(docs/PACKAGING-GONE.md)',
    expect: 'every documented repo path exists',
  },
  {
    file: 'README.md',
    from: 'npm run vendor:stub',
    to: 'npm run vendor:stubbb',
    expect: 'every documented `npm run` resolves',
  },
  {
    // A count off by one is the whole point: a wildly wrong number gets
    // noticed by eye, and this one would not.
    file: 'docs/AUDIO.md',
    from: 'All 85 zones are built',
    to: 'All 86 zones are built',
    expect: 'every stated zone/room count matches the map data',
  },
  {
    // What dropping MSI would have looked like if a document had kept naming
    // it: a path that exists nowhere and that no clean-tree file check can see.
    file: 'docs/PACKAGING.md',
    from: 'src-tauri/target/release/bundle/nsis/*.exe',
    to: 'src-tauri/target/release/bundle/msi/*.msi',
    expect: 'documented build artefacts name a declared bundle target',
  },
]

const md5 = (s) => createHash('md5').update(s).digest('hex')

const run = () => {
  try {
    return execFileSync(process.execPath, ['tools/doc-claims-test.mjs'], { encoding: 'utf8' })
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

if (redLines(run()).length !== 0) {
  console.error('ABORT: doc-claims-test is already red before any sabotage. Fix that first - nothing below would mean anything.')
  process.exit(2)
}
console.log('baseline: doc-claims-test is green\n')

let bad = 0
for (const c of CASES) {
  const orig = readFileSync(c.file, 'utf8')
  const before = md5(orig)
  if (!orig.includes(c.from)) {
    console.error(`ABORT ${c.file}: the fragment to break is not there, so this case would edit nothing and pass. ${JSON.stringify(c.from)}`)
    process.exit(2)
  }
  writeFileSync(c.file, orig.replace(c.from, c.to))
  const out = run()
  writeFileSync(c.file, orig)
  if (md5(readFileSync(c.file, 'utf8')) !== before) {
    console.error(`ABORT ${c.file}: the restore did not reproduce the original bytes. Recover it from git before doing anything else.`)
    process.exit(2)
  }

  const want = Array.isArray(c.expect) ? c.expect : [c.expect]
  const red = redLines(out)
  const hit = want.every((w) => red.includes(w))
  const extra = red.filter((r) => !want.includes(r))
  if (!hit || extra.length) bad++
  console.log(`${hit && !extra.length ? 'OK  ' : 'FAIL'} ${want.join(' + ')}\n       red: ${JSON.stringify(red)}`)
}

console.log(`\n${CASES.length} sabotages across ${new Set(CASES.map((c) => c.file)).size} files; ${bad} did not redden exactly the checks they named`)
process.exit(bad ? 1 : 0)
