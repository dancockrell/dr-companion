/**
 * Where Ruby actually is on this machine.
 *
 * Seven npm scripts ran `ruby ...` directly and one spawned `'ruby'`, and all
 * eight failed here with `'ruby' is not recognized` / `spawn ruby ENOENT` —
 * while Ruby was installed the whole time at `C:\Ruby4Lich5\<version>\bin`,
 * because that is Lich's own interpreter and DEPENDENCIES.md already names it
 * as a hard dependency of this project. Nothing had put it on PATH.
 *
 * So `npm test` went red on a machine where the thing under test was present
 * and working, which is the kind of red people learn to scroll past.
 *
 * One resolver rather than eight copies: the next script that needs Ruby
 * should not have to rediscover this.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every interpreter worth trying, best first.
 *
 * `DRC_RUBY` is authoritative rather than merely first. Somebody who names an
 * interpreter has said which one to use, and quietly running a different one
 * when theirs does not work would hide the thing they were checking — an
 * override that does nothing is worse than no override. It is also the seam
 * that makes the not-found path runnable on purpose: without it that branch is
 * only reachable on a machine with no Ruby at all, which is not a machine
 * anybody debugging this is sitting at.
 */
export function rubyCandidates() {
  if (process.env.DRC_RUBY) return [process.env.DRC_RUBY]
  const out = ['ruby']
  // Lich's bundled Ruby. The directory is versioned, so read it rather than
  // hardcoding a version — a Lich update would otherwise silently stop this
  // working, which is the failure this file exists to remove.
  try {
    for (const dir of readdirSync('C:\\Ruby4Lich5')) {
      const exe = join('C:\\Ruby4Lich5', dir, 'bin', 'ruby.exe')
      if (existsSync(exe)) out.push(exe)
    }
  } catch {
    // No Lich install. Normal on a machine that only builds the UI.
  }
  return out
}

/** Does this one run? Checked, not assumed from the path existing. */
function works(exe) {
  try {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 15000 })
    return r.status === 0 && /^ruby /i.test(r.stdout || '')
  } catch {
    return false
  }
}

/** A working ruby executable, or null. Never throws. */
export function findRuby() {
  return rubyCandidates().find(works) ?? null
}

/**
 * The line to print when there is no Ruby.
 *
 * Says plainly that this is not a pass, because a skipped check that reads
 * like a clean one is the failure this whole codebase keeps writing tests
 * about.
 */
export function notCheckedMessage(what) {
  return [
    `NOT CHECKED: no working Ruby found, so ${what} did not run.`,
    `             tried: ${rubyCandidates().join(', ')}`,
    `             set DRC_RUBY to a ruby executable to run it.`,
    `             This is not a pass. Nothing in ${what} was exercised.`,
  ].join('\n')
}
