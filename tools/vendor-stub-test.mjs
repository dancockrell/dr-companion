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

console.log(`\n${fails === 0 ? 'all checks passed' : `${fails} FAILED`}`)
process.exit(fails === 0 ? 0 : 1)
