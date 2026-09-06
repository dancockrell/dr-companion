/**
 * The last thing every break-check must do: prove it gave the tree back.
 *
 * These harnesses damage tracked source on purpose. Each already restores from
 * the bytes it read and compares an md5 or a sha256, and that is the right
 * check — but it is a check on *the file the harness knows about*. It cannot
 * see a file some other case in the same run left behind, a fixture created
 * and not deleted, or a restore written with the wrong line endings. Counting
 * what you restored can never reveal what you did not.
 *
 * So: ask git, over exactly the paths the harness touches, and a difference is
 * a hard failure naming the files rather than a footnote under a green
 * summary. Leaving a damaged file behind on a machine where several sessions
 * build this repo is the one outcome worse than having no negative test at
 * all — another lane compiles the sabotage and reports a defect that is this
 * harness's doing.
 *
 * # Why a comparison and not "is the tree clean"
 *
 * The first version of this asserted `git status --porcelain` was empty, which
 * is a different claim and the wrong one: these harnesses are run *while*
 * somebody is editing, and a lane that has changed one of the files under test
 * would fail every break-check for reasons that have nothing to do with the
 * harness. Worse, it made the assertion depend on how tidy the checkout
 * happened to be, so a green result would have meant "the tree was clean",
 * which is not the property.
 *
 * The property is that the run changed nothing: the same `git status` lines,
 * before and after. That is true on a clean checkout and equally true in the
 * middle of somebody's work, and it goes red on exactly the thing being
 * guarded against. Caught by running it — the very first run reported the
 * lane's own in-progress edits as damage.
 *
 * # Three states
 *
 * `git` itself can fail (not installed, not a checkout, a path it cannot
 * parse). That is not clean and not dirty but "could not tell", and it fails,
 * because a harness that cannot establish it handed the tree back has not
 * established it.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * `git status --porcelain` over these paths, as a sorted string, or an error.
 *
 * @param {string[]} paths repo-relative paths the caller intends to damage.
 *   Must be non-empty: an empty list makes every comparison trivially equal,
 *   which is the failure mode this whole file is written against.
 */
export function treeState(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { error: 'no paths were given, so any comparison would have passed over anything' }
  }
  const r = spawnSync('git', ['status', '--porcelain', '--', ...paths], { cwd: root, encoding: 'utf8' })
  if (r.error || r.status !== 0) {
    return { error: `git status did not run (${r.error?.message ?? `exit ${r.status}`}), so the tree state is unknown` }
  }
  return { lines: r.stdout.split('\n').map((l) => l.trimEnd()).filter(Boolean).sort() }
}

/**
 * Take the "before" reading. Call once, before any sabotage; the returned
 * function is the "after" one.
 *
 * @param {string[]} paths repo-relative paths the harness damages.
 * @returns {(exitCode?: number) => number} call at the end with whatever the
 *   harness had decided on its own; returns the exit code to use. A harness
 *   that caught every sabotage and left a file damaged has still failed, so
 *   this overrides a green verdict rather than being folded into it.
 */
export function watchTree(paths) {
  const before = treeState(paths)
  return (exitCode = 0) => {
    if (before.error) {
      console.log(`FAIL could not read the tree state before this run — ${before.error}`)
      return 1
    }
    const after = treeState(paths)
    if (after.error) {
      console.log(`FAIL could not read the tree state after this run — ${after.error}`)
      return 1
    }
    const b = before.lines.join('\n')
    const a = after.lines.join('\n')
    if (a === b) {
      console.log(
        `OK   git sees the ${paths.length} damaged path(s) exactly as this run found them` +
          (before.lines.length ? ` (${before.lines.length} already modified by somebody, unchanged)` : ' (clean before, clean after)'),
      )
      return exitCode
    }
    const gained = after.lines.filter((l) => !before.lines.includes(l))
    const lost = before.lines.filter((l) => !after.lines.includes(l))
    console.log('FAIL this run changed the tree and did not put it back:')
    for (const l of gained) console.log(`       now: ${l}`)
    for (const l of lost) console.log(`       gone: ${l}`)
    console.log('     Recover those paths from git before doing anything else; another lane may be building them.')
    return 1
  }
}
