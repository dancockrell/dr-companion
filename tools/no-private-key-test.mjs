/**
 * No private key is in this repository.
 *
 * # Why this check exists at all
 *
 * The updater changed what a leak here costs. Before it, a credential in this
 * tree would have been embarrassing. Now there is exactly one key whose holder
 * can publish a signed installer that every copy of DR Companion will download
 * and run without asking anybody anything: the updater's minisign private key.
 * Committing it is not a mistake that can be walked back, because git history
 * is public and permanent, and the repair is a new keypair plus every existing
 * install losing its update channel.
 *
 * The public half belongs in `src-tauri/tauri.conf.json` and is committed. The
 * private half must never be in the working tree at all — see
 * `docs/RELEASE.md` §2.4 for where it lives instead.
 *
 * # What it looks for, and why not only `gitleaks`
 *
 * `gitleaks` matches shapes like `api_key=`. A minisign secret key is a
 * two-line file whose second line is base64 and whose first line is a comment
 * saying, in English, what it is. That matches nothing. This project has been
 * bitten by exactly that before: a scan reported clean across 2.5 GB while an
 * itch.io token sat tracked in git under a filename nobody grepped for.
 *
 * So this greps for the header lines by content, for PEM private keys, and for
 * filenames that name a key — and it checks the **tracked** file list rather
 * than the working tree, because a key that is only in `.gitignore` is not a
 * key that has been committed, and reporting one as a failure would teach
 * whoever runs this that the check cries wolf. A key that is tracked *or*
 * matches by content anywhere non-ignored is a failure.
 *
 *     node tools/no-private-key-test.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/**
 * Content signatures, assembled from halves.
 *
 * Written as fragments joined at runtime rather than as literals, and that is
 * not cleverness. The first version of this file spelled them out, so the file
 * matched its own search, and the honest fix looked like "exclude this file
 * from the scan" - which is a hole exactly the size of the checker. Joining
 * halves keeps the search whole: there is no exclusion list, so a key really
 * anywhere in the tree, including in here, is found.
 *
 * The first two are the exact headers `tauri signer generate` and `minisign
 * -G` write; the rest are the other private-key formats that could plausibly
 * arrive in a Tauri project.
 */
const CONTENT_MARKERS = [
  ['untrusted comment: rsign encrypted ', 'secret key'],
  ['untrusted comment: minisign encrypted ', 'secret key'],
  ['-----BEGIN ', 'PRIVATE KEY-----'],
  ['-----BEGIN RSA ', 'PRIVATE KEY-----'],
  ['-----BEGIN EC ', 'PRIVATE KEY-----'],
  ['-----BEGIN OPENSSH ', 'PRIVATE KEY-----'],
  ['-----BEGIN PGP ', 'PRIVATE KEY BLOCK-----'],
].map(([a, b]) => a + b)

/**
 * Tracked paths that *are* a key file, whatever their content.
 *
 * Matches the basename, not the path, and requires the name to be a key file
 * rather than to mention one. The first version matched any path containing
 * `private-key` and its first red result was this file: the moment
 * `no-private-key-test.mjs` was staged it became tracked, matched its own
 * pattern, and failed. Funny, and a real defect — a rule that fires on prose
 * about keys is a rule that fires on documentation, on this suite, and on the
 * `docs/RELEASE.md` §2.4 section that tells a person where the key goes, and a
 * check that cries wolf in a release ritual is one somebody learns to skip.
 *
 * So: an extension that only a key has, or one of the two conventional SSH
 * names. `updater-private.key` matches; this file does not; and the pair below
 * is asserted rather than assumed, because a matcher is a chooser and a
 * chooser has to be tested where the wrong answer is available.
 */
const NAME_PATTERN = /(^|\/)(id_rsa|id_ed25519|[^/]+\.(key|pfx|p12|jks|keystore))$/i

function tracked() {
  return execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
}

/**
 * Grep the working tree for the content markers.
 *
 * `git grep --untracked --exclude-standard` rather than a hand-rolled walk:
 * it honours `.gitignore`, which is the difference between "a key is about to
 * be committed" and "a key is sitting in an ignored build directory where the
 * release ritual puts it on purpose". `-F` because these are literals, and
 * `-I` to skip binaries, where a false positive would be unreadable anyway.
 *
 * Exit 1 from `git grep` means no match, which is the good case, so the status
 * has to be interpreted rather than treated as failure.
 */
function grepContent(markers, { includeUntracked = true } = {}) {
  const args = ['-C', ROOT, 'grep', '-I', '-l', '-F']
  if (includeUntracked) args.push('--untracked', '--exclude-standard')
  for (const m of markers) args.push('-e', m)
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  } catch (e) {
    if (e.status === 1) return []
    throw new Error(`git grep failed (${e.status}): ${e.stderr ?? ''}`)
  }
}

let pass = 0
let fail = 0
const failures = []
function ok(label, condition, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (detail && !condition) console.log(`     ${detail}`)
  if (condition) pass++
  else {
    fail++
    failures.push(label)
  }
}

// ── The positive control ────────────────────────────────────────────────────
//
// A planted key, in a directory this check must look in, proving the grep can
// see one. Without this, an empty result means "no key" and "the search is
// broken" identically — and a broken key scan reports clean forever.
//
// Written into `tools/` rather than a temp directory on purpose: the whole
// claim is about *this repository*, so the control has to be inside it, and a
// control that lived outside would pass even if the search were pointed
// somewhere else entirely.
const FIXTURE = join(ROOT, 'tools', 'fixtures', 'planted-private-key-control.txt')
{
  mkdirSync(join(ROOT, 'tools', 'fixtures'), { recursive: true })
  // Built from the marker itself, not typed out again. A literal here would
  // put the header in this file and make the scan match its own source - the
  // same self-hit the fragment-joining above exists to avoid, arriving through
  // the control instead of through the constant. It also means the control
  // cannot drift from what is being searched for: if the marker changed and the
  // fixture did not, the control would go on planting a string nothing looks
  // for and this whole file would report a clean tree it had not searched.
  // The base64 is the word "control" repeated. It is not a key.
  writeFileSync(FIXTURE, `${CONTENT_MARKERS[0]}\nY29udHJvbGNvbnRyb2xjb250cm9sY29udHJvbA==\n`)
  try {
    const hits = grepContent(CONTENT_MARKERS)
    const found = hits.some((h) => h.replaceAll('\\', '/').endsWith('tools/fixtures/planted-private-key-control.txt'))
    ok('the control: a planted private key in this tree is found', found, `hits: ${hits.join(', ') || '(none)'}`)
    ok('the control: the planted key is the only hit', hits.length === 1, `hits: ${hits.join(', ')}`)
  } finally {
    rmSync(FIXTURE, { force: true })
  }
  let gone = false
  try {
    statSync(FIXTURE)
  } catch {
    gone = true
  }
  // The control damages the tree, so proving the damage is undone is part of
  // the check rather than a promise in a comment.
  ok('the control fixture was removed again', gone)
}

// ── The claim ───────────────────────────────────────────────────────────────
{
  const hits = grepContent(CONTENT_MARKERS)
  ok(
    'no file in this tree contains a private-key header',
    hits.length === 0,
    `found in: ${hits.join(', ')}`
  )
}
{
  // The matcher's own control, and it has both directions. A pattern that
  // matched nothing would pass the claim below for free, and a pattern that
  // matched everything would have been caught only by luck — which is exactly
  // how the first version was caught, by flagging this file.
  const shouldMatch = [
    'updater-private.key',
    'src-tauri/updater-private.key',
    'certs/server.pfx',
    'secrets/id_ed25519',
  ]
  const shouldNot = [
    'tools/no-private-key-test.mjs',
    'docs/RELEASE.md',
    'src-tauri/certs/eaccess-play-net.pem',
    'src/lib/keybindings.ts',
  ]
  const missed = shouldMatch.filter((p) => !NAME_PATTERN.test(p))
  const overreached = shouldNot.filter((p) => NAME_PATTERN.test(p))
  ok(`the filename matcher recognises all ${shouldMatch.length} key filenames`, missed.length === 0, `missed: ${missed.join(', ')}`)
  ok(`the filename matcher leaves all ${shouldNot.length} ordinary files alone`, overreached.length === 0, `wrongly matched: ${overreached.join(', ')}`)

  const files = tracked()
  ok(`the file list was read (${files.length} tracked files)`, files.length > 100, `${files.length}`)
  const named = files.filter((f) => NAME_PATTERN.test(f))
  ok(
    'no tracked file is named like a private key',
    named.length === 0,
    `named: ${named.join(', ')}`
  )
}
{
  // `.pem` is deliberately NOT in the name pattern above. This repository
  // tracks two of them on purpose - the pinned EAccess certificate and its
  // negative-test twin (`src-tauri/src/eaccess.rs`) - and a rule that flagged
  // them would be a warning that cries wolf on every run, which is worse than
  // no warning. The property that actually matters is asserted instead: a
  // tracked certificate file carries a certificate and no key half.
  const certs = tracked().filter((f) => /\.(pem|crt|cer)$/i.test(f))
  const bad = certs.filter((f) => {
    const text = readFileSync(join(ROOT, f), 'utf8')
    return CONTENT_MARKERS.some((m) => text.includes(m)) || !text.includes('BEGIN CERT' + 'IFICATE')
  })
  ok(
    `every tracked certificate file is a certificate and not a key (${certs.length} checked)`,
    certs.length > 0 && bad.length === 0,
    certs.length === 0 ? 'no certificate files found - has the pinning moved?' : `not certificates: ${bad.join(', ')}`
  )
}
{
  // The other way a key reaches a repository: baked into the config that is
  // supposed to hold only the public half.
  const conf = readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')
  ok(
    'tauri.conf.json holds no secret key material',
    !CONTENT_MARKERS.some((m) => conf.includes(m)) && !/privkey|privateKey|private_key/i.test(conf),
    'the updater section takes `pubkey` and nothing else'
  )
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 6
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error(`FAILED: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('all passed')
