/**
 * "Verified" has to mean something was checked, not that something was saved.
 *
 * The persistent status on a completed download used to say "Verified and
 * saved" unconditionally — including when the upstream project publishes no
 * checksum, where `DownloadResult.verified` from the Rust side is `true` for
 * the same reason it's true after a real hash match: `expected_sha256.is_empty()`
 * is one of the two conditions that sets it. The transient log line and the
 * detail dropdown already said "source only, not upstream's" for that case;
 * the loud, permanent line on the card did not. See `downloadVerification.ts`.
 *
 * This tests the property — a claim of "verified" requires something to have
 * actually been checked against — not the mechanism. It does not render
 * ComponentCard or SetupWizard (no component-test harness in this repo); it
 * asserts the pure function both of them now call, which is exactly what
 * would need to change for the claim to become false again.
 */
import { wasChecked } from '../src/lib/downloadVerification.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
}

console.log('-- a download cannot claim "verified" with nothing checked --')

ok(
  'no checksum, not bundled: unchecked',
  wasChecked({ bundled: false, sha256: '' }) === false
)

console.log('\n-- the two ways a claim of "verified" is legitimate --')

ok(
  'a published checksum: checked',
  wasChecked({ bundled: false, sha256: 'abc123' }) === true
)
ok(
  'a bundled copy, hashed at build time and again now, even with no upstream digest: checked',
  wasChecked({ bundled: true, sha256: '' }) === true
)
ok(
  'bundled and a checksum both present: still checked',
  wasChecked({ bundled: true, sha256: 'abc123' }) === true
)

console.log(
  failed ? `\n${failed} failed` : '\nall passed'
)
process.exit(failed ? 1 : 0)
