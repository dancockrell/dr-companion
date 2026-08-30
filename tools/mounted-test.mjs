/**
 * Every component reaches the screen, or is named here with a reason.
 *
 * This exists because of a bug that cost two real features and looked like
 * nothing at all.
 *
 * `CharacterStrip` rendered what the character was holding. `AppHeader` was the
 * only thing that mounted it. Nothing mounted `AppHeader`. So for the whole
 * life of the project the app never showed a player their hands, in a game
 * where the client next to it keeps that permanently on its status bar - and
 * the code's own comment said "in a fight this is the question". It also
 * carried race, guild and circle, with a comment noting those had been missing
 * from the UI and were now fixed. They were not fixed. They were rendered by
 * something no one could see.
 *
 * **An unmounted component is not unused code. It is a feature that silently
 * does not ship.** Nothing errors, the file looks maintained, the tests pass,
 * and the comments describe behaviour no user has ever had. It is the same
 * shape as every other failure this project keeps finding: absence and success
 * are indistinguishable unless something makes them different.
 *
 * So: a component nothing imports fails this check. If it is deliberate, say so
 * in ALLOWED with the reason, which turns a silent hole into a decision
 * somebody wrote down.
 *
 * ## Reachability, not name-matching (28 Aug 2026 rewrite)
 *
 * The first version of this file asked "does any other file's text mention
 * my basename", one hop, with no regard for whether that other file was
 * itself reachable. That let two dead files hide behind each other:
 * `RoomCards.tsx` was "referenced" by `RoomPanel.tsx`'s import line and
 * passed, while `RoomPanel.tsx` itself was only in ALLOWED because it is
 * dead. A file whose sole reader is dead is dead too, and the one-hop check
 * could not see that - found by hand, then reproduced here as the sabotage
 * this file's own test suite carries below, so it cannot come back silently.
 *
 * This version builds the real static-import graph and walks it from
 * `main.tsx`, the app's one true root. Reachable means "on a path from the
 * entry point", not "named somewhere in the tree". ALLOWED files are
 * exempted from having to be reachable, but - this is the part the old
 * version got backwards - they do not grant reachability to anything *they*
 * import either, since being decided-dead is not the same as being alive.
 *
 * ## What this does not catch
 *
 * Import is necessary, not sufficient. A component can be imported and
 * rendered behind a condition that is never true, and this will not notice -
 * `PresetBar` would have passed had anything imported it. Catching that
 * needs the running page, which is what the browser checks are for. This
 * catches the cheap half, and the cheap half is the half that happened
 * twice (now three times, counting RoomCards).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'

const ROOT = 'src'
const ENTRY = 'src/main.tsx'

/**
 * Components that nothing imports on purpose.
 *
 * A reason is required, not decorative. "Dead code we might want later" is not
 * one - that is what git is for, and a file kept on those terms is exactly the
 * file whose comments start describing a UI nobody has.
 *
 * These files are exempt from needing to be reachable themselves. They are
 * NOT roots: an import written inside one of them does not make its target
 * reachable, because a dead file's imports are dead code too. `RoomCards.tsx`
 * is the worked example - it has to earn its own entry, not inherit
 * `RoomPanel.tsx`'s.
 */
// Entry points. Mounted by the framework or by index.html, not by an import
// from another component - so unlike everything in ALLOWED below, these are
// alive and their imports must still be walked, or the walk never leaves the
// two files nothing else names.
const ROOTS = new Map([
  ['src/App.tsx', 'the root component, mounted by main.tsx'],
  ['src/main.tsx', 'the entry point itself, referenced from index.html'],
])

// Superseded architectures, each replaced by something that is on screen.
// Checked one at a time when this file was written, because "probably
// superseded" is how the hands display stayed hidden for months. These are
// dead: exempt from needing to be reachable, and - unlike ROOTS - their own
// imports are never walked, so a file only reachable through one of these
// needs its own entry here rather than inheriting reachability from it.
const ALLOWED = new Map([
  [
    'src/components/shared/Panel.tsx',
    'superseded by FreeCanvas (removed along with the rest of the middle ' +
      'dashboard column and freeform mode - see App.tsx\'s "kill the middle" ' +
      'comment), which had provided drag, resize and collapse',
  ],
  [
    'src/components/shared/RoomPanel.tsx',
    'superseded by DashboardLayout rendering CardDeck directly - DashboardLayout ' +
      'itself is now also gone (removed with the middle dashboard column), which ' +
      'does not revive this: dead-behind-dead stays dead',
  ],
  [
    'src/components/shared/RoomCards.tsx',
    "RoomPanel.tsx's only caller, and RoomPanel is itself superseded (see above) - " +
      'both are the same dead path, found when this file stopped granting reachability ' +
      'through allowlisted files',
  ],
  [
    'src/components/shared/ActionsPanel.tsx',
    "orphaned when panels.tsx (the panel registry) was deleted along with the " +
      "middle dashboard column and Basic/Power mode - its only callers were that " +
      "registry and the also-deleted DashboardLayout. The live Battle UI uses " +
      "BattleActionBar instead, which does not import this.",
  ],
  [
    'src/components/shared/BattlePanel.tsx',
    'same cause as ActionsPanel.tsx above - orphaned by the panels.tsx/' +
      'DashboardLayout deletion. The live Battle UI is BattleColumn.tsx, a ' +
      'separate component that does not import this.',
  ],
  [
    'src/components/room/RoomColumn.tsx',
    'same cause as ActionsPanel.tsx above. The live room UI is split across ' +
      'BattleColumn.tsx and GameChatColumn.tsx, neither of which imports this.',
  ],
  [
    'src/components/shared/ScriptLauncher.tsx',
    'same cause as ActionsPanel.tsx above. The live equivalent is ' +
      'TaskFlowPanel.tsx (Tasks & Scripts), a separate component.',
  ],
  [
    'src/components/shared/CardDeck.tsx',
    "was only reachable through BattlePanel.tsx and RoomCards.tsx, both " +
      "themselves dead-and-allowlisted above - a dead file's imports grant no " +
      "reachability (see this file's own header), so this was already dead, " +
      "just masked until panels.tsx stopped being a live path to BattlePanel. " +
      "Its live replacement is CombatRadar.tsx's own card rendering.",
  ],
  [
    'src/components/shared/CreatureCard.tsx',
    'same cause as CardDeck.tsx above - reachable only through it, which is ' +
      'itself dead.',
  ],
  [
    'src/components/shared/Badge.tsx',
    "CreatureCard.tsx's only caller, and CreatureCard is itself dead (see " +
      'above) - the same masked chain, one link further in.',
  ],
  [
    'src/components/shared/MacroBar.tsx',
    'reachable only through ActionsPanel.tsx, which is dead (see above).',
  ],
  [
    'src/components/shared/VitalCluster.tsx',
    'reachable only through BattlePanel.tsx, which is dead (see above).',
  ],
])

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  // padEnd(50) only separates name from detail when name is under 50 chars;
  // past that it's a no-op and the two run together with nothing between
  // them. The trailing space guarantees a gap either way.
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)} ${detail}`)
}

function walkExt(dir, exts) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walkExt(p, exts))
    else if (exts.some((ext) => p.endsWith(ext))) out.push(p)
  }
  return out
}

const componentFiles = walkExt(ROOT, ['.tsx']).map((f) => f.split(sep).join('/'))
const allSourceFiles = walkExt(ROOT, ['.tsx', '.ts']).map((f) => f.split(sep).join('/'))
const sources = new Map(allSourceFiles.map((f) => [f, readFileSync(f, 'utf8')]))

/** Resolve a relative import specifier from `fromFile` to an actual file in `sources`. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null // not a local module
  const base = join(dirname(fromFile), spec).split(sep).join('/')
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ]
  return candidates.find((c) => sources.has(c)) ?? null
}

const IMPORT_RE = /from\s+'([^']+)'/g

function importsOf(file) {
  const text = sources.get(file) ?? ''
  const specs = [...text.matchAll(IMPORT_RE)].map((m) => m[1])
  return specs.map((s) => resolveImport(file, s)).filter(Boolean)
}

// BFS from main.tsx. ROOTS are alive and always expanded. Dead-allowlisted
// files are exempt from *needing* to be reached, but walking through one
// would grant reachability to whatever it imports, which is exactly the bug
// being fixed - so they are never expanded, even if the walk happens to
// reach them some other way. Takes the dead-allowlist as a parameter so the
// sabotage below can call this with a deliberately wrong one rather than
// duplicating the walk.
function reachableSet(dead) {
  const reachable = new Set()
  const queue = [ENTRY]
  while (queue.length) {
    const f = queue.shift()
    if (reachable.has(f)) continue
    reachable.add(f)
    if (dead.has(f)) continue
    for (const dep of importsOf(f)) {
      if (!reachable.has(dep)) queue.push(dep)
    }
  }
  return reachable
}

function orphansOf(dead, reachable) {
  return componentFiles.filter((f) => !ROOTS.has(f) && !dead.has(f) && !reachable.has(f))
}

console.log('-- every component file is reachable from the app entry point --')
{
  // The fragile denominator. If the walk breaks or the extension changes,
  // "nothing is unreferenced" becomes true of an empty list, which is the
  // failure this whole file is about.
  ok(
    'there are components to check',
    componentFiles.length >= 30,
    `${componentFiles.length} .tsx files`
  )
  ok('the entry point exists', existsSync(ENTRY), ENTRY)

  const reachable = reachableSet(ALLOWED)
  const orphans = orphansOf(ALLOWED, reachable)

  ok(
    'nothing renders only to a dead file',
    orphans.length === 0,
    orphans.length
      ? `${orphans.join(', ')} — add to ALLOWED with a reason, or mount it`
      : `${componentFiles.length - ROOTS.size - ALLOWED.size} checked`
  )

  // Positive control: every dead-allowlisted file must actually be
  // unreachable on its own merits. An ALLOWED entry that the graph reaches
  // anyway is a stale exemption granted to a file that is not actually dead
  // - the mirror image of the bug this rewrite fixes, and worth catching for
  // the same reason a stale warning is worse than none.
  const staleAllowed = [...ALLOWED.keys()].filter((f) => reachable.has(f))
  ok(
    'no ALLOWED entry is actually reachable (the exemption still applies)',
    staleAllowed.length === 0,
    staleAllowed.length ? `${staleAllowed.join(', ')} — remove from ALLOWED, it is mounted` : ''
  )
}

console.log('\n-- the allowlist is a list of decisions, not a dumping ground --')
{
  // An allowlist entry for a file that no longer exists is a stale claim, and
  // it quietly grants an exemption to nothing while looking like care. Checks
  // ROOTS too - a renamed entry point would silently disable the whole walk.
  const missing = [...ROOTS.keys(), ...ALLOWED.keys()].filter((f) => !componentFiles.includes(f))
  ok(
    'every root and allowed file still exists',
    missing.length === 0,
    missing.join(', ') || `${ROOTS.size} roots, ${ALLOWED.size} allowed entries`
  )

  const unreasoned = [...ROOTS.entries(), ...ALLOWED.entries()].filter(
    ([, why]) => !why || why.length < 12
  )
  ok('every entry carries a reason', unreasoned.length === 0, unreasoned.map(([f]) => f).join(', '))
}

console.log('\n-- sabotage: a two-file dead chain must still be caught --')
{
  // Reproduces the exact bug this rewrite fixes: RoomCards.tsx's only
  // reader is RoomPanel.tsx, which is dead and allowlisted. Un-allowlist
  // RoomCards.tsx (in a copy, real ALLOWED is untouched) and re-run the same
  // walk. If the fix works, RoomCards.tsx must come back as the one and only
  // orphan - not zero (the walk did nothing), not more than one (something
  // else broke), exactly the file that was removed.
  const target = 'src/components/shared/RoomCards.tsx'
  if (!ALLOWED.has(target)) {
    ok('sabotage precondition: target is normally allowlisted', false, `${target} is not in ALLOWED - update this sabotage`)
  } else {
    const sabotaged = new Map(ALLOWED)
    sabotaged.delete(target)
    const reachable = reachableSet(sabotaged)
    const orphans = orphansOf(sabotaged, reachable)
    ok(
      'removing its exemption makes RoomCards.tsx fail, and only RoomCards.tsx',
      orphans.length === 1 && orphans[0] === target,
      `orphans: ${orphans.join(', ') || '(none — sabotage did not land)'}`
    )
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
