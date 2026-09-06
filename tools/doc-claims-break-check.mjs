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
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { watchTree } from './break-check-tree.mjs'

/**
 * The gate's own stage count, read from `tools/gate.mjs` rather than typed.
 *
 * `doc-claims-test.mjs` names those two checks `<doc> quotes the real stage
 * count (<n>)`, where `<n>` is `EXPECTED_STAGES`. Writing that number into the
 * `expect` fields below made them go stale the first time a stage was added
 * (#488, which took the gate from ten stages to eleven): the sabotage still
 * reddened the right check, and this file said it had not, because the name it
 * was looking for no longer existed. A break-check that cries wolf on a correct
 * tree is worth nothing, so the number comes from the same place the test's
 * does.
 */
const STAGE_COUNT = readFileSync('tools/gate.mjs', 'utf8').match(/^const EXPECTED_STAGES = (\d+)$/m)?.[1]
if (!STAGE_COUNT) {
  console.error('ABORT: EXPECTED_STAGES did not parse out of tools/gate.mjs; the two stage-count cases')
  console.error('       below would look for a check name that cannot exist, and report a false failure.')
  process.exit(2)
}
// The other half of the same rot, found by #486 adding a twelfth stage: the
// `expect` names came from the gate and the `from` fragments did not, so both
// cases aborted on a correct tree - the documents had been updated and this
// file had not. Both halves derive now. The sabotage value only has to differ.
const WRONG_STAGE_COUNT = STAGE_COUNT === '7' ? '6' : '7'

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

  // N6. Section L: no shipped string or document instructs the route the app
  // no longer takes. Three cases, because the check has parts that can fail
  // independently - the scan over the real tree (a document and a component),
  // and the fixture control that proves the scan can catch anything at all.
  {
    // A document. The sentence N6 deleted from TESTING.md, put back rather
    // than an invented one, so the case demonstrates the regression that would
    // actually happen: somebody restoring "helpful" advice for a dead route.
    file: 'docs/TESTING.md',
    from: '3. In game: `;companion_bridge`. The app starts Lich headless',
    to: '3. In game: `;companion_bridge` — or `,companion_bridge` if you use Genie. The app starts Lich headless',
    expect: 'no shipped string or document instructs the retired route',
  },
  {
    // A component string, which is the half a player actually reads. Aimed at
    // LichLauncher because it renders whenever Lich is up, so a wrong command
    // there is seen by everybody rather than by a documentation reader.
    file: 'src/components/shared/LichLauncher.tsx',
    from: '<code className="text-ink">{bridgeCommand(null)}</code> in the game.',
    to: '<code className="text-ink">,companion_bridge</code> in the game.',
    expect: 'no shipped string or document instructs the retired route',
  },
  {
    // Sabotage the checker, not only the thing checked. Cutting one needle out
    // of the fixture must take down both control checks and nothing else: the
    // count falls to 4 of 5 and so does the set of distinct line numbers. If
    // this case ever goes green, the control has stopped controlling and every
    // green above it is worth less than it looks.
    file: 'tools/fixtures/retired-instructions.md',
    // No trailing newline in the fragment. This repository checks out CRLF on
    // Windows, so a `\n` here matches nothing, and after a rebase this case
    // aborted rather than passing - the abort earning its keep, since a
    // sabotage that edits nothing looks exactly like one the guard caught.
    // Removing the text alone leaves the line blank, which is enough: the
    // fixture then carries four needles and both control checks fall with it.
    from: '    ,companion_bridge',
    to: '',
    expect: [
      'control: the scan catches a fixture that does instruct it',
      'control: and reports distinct line numbers',
    ],
  },
  {
    // A module reaching for the Genie writer is how the deleted editor comes
    // back - not as one commit called "restore the editor", but as one save
    // somewhere that looked harmless. `mapPins.ts` because it is the nearest
    // neighbour of what used to be the one legitimate caller, and so the
    // likeliest place for it to happen by accident.
    //
    // Turned the other way up by Q5, which deleted the Genie write path: the
    // check this reddens used to be "exactly one caller" and is now "none".
    // The sabotage is unchanged, which is the point of keeping it - the same
    // plant that proved a *second* caller was caught now proves a *first* one
    // is.
    file: 'src/lib/mapPins.ts',
    from: 'export',
    to: '// saveGenieConfig\nexport',
    expect: 'nothing in this app writes into a Genie install',
  },
  {
    // The other half of the same property, and the one a one-caller check
    // could never have asserted: the wrapper module itself coming back. A file
    // is created rather than edited, so the restore is a delete - see the
    // runner's `create` handling.
    create: 'src/lib/genieConfigWrite.ts',
    content: 'export async function saveGenieConfig() {}\n',
    expect: [
      'nothing in this app writes into a Genie install',
      'the module that wrapped the Genie writer is gone',
    ],
  },
  {
    // A second invocation site for the *read* command. Q5 left one, in the
    // config importer, and this is how a Genie route grows back a leaf at a
    // time. `mapPins.ts` again, for the same reason as above.
    file: 'src/lib/mapPins.ts',
    from: 'export',
    to: "// invokeTauri('read_genie_config', { leaf: 'highlights.cfg' })\nexport",
    expect: 'exactly one module invokes read_genie_config, and it is the config importer',
  },
  {
    // Sabotage the checker again, this time its one exemption. Pointing the
    // entry at a file that does not exist must do two things at once: the two
    // hits it was covering come back and redden the real check, and the
    // staleness check notices the entry matches nothing. If only the first went
    // red, a stale exemption could sit there indefinitely widening the hole; if
    // only the second did, the exemption was never load-bearing at all.
    file: 'tools/doc-claims-test.mjs',
    from: "      'src/lib/frontends.ts',",
    to: "      'src/lib/frontends-that-do-not-exist.ts',",
    expect: [
      'no shipped string or document instructs the retired route',
      'every retired-instruction exemption still earns itself',
    ],
  },
  {
    // The merge ritual's stage count, which is the half of #489's fourth
    // finding that rots. A merger told to look for a number the gate no longer
    // prints learns to skip the line, which is worse than no instruction.
    file: 'docs/MERGING.md',
    from: `gate ok: ${STAGE_COUNT} of ${STAGE_COUNT} stages ran`,
    to: `gate ok: ${WRONG_STAGE_COUNT} of ${WRONG_STAGE_COUNT} stages ran`,
    expect: `docs/MERGING.md quotes the real stage count (${STAGE_COUNT})`,
  },
  {
    // The same, from the other document. Both are asserted separately on
    // purpose: one check covering "some document quotes it" would stay green
    // with either of them wrong.
    file: '.github/PULL_REQUEST_TEMPLATE.md',
    from: `\`gate ok: ${STAGE_COUNT} of ${STAGE_COUNT} stages ran\``,
    to: `\`gate ok: ${WRONG_STAGE_COUNT} of ${WRONG_STAGE_COUNT} stages ran\``,
    expect: `.github/PULL_REQUEST_TEMPLATE.md quotes the real stage count (${STAGE_COUNT})`,
  },
  {
    // The link, not the content. `docs/MERGING.md` is the only copy of the
    // ritual, so a `CONTRIBUTING.md` that stops naming it makes the ritual
    // unreachable from the file GitHub puts in front of a contributor - and
    // nothing about the page itself would look wrong.
    file: 'CONTRIBUTING.md',
    from: '[docs/MERGING.md](docs/MERGING.md)',
    to: '[the merge ritual](docs/MERGING-not-a-real-page.md)',
    expect: 'CONTRIBUTING.md points at the merge ritual',
  },
]

// The "before" reading, taken before anything is damaged: this asserts that
// the run changed nothing, not that the checkout was tidy. See
// tools/break-check-tree.mjs.
const treeBack = watchTree([...new Set(CASES.map((c) => c.file ?? c.create))])

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
  let out
  if (c.create) {
    // A case whose sabotage is a file that should not exist. Its "restore" is
    // a delete, and the abort discipline is the mirror image of the edit case:
    // a file already there would make the creation a no-op AND destroy real
    // work, so refuse rather than guess.
    if (existsSync(c.create)) {
      console.error(`ABORT ${c.create}: already exists, so this case would overwrite real work and prove nothing.`)
      process.exit(2)
    }
    writeFileSync(c.create, c.content)
    out = run()
    rmSync(c.create)
    if (existsSync(c.create)) {
      console.error(`ABORT ${c.create}: the sabotage file is still there. Delete it before doing anything else.`)
      process.exit(2)
    }
  } else {
    const orig = readFileSync(c.file, 'utf8')
    const before = md5(orig)
    if (!orig.includes(c.from)) {
      console.error(`ABORT ${c.file}: the fragment to break is not there, so this case would edit nothing and pass. ${JSON.stringify(c.from)}`)
      process.exit(2)
    }
    writeFileSync(c.file, orig.replace(c.from, c.to))
    out = run()
    writeFileSync(c.file, orig)
    if (md5(readFileSync(c.file, 'utf8')) !== before) {
      console.error(`ABORT ${c.file}: the restore did not reproduce the original bytes. Recover it from git before doing anything else.`)
      process.exit(2)
    }
  }

  const want = Array.isArray(c.expect) ? c.expect : [c.expect]
  const red = redLines(out)
  const hit = want.every((w) => red.includes(w))
  const extra = red.filter((r) => !want.includes(r))
  if (!hit || extra.length) bad++
  console.log(`${hit && !extra.length ? 'OK  ' : 'FAIL'} ${want.join(' + ')}\n       red: ${JSON.stringify(red)}`)
}

console.log(`\n${CASES.length} sabotages across ${new Set(CASES.map((c) => c.file ?? c.create)).size} files; ${bad} did not redden exactly the checks they named`)
// Every path this run wrote to, asked of git rather than of this file's own
// bookkeeping: the md5 comparisons above prove each restore reproduced the
// bytes it read, and only git knows whether anything else was left behind.
// See tools/break-check-tree.mjs.
process.exit(treeBack(bad ? 1 : 0))
