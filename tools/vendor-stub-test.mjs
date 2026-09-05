/**
 * The stub must unblock a dev build, and must never reach a release.
 *
 *   node tools/vendor-stub-test.mjs
 *
 * # Why this exists
 *
 * `--stub` writes a four-byte file to the exact path `tauri.conf.json`
 * bundles Ruby4Lich5 from. That is a convenience with a sharp edge: if one
 * ever survived into an installer, the symptom would appear on a user's
 * machine as a first run that cannot find Ruby, a long way from the decision
 * that caused it.
 *
 * `--require-real` is the guard, and a guard nobody has watched fail is a
 * promise rather than a check. So this asserts the refusal happens, names
 * which case it refused, and - the part that matters - asserts the guard
 * still ACCEPTS a genuine file, so a guard that simply always fails cannot
 * pass this suite either.
 *
 * The real 65 MB download is not needed: what `--require-real` verifies is
 * bytes against the hash its own manifest recorded, so a small file plus a
 * manifest naming its true hash exercises the accept path exactly.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const VENDOR = join(ROOT, 'src-tauri', 'vendor')
const EXE = join(VENDOR, 'Ruby4Lich5.exe')
const MANIFEST = join(VENDOR, 'Ruby4Lich5.manifest.json')
const SCRIPT = join(__dirname, 'vendor-fetch.mjs')

let fails = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) fails++
}

/** Run vendor-fetch with args; return {code, out}. Never throws on non-zero. */
function run(...args) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

// Preserve whatever is really vendored, so running this on a machine that has
// done a release fetch does not cost it a 65 MB re-download.
const BACKUP = join(ROOT, 'src-tauri', 'vendor.testbackup')
const hadVendor = existsSync(VENDOR)
if (hadVendor) {
  rmSync(BACKUP, { recursive: true, force: true })
  cpSync(VENDOR, BACKUP, { recursive: true })
}

try {
  console.log('-- nothing vendored at all is refused, and says what to run --')
  rmSync(VENDOR, { recursive: true, force: true })
  {
    const r = run('--require-real')
    check('an empty vendor dir is refused', r.code !== 0, `exit ${r.code}`)
    check('the refusal names the fix', r.out.includes('vendor:fetch'), r.out.trim().split('\n')[0] ?? '')
  }

  console.log('\n-- --stub writes something a build can proceed past --')
  {
    const r = run('--stub')
    check('--stub exits 0', r.code === 0, `exit ${r.code}`)
    check('the exe placeholder exists', existsSync(EXE))
    check('the manifest placeholder exists', existsSync(MANIFEST))
    check('the manifest declares itself a stub', readExisting()?.stub === true)
    check('the file carries the marker in its own bytes',
      readFileSync(EXE, 'utf8').includes('dr-companion-vendor-stub'))
  }

  console.log('\n-- a stub is refused for release --')
  {
    const r = run('--require-real')
    check('a stub is refused', r.code !== 0, `exit ${r.code}`)
    check('the refusal says it is a placeholder', /placeholder/i.test(r.out))
  }

  console.log('\n-- a stub is still refused after its manifest is deleted --')
  {
    // The manifest is the easy tell. The bytes are the one that survives
    // somebody tidying up, so the guard must not depend on the manifest alone.
    rmSync(MANIFEST, { force: true })
    const r = run('--require-real')
    check('a stub with no manifest is still refused', r.code !== 0, `exit ${r.code}`)
    check('refused as a placeholder, not merely as unverifiable', /placeholder/i.test(r.out))
  }

  console.log('\n-- a genuine file, matching its recorded hash, is ACCEPTED --')
  {
    // Without this the suite would pass against a guard that refuses
    // everything, which would block every release and look like safety.
    const bytes = Buffer.from('pretend this is 65 MB of installer')
    mkdirSync(VENDOR, { recursive: true })
    writeFileSync(EXE, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(MANIFEST, JSON.stringify({ version: 'v5.99.0-test', sha256, bytes: bytes.length }, null, 2))
    const r = run('--require-real')
    check('a real, hash-matching file is accepted', r.code === 0, `exit ${r.code} ${r.out.trim()}`)
  }

  console.log('\n-- a file that does not match its manifest hash is refused --')
  {
    writeFileSync(EXE, Buffer.from('tampered after the manifest was written'))
    const r = run('--require-real')
    check('a hash mismatch is refused', r.code !== 0, `exit ${r.code}`)
    check('the refusal reports both hashes', /hashes to .* manifest records/s.test(r.out))
  }
} finally {
  rmSync(VENDOR, { recursive: true, force: true })
  if (hadVendor) {
    cpSync(BACKUP, VENDOR, { recursive: true })
    rmSync(BACKUP, { recursive: true, force: true })
    console.log('\n(restored the vendor directory this test found in place)')
  }
}

function readExisting() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'))
  } catch {
    return null
  }
}

// --- reporting on a stub must not crash (issue #323) ------------------------
//
// A stub manifest records `sha256: null` deliberately: there is no real file to
// hash. Reading a digest out of it threw `Cannot read properties of null
// (reading 'slice')` from a message naming neither the file nor vendoring, and
// it killed `npm run tauri:build` in every worktree prepared the way the plan
// says to prepare one - `worktree:init` writes exactly this stub. The crash was
// in the *reporting* path, so the guard that matters still worked; both halves
// are checked here, because a fix that stopped the crash by weakening
// `--require-real` would be far worse than the crash.
{
  const stubbed = run(['--stub'])
  check('--stub writes placeholders', stubbed.code === 0, stubbed.out.trim().split('\n').pop())

  const reported = run(['--check'])
  check('and reporting on them exits cleanly rather than crashing', reported.code === 0, `exit ${reported.code}`)
  // Asserting the word "stub" appears was not enough: the fallback line prints
  // `vendored: stub, …` because the manifest's *version* is the string "stub",
  // so a check for that word passed with the branch disabled. Sabotage is what
  // said so. The guidance is the thing only this branch produces.
  check(
    'the report tells the reader how to get the real installer, which only the stub branch does',
    /vendor:fetch/.test(reported.out) && !/Cannot read properties/.test(reported.out),
    reported.out.trim().split('\n').pop()
  )
  check(
    'and it prints no digest field at all, having none to print',
    !/sha256/.test(reported.out)
  )

  const guarded = run(['--require-real'])
  check('and --require-real still refuses that stub, which is the half that must not soften', guarded.code === 1)
}

// --- the GitHub API failure path, which had never been executed -------------
//
// `Vendor Ruby4Lich5` failed with a bare `GitHub API: HTTP 403` three times on
// 5 Sep 2026 across three unrelated pull requests, each fixed by an unchanged
// rerun. A bare status code cannot say whether retrying could help, and the
// answer decides everything: a rate limit clears on its own, a permissions
// failure never does. These run that branch rather than reading it - a first
// attempt to prove it by stubbing `fetch` and importing the CLI died in the
// CLI's own startup and never reached the code under test.
{
  const { describeGithubFailure, githubHeaders } = await import('./vendor-fetch.mjs')
  const reset = 1757100000
  const resetIso = new Date(reset * 1000).toISOString()

  const limitedAnon = describeGithubFailure(403, '0', String(reset), false)
  check(
    'a 403 with no requests left is reported as a rate limit, not a bare status',
    limitedAnon.includes('rate limited') && limitedAnon.includes(resetIso),
    limitedAnon.slice(0, 52)
  )
  check(
    'and it names the unauthenticated limit, which is the fixable case',
    limitedAnon.includes('No GITHUB_TOKEN') && limitedAnon.includes('60/hour')
  )
  check(
    'the same failure with a token names the authenticated limit instead',
    describeGithubFailure(403, '0', String(reset), true).includes('1,000/hour')
  )
  // The distinction is the point: a 403 that is not the rate limit must not be
  // dressed as one, or somebody waits an hour on a permissions problem.
  check(
    'a 403 with requests remaining stays a plain status code',
    describeGithubFailure(403, '57', String(reset), false) === 'GitHub API: HTTP 403'
  )
  check(
    'an ordinary 404 is unchanged',
    describeGithubFailure(404, null, null, false) === 'GitHub API: HTTP 404'
  )

  check('no token in the environment means no Authorization header', githubHeaders({}).Authorization === undefined)
  check('a token is sent as a bearer credential', githubHeaders({ GITHUB_TOKEN: 'x' }).Authorization === 'Bearer x')
  check('and GH_TOKEN works too, because gh sets that one', githubHeaders({ GH_TOKEN: 'y' }).Authorization === 'Bearer y')
}

console.log(`\n${fails === 0 ? 'all checks passed' : `${fails} FAILED`}`)
process.exit(fails === 0 ? 0 : 1)
