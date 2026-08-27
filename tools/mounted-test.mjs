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
 * ## What this does not catch
 *
 * Import is necessary, not sufficient. A component can be imported and rendered
 * behind a condition that is never true, and this will not notice - `PresetBar`
 * would have passed had anything imported it. Catching that needs the running
 * page, which is what the browser checks are for. This catches the cheap half,
 * and the cheap half is the half that happened twice.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = 'src'

/**
 * Components that nothing imports on purpose.
 *
 * A reason is required, not decorative. "Dead code we might want later" is not
 * one - that is what git is for, and a file kept on those terms is exactly the
 * file whose comments start describing a UI nobody has.
 */
const ALLOWED = new Map([
  // Entry points. Mounted by the framework or by index.html, not by an import
  // from another component.
  ['src/App.tsx', 'the root component, mounted by main.tsx'],
  ['src/main.tsx', 'the entry point itself, referenced from index.html'],

  // Superseded architectures, each replaced by something that is on screen.
  // Checked one at a time when this file was written, because "probably
  // superseded" is how the hands display stayed hidden for months.
  [
    'src/components/dashboard/DockView.tsx',
    'superseded by DashboardLayout, which is a fixed layout rather than a panel registry',
  ],
  [
    'src/components/shared/MapView.tsx',
    'superseded by MapCanvas, which is the drawing MapPanel and the popped-out window share',
  ],
  [
    'src/components/shared/Panel.tsx',
    'superseded by FreeCanvas, which is what actually provides drag, resize and collapse',
  ],
  [
    'src/components/shared/RoomPanel.tsx',
    'superseded by DashboardLayout rendering CardDeck directly',
  ],
])

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${detail}`)
}

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = walk(ROOT).map((f) => f.split(sep).join('/'))
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))

// Also read .ts, because a component can be referenced from a registry or a
// helper rather than from another component.
function walkTs(dir) {
  const out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walkTs(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}
const allText = [...sources.values(), ...walkTs(ROOT).map((f) => readFileSync(f, 'utf8'))].join('\n')

console.log('-- every component file is reachable from another file --')
{
  // The fragile denominator. If the walk breaks or the extension changes,
  // "nothing is unreferenced" becomes true of an empty list, which is the
  // failure this whole file is about.
  ok('there are components to check', files.length >= 30, `${files.length} .tsx files`)

  const orphans = []
  for (const f of files) {
    if (ALLOWED.has(f)) continue

    // The module name as another file would import it: the basename without
    // extension. Matching on that rather than on a resolved path keeps this
    // honest about relative imports without reimplementing module resolution.
    const base = f.split('/').pop().replace(/\.tsx$/, '')

    // Anything that names this module, in any file but itself.
    const referenced = [...sources.entries()].some(
      ([other, text]) => other !== f && new RegExp(`from '[^']*/${base}'`).test(text)
    ) || new RegExp(`from '[^']*/${base}'`).test(allText.replace(sources.get(f) ?? '', ''))

    if (!referenced) orphans.push(f)
  }

  ok(
    'nothing renders only to itself',
    orphans.length === 0,
    orphans.length
      ? `${orphans.join(', ')} — add to ALLOWED with a reason, or mount it`
      : `${files.length - ALLOWED.size} checked`
  )
}

console.log('\n-- the allowlist is a list of decisions, not a dumping ground --')
{
  // An allowlist entry for a file that no longer exists is a stale claim, and
  // it quietly grants an exemption to nothing while looking like care.
  const missing = [...ALLOWED.keys()].filter((f) => !files.includes(f))
  ok('every allowed file still exists', missing.length === 0, missing.join(', ') || `${ALLOWED.size} entries`)

  const unreasoned = [...ALLOWED.entries()].filter(([, why]) => !why || why.length < 12)
  ok('every entry carries a reason', unreasoned.length === 0, unreasoned.map(([f]) => f).join(', '))
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
