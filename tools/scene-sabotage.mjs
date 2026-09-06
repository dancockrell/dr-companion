#!/usr/bin/env node
/**
 * Breaks one thing at a time and checks that the named check goes red.
 *
 * Committed rather than lane-private, because the claim "these checks can fail"
 * is worth nothing as a sentence in a verification document and everything as a
 * command somebody can re-run. It edits real tracked files, so **everything must
 * be committed before it runs**: the restore is `git checkout --`, which returns
 * a file to HEAD rather than undoing the edit, and against uncommitted work that
 * is a deletion. It refuses to continue if a restore leaves the tree dirty.
 *
 *   node tools/scene-sabotage.mjs           every case
 *   node tools/scene-sabotage.mjs --no-godot   the cases that need no engine
 *
 * `--no-godot` exists because this machine runs several sessions at once and
 * launching an engine is not a private act. It skips the cases whose runner is
 * `godot` and says how many it skipped, rather than reporting a smaller total
 * as though it were the whole suite.
 *
 * Three things this harness had to learn the hard way, all of them the same
 * lesson as the suite it is checking:
 *
 * 1. `git checkout --` restores a TRACKED file to HEAD, which discards
 *    uncommitted work rather than undoing the sabotage. The first run of this
 *    reverted three files' worth of real changes. Everything is committed
 *    before it runs now, and the restore is verified with `git diff --quiet`
 *    rather than by md5 - git normalises line endings on checkout, so a
 *    correct restore can give a different md5 and read as a failure.
 * 2. A sabotage can land and still never reach the check it was aimed at,
 *    because a guard upstream rejects it first. Removing a `register()` call
 *    from the content pack was meant to redden the committed-JSON comparison
 *    and instead tripped the register-vs-advertise drift check three lines
 *    earlier. Both are recorded below, aimed separately.
 * 3. Each case names the check it expects, so a sabotage that reddens
 *    something else is reported as a miss rather than as a pass.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const NODE = process.execPath

function run(args) {
  try {
    return execFileSync(NODE, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

const runners = {
  scene: () => run(['--experimental-strip-types', 'tools/scene-editor-test.mjs']),
  registry: () => run(['--experimental-strip-types', 'tools/build-scene-registry.mjs', '--check']),
  godot: () => run(['tools/godot-tests.mjs']),
}

function git(args) {
  try {
    execFileSync('git', args, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const cases = [
  {
    name: '1. the resolver stops preferring the override',
    file: 'src/lib/sceneOverrides.ts',
    from: 'const override = overrides[roomId] ?? null',
    to: 'const override = null',
    runner: 'scene',
    expect: 'FAIL an override wins over the batch',
  },
  {
    name: '2. the compiler stops carrying placed primitives',
    file: 'src/lib/presentationBridge.ts',
    from: '...scene.primitives.map((placed) => ({',
    to: '...[].map((placed) => ({',
    runner: 'scene',
    expect: 'FAIL a placed primitive reaches the cell',
  },
  {
    name: '3. setSceneField stops refusing what the viewer cannot draw',
    file: 'src/lib/sceneOverrides.ts',
    // First occurrence, which is `setSceneField`'s. Single-line, because the
    // working tree is CRLF and a two-line anchor would silently never match.
    from: 'if (!isDrawable(field, value)) {',
    to: 'if (Boolean(0)) {',
    runner: 'scene',
    expect: 'FAIL an undrawable ground kind is refused',
  },
  {
    name: '4. the compiled registry drifts from the content pack',
    file: 'src/data/sceneRegistry.json',
    from: '"landmarksDrawn": false',
    to: '"landmarksDrawn": true',
    runner: 'registry',
    expect: 'FAIL src/data/sceneRegistry.json is not what',
  },
  {
    name: '5. the content pack registers one kind fewer than it advertises',
    file: 'godot/scripts/shared_asset_content.gd',
    from: 'ContentRegistry.register("bridge-span-5m", _build_bridge)',
    to: '',
    runner: 'registry',
    expect: 'advertised but not registered: bridge-span-5m',
  },
  {
    name: '6. Godot stops placing a primitive at its offset',
    file: 'godot/scripts/content_registry.gd',
    from: '_place(cell, node, primitive)',
    to: '',
    runner: 'godot',
    expect: 'FAIL a placed primitive is drawn where the manifest put it',
  },
  {
    name: '7. the placement clamp stops reading the cell',
    file: 'godot/scripts/content_registry.gd',
    from: 'var size := block_size_metres(cell)',
    to: 'var size := Vector3(1000.0, 1000.0, 1000.0)',
    runner: 'godot',
    expect: "FAIL a placement outside the cell is pulled back to the cell's own edge",
  },
  {
    // Aimed at the property rather than at the arithmetic. `clampToCell`
    // returning its input unchanged is precisely what a picker doing its own
    // arithmetic would amount to, and the check that notices is the one that
    // asks the *store* whether it would accept what the control produced.
    name: '8. the clamp stops bounding what the picker hands the store',
    file: 'src/lib/sceneOverrides.ts',
    from: 'return Math.max(-PLACEMENT_HALF_EXTENT, Math.min(PLACEMENT_HALF_EXTENT, value))',
    to: 'return value',
    runner: 'scene',
    expect: 'FAIL nothing the clamp can produce is refused by the store',
  },
  {
    name: '9. the builder stops reading a person’s corrections back',
    file: 'tools/build-world-content.mjs',
    from: "if (byPlayer) return { kind: byPlayer, rule: 'player' }",
    to: '',
    runner: 'scene',
    expect: 'FAIL a room in the imported set comes out of the builder with the imported answer',
  },
  {
    // Not the same case as 9. This one keeps the read and drops the guard, so
    // the builder honours a ground kind Godot has no factory for and bakes a
    // placeholder box into content every player receives.
    name: '10. the builder stops refusing a correction this build cannot draw',
    file: 'tools/build-world-content.mjs',
    from: 'if (isDrawable(field, override[field])) kept[field] = override[field]',
    to: 'kept[field] = override[field]',
    runner: 'scene',
    expect: 'FAIL a field this build cannot draw is dropped and counted, never baked in',
  },
  {
    // The drift the coverage list exists to be protected from: somebody
    // rebuilds the world and does not commit the CSV beside it. Deleting one
    // row is a smaller edit than any real drift would be, which is the point -
    // the check has to notice one room, not only a wholesale mismatch.
    name: '11. the committed residue drifts from the committed content',
    file: 'tools/world-content-residue.csv',
    from: '105-47,105,Soul of Maelshyve,A Treacherous Silver Liquid,,,A Treacherous Silver Liquid\n',
    to: '',
    runner: 'scene',
    expect: 'FAIL and the coverage list names nothing the residue CSV does not',
  },
]

const skipGodot = process.argv.includes('--no-godot')
const selected = cases.filter((c) => !(skipGodot && c.runner === 'godot'))
const skipped = cases.length - selected.length

let misses = 0
for (const c of selected) {
  const before = readFileSync(c.file, 'utf8')
  if (!before.includes(c.from)) {
    console.log(`ABORT ${c.name}: anchor not found, so this case proves nothing`)
    misses += 1
    continue
  }
  writeFileSync(c.file, before.replace(c.from, c.to))
  const after = readFileSync(c.file, 'utf8')
  if (after === before) {
    console.log(`ABORT ${c.name}: the file did not change`)
    misses += 1
    continue
  }

  const out = runners[c.runner]()
  const line = out.split(/\r?\n/).find((l) => l.includes(c.expect))
  if (line) console.log(`RED   ${c.name}\n      ${line.trim().slice(0, 130)}`)
  else {
    misses += 1
    console.log(`MISS  ${c.name}: the sabotage landed and "${c.expect}" never appeared.`)
    console.log(out.split(/\r?\n/).filter((l) => l.includes('FAIL') || l.includes('Error')).slice(0, 3).join('\n'))
  }

  git(['checkout', '--', c.file])
  const clean = git(['diff', '--quiet', '--', c.file]) && git(['diff', '--cached', '--quiet', '--', c.file])
  console.log(`      restored: ${clean ? 'clean against HEAD' : 'STILL DIRTY - fix before continuing'}`)
  if (!clean) process.exit(1)
}

console.log('\n== control: nothing sabotaged, everything green ==')
console.log(runners.scene().trim().split(/\r?\n/).pop())
console.log(runners.registry().trim().split(/\r?\n/).pop())
if (!skipGodot) console.log(runners.godot().trim().split(/\r?\n/).slice(-2).join(' | '))

// The skip is carried all the way to the summary. A run that verified nine of
// eleven cases must not be able to print a line a reader would take for the
// whole suite - "no misses" and "no misses among the ones I ran" are different
// claims and only one of them is true here.
const verdict =
  misses === 0
    ? `${selected.length} sabotages, ${selected.length} reddened the check they named`
    : `${misses} case(s) did not do their job`
console.log(`\n${verdict}${skipped > 0 ? `, and ${skipped} NOT CHECKED (--no-godot: ${cases.filter((c) => c.runner === 'godot').map((c) => c.name.split('.')[0]).join(', ')})` : ''}`)
process.exit(misses === 0 ? 0 : 1)
