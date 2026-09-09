/**
 * No surface a player sees by default renders a bare internal counter or an
 * internal state name.
 *
 * # The instance this came from
 *
 * On 9 September 2026 Dan looked at the AI panel in his live client, on a
 * machine with no model installed, and said it was jank that does not belong
 * in front of a customer. It read:
 *
 *   Local model - No local model is installed.
 *   Unreviewed events - 1200
 *   Model server [http://127.0.0.1:11434] [Test]
 *   No model server answered. Check that yours is running.
 *   Background jobs - queued 3
 *   Last attempt: absent: No local model is installed.
 *
 * Every one of those is an instrument: an internal counter, a queue depth
 * printed by its job state, a failure kind, a last-attempt string. Nothing
 * was wrong. The panel was reporting a healthy no-model install to a
 * developer, in a rail a player was trying to play in.
 *
 * # The sibling, and why this is not folded into ui-jargon-test
 *
 * `tools/ui-jargon-test.mjs` (#530) catches a different population: strings
 * naming a *Tauri command* or a retired product. Its name set comes from
 * `generate_handler!`. This one's comes from the TypeScript unions and the
 * status interface, and the property is about placement rather than
 * vocabulary - the same word is fine inside a disclosure and wrong in front.
 * One file deriving two unrelated name sets and applying two different
 * placement rules would be harder to sabotage-test than two files, and the
 * two failures want different messages.
 *
 * # The name set is derived, never typed
 *
 *   - `JobStatus` and `JobKind` from `src/lib/aiJobStore.ts`
 *   - `ProviderFailure` from `src/lib/aiModelProvider.ts`
 *   - the numeric fields of `AiWorkerStatus` from `src/lib/aiIngest.ts`
 *
 * A hand-typed list is a promise to keep it up to date, and this repo exists
 * partly to record that promises to be careful are what fail.
 *
 * **Only the snake_case members are banned as text**, and that restriction is
 * load-bearing rather than laziness. `running`, `failed`, `completed`,
 * `cancelled`, `absent`, `timeout` and `error` are ordinary English; banning
 * them would fire on dozens of legitimate sentences and this check would be
 * switched off inside a week, which is worth nothing (CLAUDE.md section 1: a
 * check that cries wolf is as empty as one that never fires). `awaiting_review`,
 * `map_reconciliation`, `out_of_memory` and `invalid_output` are not English
 * and cannot arrive in prose by accident.
 *
 * # The exemption is the `<details>` element, not a comment or a class name
 *
 * Text inside a `<details>` is not visible by default, so it is where the
 * numbers are allowed to live - that is the whole shape of the fix, and it is
 * why the exemption is computed from the real element ranges rather than from
 * a marker somebody could put anywhere. `DEV_ONLY` names the surfaces a player
 * reaches only by opening Settings' diagnostics, which is a developer view by
 * construction.
 *
 * # Three states
 *
 * Every parser refuses rather than returning empty: a union that does not
 * parse, an interface that yields no numeric fields, or a component walk that
 * finds no files is an abort naming the reason, never a clean pass.
 * `tools/dev-jank-break-check.mjs` sabotages each check in turn and asserts
 * which ones go red.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
let checks = 0
const ok = (name, cond, detail = '') => {
  checks++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}  ${detail}`)
}

const SRC = process.env.DRC_DEV_JANK_SRC ?? 'src'
const JOB_STORE = process.env.DRC_DEV_JANK_JOBS ?? 'src/lib/aiJobStore.ts'
const PROVIDER = process.env.DRC_DEV_JANK_PROVIDER ?? 'src/lib/aiModelProvider.ts'
const STATUS = process.env.DRC_DEV_JANK_STATUS ?? 'src/lib/aiIngest.ts'

/**
 * Read with the line endings normalised.
 *
 * The tree is checked out with CRLF on Windows, and the first version of the
 * union parser below anchored on a blank line written as two LFs. It reported
 * "the JobStatus union did not parse" against a perfectly ordinary file. An
 * LF anchor that never matches a CRLF checkout is CLAUDE.md section 17
 * exactly, and here it aborted naming the reason rather than passing quietly,
 * which is the behaviour the three-state rule is for. Line numbers are
 * unaffected: only the carriage returns go.
 */
const read = (p) => readFileSync(p, 'utf8').split('\r\n').join('\n')

/**
 * Surfaces a player reaches only through a diagnostics view.
 *
 * Short on purpose, and each entry names why. A long list here would be this
 * check being turned off one file at a time.
 */
const DEV_ONLY = [
  // Settings > diagnostics. Its entire purpose is to answer a maintainer's six
  // questions and build a bug bundle; it is where the AI panel's instruments
  // were moved to, so banning them here would ban the fix.
  'src/components/shared/DiagnosticsPanel.tsx',
]

// --------------------------------------------------------------------------
// The derived name sets.
// --------------------------------------------------------------------------
/** The members of a `export type X = | 'a' | 'b'` union, or a thrown error. */
function unionMembers(text, name, file) {
  const m = text.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?)\\n\\n`))
  if (!m) throw new Error(`${file}: the ${name} union did not parse - this is not an empty result`)
  const members = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
  if (members.length === 0) throw new Error(`${file}: ${name} parsed to zero members`)
  return members
}

/** The `name: number` fields of an interface, or a thrown error. */
function numericFields(text, name, file) {
  const m = text.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`${file}: the ${name} interface did not parse`)
  const fields = [...m[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:\s*number\b/gm)].map(
    (x) => x[1],
  )
  if (fields.length === 0) throw new Error(`${file}: ${name} parsed to zero numeric fields`)
  return fields
}

let stateNames
let counterFields
try {
  const jobs = read(JOB_STORE)
  const provider = read(PROVIDER)
  stateNames = [
    ...unionMembers(jobs, 'JobStatus', JOB_STORE),
    ...unionMembers(jobs, 'JobKind', JOB_STORE),
    ...unionMembers(provider, 'ProviderFailure', PROVIDER),
  ]
  counterFields = numericFields(read(STATUS), 'AiWorkerStatus', STATUS)
} catch (e) {
  console.log(`FAIL could not derive the name sets: ${e.message}`)
  process.exit(1)
}

ok(
  'the state unions parsed and produced members',
  stateNames.length >= 15,
  `${stateNames.length} member(s)`,
)
ok(
  'the status interface parsed and produced counters',
  counterFields.length >= 4,
  counterFields.join(', '),
)

/**
 * The banned text: only the members no English sentence can produce.
 *
 * Longest first, so `awaiting_review` is reported rather than a shorter name
 * that happens to be a substring.
 */
const BANNED_STATES = [...new Set(stateNames.filter((s) => s.includes('_')))].sort(
  (a, b) => b.length - a.length,
)
ok(
  'the machine-shaped members survive the English filter',
  BANNED_STATES.length >= 8,
  `${BANNED_STATES.length} of ${new Set(stateNames).size}: ${BANNED_STATES.slice(0, 4).join(', ')}...`,
)

// --------------------------------------------------------------------------
// The population: .tsx that is not a developer view.
// --------------------------------------------------------------------------
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.tsx$/.test(entry.name)) files.push(p.replace(/\\/g, '/'))
  }
}
walk(SRC)
const population = files.filter((f) => !DEV_ONLY.includes(f))
ok(
  'the component walk found files to read',
  population.length >= 50,
  `${population.length} of ${files.length} .tsx file(s); ${DEV_ONLY.length} developer view(s) exempt`,
)

// --------------------------------------------------------------------------
// What a reader sees: comments out, and everything inside a <details> out.
// --------------------------------------------------------------------------
const blank = (s) => s.replace(/[^\n]/g, '')

/**
 * Blank the interior of every `<details>` element, newlines preserved.
 *
 * Depth-counted rather than a lazy `<details>[\s\S]*?</details>`, so a nested
 * disclosure cannot end the outer one early and leave the tail of it exposed
 * to the scan - which would be a false hit pointing at text that is in fact
 * hidden, and the fastest way to get a check like this deleted.
 */
function stripDetails(src) {
  const out = src.split('')
  let depth = 0
  const tag = /<(\/?)details(?=[\s>])/g
  let m
  let start = 0
  while ((m = tag.exec(src)) !== null) {
    if (m[1] === '') {
      if (depth === 0) start = m.index
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0) {
        const end = src.indexOf('>', m.index)
        for (let i = start; i <= (end === -1 ? src.length - 1 : end); i++) {
          if (out[i] !== '\n') out[i] = ' '
        }
      }
    }
  }
  return out.join('')
}

/**
 * What a reader sees, in the order the removals have to happen.
 *
 * 1. **Comments first.** They are code about code and may name anything - and
 *    until they were removed first, the sentence in `AiWorkerPanel.tsx`
 *    explaining that this check "reads the `<details>` element" opened a
 *    phantom disclosure that never closed, so the depth counter never came
 *    back to zero and the real disclosure below it was never stripped. The
 *    check reported its own documentation as an offender.
 *
 * 2. **Quoted strings next.** A string literal is code naming a state, not a
 *    state reaching a reader: `status.lastFailureKind !== 'privacy_gate'` is a
 *    comparison and `<p>The job is awaiting_review.</p>` is a sentence, and
 *    the quotes are what separate them. This is the same call
 *    `ui-jargon-test.mjs` makes about `invoke('...')` arguments, for the same
 *    reason - a check that flagged both would be switched off within a week.
 *    The cost is a known blind spot: a state name interpolated into JSX
 *    through a template literal is not seen. Nothing in the tree does that,
 *    and the alternative is flagging every comparison in `src/`.
 *
 * 3. **Disclosures last**, on text that can no longer fake an opening tag.
 */
function visibleText(src) {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1)
  const noStrings = noComments.replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, blank)
  return stripDetails(noStrings)
}

/** A rendered occurrence of any banned state name. */
function stateHits(text, file) {
  const found = []
  text.split('\n').forEach((line, i) => {
    for (const name of BANNED_STATES) {
      // `_` is a word character, so `\b` is wrong for snake_case: guard both
      // sides explicitly or `out_of_memory` matches inside `out_of_memory_v2`.
      if (new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(line)) {
        found.push(`${file}:${i + 1} "${name}"`)
        break
      }
    }
  })
  return found
}

/**
 * A counter rendered into the DOM: `{something.journalPending}` in a JSX
 * expression, not a read of it in ordinary code.
 *
 * The `{` immediately before is what separates the two. `const lost =
 * status.journalLost + status.missedLines` is a computation and is fine; a
 * player only meets a number when it reaches an element.
 */
function counterHits(text, file) {
  const found = []
  text.split('\n').forEach((line, i) => {
    for (const field of counterFields) {
      if (new RegExp(`\\{\\s*[A-Za-z0-9_.?]*\\.${field}(?![A-Za-z0-9_])`).test(line)) {
        found.push(`${file}:${i + 1} "${field}"`)
        break
      }
    }
  })
  return found
}

let scanned = 0
const stateOffenders = []
const counterOffenders = []
for (const f of population) {
  const text = visibleText(read(f))
  scanned += text.split('\n').length
  stateOffenders.push(...stateHits(text, f))
  counterOffenders.push(...counterHits(text, f))
}
ok(
  'the scan read a real number of default-visible lines',
  scanned >= 5000,
  `${scanned} line(s) across ${population.length} file(s)`,
)
ok(
  'no default-visible surface renders an internal state name',
  stateOffenders.length === 0,
  stateOffenders.slice(0, 8).join('; ') +
    (stateOffenders.length > 8 ? ` (+${stateOffenders.length - 8} more)` : ''),
)
ok(
  'no default-visible surface renders a bare internal counter',
  counterOffenders.length === 0,
  counterOffenders.slice(0, 8).join('; ') +
    (counterOffenders.length > 8 ? ` (+${counterOffenders.length - 8} more)` : ''),
)

// --------------------------------------------------------------------------
// Controls. Without the first a green result may be nothing running; without
// the second this is a check that fires on the fix and gets switched off.
// --------------------------------------------------------------------------
{
  const plantedCounter = `      <span className="text-xs">{status.journalPending}</span>`
  ok(
    'positive control: a planted counter is caught',
    counterHits(visibleText(plantedCounter), 'PLANTED').length === 1,
    counterHits(visibleText(plantedCounter), 'PLANTED').join('; ') ||
      'nothing caught - this check is not running',
  )

  const plantedState = `      <p>The job is awaiting_review.</p>`
  ok(
    'positive control: a planted internal state name is caught',
    stateHits(visibleText(plantedState), 'PLANTED').length === 1,
    stateHits(visibleText(plantedState), 'PLANTED').join('; ') ||
      'nothing caught - this check is not running',
  )

  // The negative control is the fix itself: the identical text, moved inside a
  // closed disclosure, must not be flagged. If this ever fires, the fix and
  // the check disagree and the check is wrong.
  const inDetails = [
    `      <details>`,
    `        <summary>Details for a bug report</summary>`,
    plantedCounter,
    plantedState,
    `      </details>`,
  ].join('\n')
  const hidden = [
    ...counterHits(visibleText(inDetails), 'DETAILS'),
    ...stateHits(visibleText(inDetails), 'DETAILS'),
  ]
  ok(
    'negative control: the same text inside a details disclosure is not flagged',
    hidden.length === 0,
    hidden.join('; '),
  )

  // A nested disclosure must not end the outer one early. Without the depth
  // count the tail after the inner `</details>` reads as exposed.
  const nested = [
    `      <details>`,
    `        <details><summary>inner</summary>x</details>`,
    plantedCounter,
    `      </details>`,
  ].join('\n')
  ok(
    'a nested disclosure does not expose the text after it',
    counterHits(visibleText(nested), 'NESTED').length === 0,
    counterHits(visibleText(nested), 'NESTED').join('; '),
  )

  // Code that computes with a counter is not a counter reaching a reader.
  const computed = `      const lost = status.journalLost + status.missedLines`
  ok(
    'negative control: reading a counter in code is not rendering it',
    counterHits(visibleText(computed), 'CODE').length === 0,
    counterHits(visibleText(computed), 'CODE').join('; '),
  )

  // Comments are code about code and may name anything.
  const commented = [
    `      // awaiting_review is the state the scheduler parks in.`,
    `      /* out_of_memory and invalid_output are different failures. */`,
  ].join('\n')
  ok(
    'negative control: comments naming internal states are not flagged',
    stateHits(visibleText(commented), 'COMMENT').length === 0,
    stateHits(visibleText(commented), 'COMMENT').join('; '),
  )

  // The line-number guard: a stripper that ate newlines would still catch the
  // planted string and point at the wrong line, a false pointer wearing a tick.
  const padded = `/* pad\n   pad */\n<details>\n  <summary>s</summary>\n</details>\n${plantedState}`
  const where = stateHits(visibleText(padded), 'PADDED')[0] ?? ''
  ok('a hit reports the real line number', where.startsWith('PADDED:6 '), where || 'no hit at all')

  // The English filter is the reason this check is usable. If it stopped
  // working, `running` and `failed` would be banned and the tree would light
  // up - so assert it directly rather than trusting the count above.
  ok(
    'ordinary English state words are not banned',
    !BANNED_STATES.includes('running') &&
      !BANNED_STATES.includes('failed') &&
      !BANNED_STATES.includes('absent') &&
      !BANNED_STATES.includes('error'),
    BANNED_STATES.join(', '),
  )
}

console.log(`\n${checks} checks, ${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
