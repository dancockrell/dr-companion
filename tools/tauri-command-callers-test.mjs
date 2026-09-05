/**
 * Every Tauri command registered in `generate_handler!` has a caller in
 * `src/`, and every command `src/` invokes is registered.
 *
 * Why this exists (#275). Three commands were registered and reachable from
 * nothing: `publish_presentation_event` (#273/#274 wired it), and
 * `bridge_install_status` and `extract_lich`, both of which turned out to be
 * second implementations of a question something else already answered - the
 * setup screen's bridge row, and `extract_archive`. A registered command with
 * no caller is not merely unused: it looks wired from the Rust side, so the
 * next person to change that area edits the copy whose output nothing
 * renders. `docs/LIVE-STATE.md` records one reader nearly doing exactly that.
 *
 * The reverse direction matters as much and fails more loudly in production:
 * an `invoke('...')` naming a command that is not registered is a runtime
 * error the compiler cannot see, because the name is a string on one side and
 * a path on the other.
 *
 * # What "has a caller" means here
 *
 * The bare command name appearing anywhere in the text of a `.ts`/`.tsx` file
 * under `src/`, at a word boundary. Deliberately looser than "appears inside
 * an invoke literal": `openPanelWindow` builds its command name in a variable
 * and passes it to a shared `act()` helper (`src/lib/panelWindows.ts`), so a
 * literal-only check would call `open_panel_window` dead and be wrong. Looser
 * means this can only ever under-report, which is the safe direction for a
 * check whose failure mode is somebody deleting a live command.
 *
 * The boundary is not cosmetic: `install_bundle` is a strict prefix of
 * `install_bundled_ruby4lich5`, so a plain substring match would report the
 * former as called whatever happened to it. That pair is asserted below as a
 * control rather than trusted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}

/**
 * Commands deliberately registered ahead of the caller that will use them.
 *
 * An entry is a promise that somebody is coming back, so each carries the
 * reason and is itself checked: an exemption for a command that has since
 * grown a caller fails, because a stale exemption is how the next dead
 * command hides. Empty is the correct state; add to it only with a reason a
 * reader can act on.
 */
const DEFERRED = Object.create(null)

const LIB_RS = 'src-tauri/src/lib.rs'

/** The registered command names, or a thrown error. Never a quiet empty list. */
function registeredCommands(libRsText) {
  const m = libRsText.match(/generate_handler!\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error(`${LIB_RS}: generate_handler! block not found - the parser is broken, this is not an empty result`)
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .join('')
    .split(',')
    .map((c) => c.trim().split('::').pop())
    .filter((c) => /^[a-z0-9_]+$/.test(c))
}

/** Every .ts/.tsx file under src/, as one blob plus a name->file index. */
function readTsTree(root = 'src') {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry)) files.push(p)
    }
  }
  walk(root)
  return files.map((p) => ({ path: p, text: readFileSync(p, 'utf8') }))
}

/** Word-boundary mention. `_` is a word character, so `\b` is the wrong tool. */
const mentions = (text, name) =>
  new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text)

/** Literal command names passed to invoke/invokeTauri anywhere in src/. */
function invokedLiterals(files) {
  const found = new Map()
  for (const f of files) {
    for (const m of f.text.matchAll(/invoke[A-Za-z]*\(\s*['"]([a-z0-9_]+)['"]/g)) {
      if (!found.has(m[1])) found.set(m[1], f.path)
    }
  }
  return found
}

/**
 * The whole analysis as one function of its two inputs, so the sabotage cases
 * below can run it against mutated text without touching a file on disk.
 * Nothing in this suite writes to the tree - the md5 assertion at the end is
 * what proves that rather than a promise in a comment.
 */
function analyse(libRsText, files) {
  const commands = registeredCommands(libRsText)
  const blob = files.map((f) => f.text).join('\n')
  const invoked = invokedLiterals(files)

  const callerless = commands.filter((c) => !mentions(blob, c) && !(c in DEFERRED))
  const staleDeferrals = Object.keys(DEFERRED).filter((c) => mentions(blob, c))
  const unregistered = [...invoked.keys()].filter((c) => !commands.includes(c))
  return { commands, invoked, callerless, staleDeferrals, unregistered }
}

const libRs = readFileSync(LIB_RS, 'utf8')
const md5Before = createHash('md5').update(readFileSync(LIB_RS)).digest('hex')
const files = readTsTree()
const r = analyse(libRs, files)

console.log(`-- denominators --`)
console.log(`   ${r.commands.length} commands registered in ${LIB_RS}`)
console.log(`   ${files.length} .ts/.tsx files under src/`)
console.log(`   ${r.invoked.size} distinct command names invoked by literal`)
console.log(`   ${Object.keys(DEFERRED).length} deferred exemptions\n`)

// A floor well below the real count, so a parser that returns a truncated or
// empty list reports itself instead of reporting a clean tree. It is not a
// target: it never needs touching while commands are added.
ok('the handler list parsed to a plausible size', r.commands.length >= 40, `${r.commands.length} commands`)
ok('src/ produced files to search', files.length >= 50, `${files.length} files`)
ok('invoke literals were found', r.invoked.size >= 40, `${r.invoked.size} names`)

console.log('\n-- controls: the instrument can say both words --')
{
  const blob = files.map((f) => f.text).join('\n')
  ok('a name that is definitely called reads as called', mentions(blob, 'plan_setup'))
  ok('a name that cannot exist reads as absent', !mentions(blob, 'zz_not_a_command'))
  // The boundary case this check would otherwise get silently wrong.
  ok(
    'install_bundle is not confused with install_bundled_ruby4lich5',
    mentions(blob, 'install_bundle') && !mentions(blob, 'install_bundl'),
    'prefix must not count as a mention'
  )
}

console.log('\n-- every registered command is reachable from src/ --')
ok(
  'no command is registered with nothing to call it',
  r.callerless.length === 0,
  r.callerless.length ? r.callerless.join(', ') : `${r.commands.length} checked`
)
ok(
  'no deferred exemption has quietly grown a caller',
  r.staleDeferrals.length === 0,
  r.staleDeferrals.length ? `remove from DEFERRED: ${r.staleDeferrals.join(', ')}` : 'none stale'
)

console.log('\n-- every command src/ invokes is registered --')
ok(
  'no invoke names a command Rust does not register',
  r.unregistered.length === 0,
  r.unregistered.length
    ? r.unregistered.map((c) => `${c} (${r.invoked.get(c)})`).join(', ')
    : `${r.invoked.size} checked`
)

console.log('\n-- sabotage: the checks above must be able to fail --')
{
  // Register a command nothing can possibly call. Mutated in memory; the md5
  // assertion at the end proves lib.rs on disk was never touched.
  const mutated = libRs.replace(
    'setup::plan_setup,',
    'setup::plan_setup,\n            setup::zz_bogus_command,'
  )
  if (mutated === libRs) throw new Error('sabotage "bogus command" did not change the text - the anchor has moved')
  const s = analyse(mutated, files)
  ok('sabotage lands: a bogus registration is reported', s.callerless.includes('zz_bogus_command'), s.callerless.join(', '))
  ok('sabotage is scoped: nothing else turned callerless', s.callerless.length === 1, `${s.callerless.length} reported`)
  ok('sabotage did not disturb the other direction', s.unregistered.length === 0)
}
{
  // The opposite direction: invoke a command that is not registered.
  const fake = { path: 'src/__sabotage__.ts', text: "await invokeTauri('zz_unregistered_command')\n" }
  const s = analyse(libRs, [...files, fake])
  ok('sabotage lands: an unregistered invoke is reported', s.unregistered.includes('zz_unregistered_command'), s.unregistered.join(', '))
  ok('sabotage is scoped: no command lost its caller', s.callerless.length === 0)
}
{
  // And the parser itself: a lib.rs with no handler block must abort, not
  // return an empty list and pass. An empty list would make every command
  // vacuously fine, which is the exact shape of a check that cannot fail.
  let threw = false
  try {
    analyse('fn main() {}\n', files)
  } catch {
    threw = true
  }
  ok('a missing handler block aborts rather than passing vacuously', threw)
}

const md5After = createHash('md5').update(readFileSync(LIB_RS)).digest('hex')
ok('this suite wrote nothing to lib.rs', md5Before === md5After, md5After.slice(0, 12))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
