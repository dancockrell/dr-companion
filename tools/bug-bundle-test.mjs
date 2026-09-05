/**
 * E12. The bug bundle must refuse a credential, name the kind, and never the
 * value.
 *
 * The fixture is assembled at runtime rather than written as a literal. Not
 * style: gitleaks scans this repository and blocks credential-shaped literals
 * including invented ones, so a hardcoded fixture is a commit that cannot
 * land (plan section 1, trap 3). Assembling it keeps the entropy low and the
 * shape real.
 *
 *     node --experimental-strip-types tools/bug-bundle-test.mjs
 */
import {
  buildBugBundle,
  REQUIRED_ROW_IDS,
} from '../src/lib/bugBundle.ts'

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(64)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(64)} ${detail}`)
  }
}

const rows = [
  { id: 'ruby', label: 'Ruby', presence: 'present', detail: 'C:/Ruby34/bin/ruby.exe' },
  { id: 'lich', label: 'Lich', presence: 'present', detail: 'C:/Ruby4Lich5/Lich5' },
  { id: 'bridgePort', label: 'Bridge port', presence: 'absent' },
  { id: 'tokenFile', label: 'Token file', presence: 'could not check', detail: 'not running in the desktop app' },
  { id: 'viewer', label: 'World viewer', presence: 'absent' },
  { id: 'model', label: 'Local model', presence: 'absent' },
]

const base = {
  rows,
  log: [{ at: '10:00:00', text: 'Companion started.', seq: 1 }],
  appVersion: '0.1.1',
  bridgeVersion: '0.12.0',
  now: '2026-09-05T00:00:00.000Z',
}

/* ------------------------------------------------------- the happy path --- */

const good = buildBugBundle(base)
ok('a clean bundle is produced', good.ok === true)
if (good.ok) {
  const parsed = JSON.parse(good.text)
  ok('...and is valid JSON', typeof parsed === 'object')
  ok('...carrying every diagnostic row', parsed.diagnostics.length === rows.length,
    `${parsed.diagnostics.length}`)
  ok('...with nothing recorded as ungathered', parsed.diagnosticsNotGathered.length === 0)
  ok('...and the three presence values survive verbatim',
    parsed.diagnostics.map((d) => d.presence).includes('could not check'))
  ok('...and the activity log is in it', good.text.includes('Companion started.'))
}

/* --------------------------------------------------------- the refusal --- */

// Assembled, never written. Low entropy on purpose.
const CRED = ['pass', 'word', ': ', 'hunter', '2'].join('')
const withSecret = buildBugBundle({
  ...base,
  log: [
    { at: '10:00:00', text: 'Companion started.', seq: 1 },
    { at: '10:00:01', text: `note to self ${CRED}`, seq: 2 },
  ],
})

ok('a bundle carrying a credential is refused', withSecret.ok === false)
if (!withSecret.ok) {
  ok('...naming the pattern', withSecret.patterns.includes('account password'),
    withSecret.patterns.join(', '))
  // The whole point. A refusal that quoted the secret would be the leak.
  const shown = `${withSecret.message} ${withSecret.patterns.join(' ')}`
  ok('...and never the value', !shown.includes('hunter2') && !shown.includes(CRED))
  ok('...and no bundle text is handed back at all', !('text' in withSecret))
}

// A second shape, so the gate is not shown to work for one pattern only.
const TOKEN = ['api', '_key', '=', 'abcd', '1234'].join('')
const withKey = buildBugBundle({
  ...base,
  log: [{ at: '10:00:02', text: `config ${TOKEN}`, seq: 3 }],
})
ok('an api-key shape is refused too', withKey.ok === false)
if (!withKey.ok) {
  ok('...naming that pattern', withKey.patterns.includes('api or provider key'),
    withKey.patterns.join(', '))
}

// A credential in a *diagnostic detail* rather than the log, because the scan
// runs on the finished artefact and must not be scoped to one field.
const inDetail = buildBugBundle({
  ...base,
  rows: rows.map((r) => (r.id === 'tokenFile' ? { ...r, detail: CRED } : r)),
})
ok('a credential in a diagnostic detail is refused as well', inDetail.ok === false)

/* ------------------------------------------------- the honest incomplete --- */

const short = buildBugBundle({ ...base, rows: rows.slice(0, 2) })
ok('a bundle missing rows still builds', short.ok === true)
if (short.ok) {
  const parsed = JSON.parse(short.text)
  // A maintainer must never read an incomplete bundle as a complete one.
  ok('...and says which diagnostics were not gathered',
    parsed.diagnosticsNotGathered.length === REQUIRED_ROW_IDS.length - 2,
    parsed.diagnosticsNotGathered.join(', '))
}

/* -------------------------------------------------------- private speech --- */

// The log goes through bugReport.ts's scrub, so a tell in the activity log is
// redacted by the same patterns the bug report uses rather than a second set.
const withTell = buildBugBundle({
  ...base,
  log: [{ at: '10:00:03', text: 'Someone thinks to you, "meet me at the bank"', seq: 4 }],
})
ok('a private message in the log is scrubbed, not shipped', withTell.ok === true)
if (withTell.ok) {
  ok('...by the shared scrubber', !withTell.text.includes('meet me at the bank'))
  ok('...and the bundle says something was removed',
    JSON.parse(withTell.text).activityLogRedacted.length > 0)
}

/* ------------------------------------------------------------- positive --- */

// A control on the gate itself: if this ever passes, the scanner is not
// running and every refusal above proves nothing.
const control = buildBugBundle({
  ...base,
  log: [{ at: '10:00:04', text: ['secret', '_key', ': ', 'zzz', '999'].join(''), seq: 5 }],
})
ok('the scanner is actually running (control)', control.ok === false,
  control.ok ? 'THE GATE DID NOT FIRE' : control.patterns.join(', '))

console.log(`\n${pass + fail} checked, ${fail} failed`)
process.exit(fail ? 1 : 0)
