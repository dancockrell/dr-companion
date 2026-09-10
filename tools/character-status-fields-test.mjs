/**
 * Lane W's mechanical version of "grep the consuming side before calling it
 * done" (CLAUDE.md's own words for it), pointed at the fields W0 publishes.
 *
 * # What this checks
 *
 * `CHARACTER_STATUS_FIELDS` below is the manifest of fields W0 added to
 * `CharacterStatus` in `src/types/index.ts`. This is a hand-kept list on
 * purpose, not a scrape of every field on the interface: the interface
 * already had fields nobody touched this increment, and a scan of the whole
 * type would silently start grading fields this lane never claimed. A
 * manifest that has to be updated by hand is the honest tradeoff — add a
 * field, add it here, or this test cannot see it either.
 *
 * For every field in the manifest:
 *
 * 1. **Documented** (hard requirement, fails the suite) — a real JSDoc
 *    comment (`\/** ... *\/`) sits directly above the field's declaration in
 *    `src/types/index.ts`, and it says something (more than a token
 *    placeholder), matching the standard `skillsReady`'s own doc comment
 *    sets: state what absence of the field means, not just what the field
 *    is.
 * 2. **Registered** (hard requirement, fails the suite) — `character.<field>`
 *    (or the field's bare name, for the rare panel-contract entry that
 *    drops the prefix) appears in at least one panel's `dataNeeded` array in
 *    `src/lib/panelDataContracts.ts`. A field nobody's contract admits to
 *    needing is a field the wrapper cannot honestly promise Godot.
 * 3. **Consumed** (named, not a failure yet) — grep across `src/components`
 *    and `src/lib` (excluding `src/types` and this test's own manifest) for
 *    any read of the field. W0 only publishes the type; W1-W6 wire the
 *    bridge and the components that read it, one field at a time. So a
 *    fresh W0 with zero consumers is the *expected* state here, and this
 *    check says so rather than failing on it — but it names every
 *    zero-consumer field individually, every run, so the count cannot go
 *    quiet before the lane that owns it actually closes.
 *
 *    Pass `--strict` (or set `DRC_FIELD_CHECK_STRICT=1`) to turn an
 *    unconsumed field into a hard failure instead. That is the mode Lane
 *    W's later increments (W1-W6) should be checked against once each is
 *    expected to have wired a real reader — running it here, today, with
 *    nothing wired yet, is the sabotage case the plan asks for: add a field
 *    nothing reads, and even in non-strict mode the report names it; in
 *    strict mode it fails.
 *
 *   node tools/character-status-fields-test.mjs
 *   node tools/character-status-fields-test.mjs --strict
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

const strict = process.argv.includes('--strict') || process.env.DRC_FIELD_CHECK_STRICT === '1'

// The manifest. One row per field W0 added to `CharacterStatus` (or, for
// `carriedItemCount`, the sibling numeric field beside the existing word
// `encumbrance`). Container `used`/`capacity` are deliberately not in this
// manifest — they already existed on `InventorySummary` before W0 touched
// anything; W0 only added documentation to them, which the "documented"
// check below would have nothing new to verify (see the report this test's
// commit shipped with for that finding).
const CHARACTER_STATUS_FIELDS = [
  {
    field: 'stance',
    declPattern: /stance\?:\s*'defensive' \| 'guarded' \| 'offensive'/,
  },
  {
    field: 'carriedItemCount',
    declPattern: /carriedItemCount\?:\s*number \| null/,
  },
  // W4 added these two beside `carriedItemCount`, and they are graded by the
  // same three rules. The manifest is hand-kept by design (see the header),
  // so a lane that adds a field adds its row here or this test cannot see it.
  {
    field: 'encumbranceLevel',
    declPattern: /encumbranceLevel\?:\s*number \| null/,
  },
  {
    field: 'encumbranceScaleMax',
    declPattern: /encumbranceScaleMax\?:\s*number \| null/,
  },
  {
    field: 'preparedSpell',
    declPattern: /preparedSpell\?:\s*PreparedSpell \| null/,
  },
  {
    field: 'rezzSicknessSeconds',
    declPattern: /rezzSicknessSeconds\?:\s*number \| null/,
  },
]

const typesSource = readFileSync(path.join(repoRoot, 'src/types/index.ts'), 'utf8')
const contractsSource = readFileSync(path.join(repoRoot, 'src/lib/panelDataContracts.ts'), 'utf8')

let pass = 0
let fail = 0
let notChecked = 0

function ok(label, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(78)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(78)} ${detail ?? ''}`)
  }
}

function info(label, detail) {
  notChecked += 1
  console.log(`INFO ${label.padEnd(78)} ${detail ?? ''}`)
}

// Walk src/components and src/lib for source files, skipping node_modules,
// this test's own manifest (which necessarily names every field), and
// src/types (declaring a field is not consuming it).
function listSourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

// src/lib/panelDataContracts.ts is excluded on purpose: its whole job is to
// *name* a field (as the string 'character.<field>' inside a dataNeeded
// array), which is exactly the registration check above, not a read. If
// left in this list, every field would show a false "consumer" — itself,
// via the same string this test just used to prove it was registered —
// and the one thing this check exists to catch (a field registered but
// read by nothing real) would be unfindable.
const panelDataContractsPath = path.join(repoRoot, 'src/lib/panelDataContracts.ts')
const consumerCandidates = [
  ...listSourceFiles(path.join(repoRoot, 'src/components')),
  ...listSourceFiles(path.join(repoRoot, 'src/lib')),
].filter((file) => file !== panelDataContractsPath)

const fileCache = new Map()
function readCached(file) {
  if (!fileCache.has(file)) fileCache.set(file, readFileSync(file, 'utf8'))
  return fileCache.get(file)
}

console.log(`-- ${CHARACTER_STATUS_FIELDS.length} field(s) in the W0 manifest --`)
ok(
  'the manifest is not accidentally empty (a broken manifest would silently check nothing)',
  CHARACTER_STATUS_FIELDS.length > 0,
  String(CHARACTER_STATUS_FIELDS.length),
)

for (const { field, declPattern } of CHARACTER_STATUS_FIELDS) {
  console.log(`\n-- ${field} --`)

  // 1. Declared at all, with the exact shape this test expects. If this
  // fails, every check below it is meaningless, so report it and move on
  // rather than let a missing field read as an undocumented one.
  const declared = declPattern.test(typesSource)
  ok(`${field}: declared on CharacterStatus with the expected shape`, declared)
  if (!declared) continue

  // 2. Documented: a real JSDoc block sits directly above the declaration.
  //
  // Find every /** ... */ block before the declaration, keep only the LAST
  // one, and require nothing but whitespace between its close and the
  // field. A naive single non-greedy match here (`/\*\*[\s\S]*?\*\//` run
  // once against "everything before the field") is the trap: `.match`
  // starts from the *first* `/**` in the whole file and, failing to land
  // on the field immediately, keeps expanding across every unrelated
  // comment in between until it finally reaches the real one — reporting a
  // 14,000-character "doc comment" that is actually the whole file. Caught
  // by eye on this test's first run: every field showed 10,000+ chars of
  // "documentation". Scanning with a global regex and keeping the last
  // non-overlapping match avoids it, because each match is independently
  // minimal and adjacent ones cannot merge into one.
  const declIndex = typesSource.search(declPattern)
  const before = typesSource.slice(0, declIndex)
  const commentRe = /\/\*\*[\s\S]*?\*\//g
  let lastComment = null
  let m
  while ((m = commentRe.exec(before))) lastComment = m
  const immediatelyAdjacent =
    lastComment != null && /^\s*$/.test(before.slice(lastComment.index + lastComment[0].length))
  const docText = immediatelyAdjacent ? lastComment[0] : ''
  // Strip comment syntax to judge real content, not asterisks and slashes.
  const docContent = docText.replace(/\/\*\*|\*\/|^\s*\*/gm, '').trim()
  ok(
    `${field}: has a real doc comment (not a placeholder) stating what absence means`,
    docContent.length > 120 && /absent|undefined|null/i.test(docContent),
    `${docContent.length} chars`,
  )

  // 3. Registered: named in at least one PANEL_DATA_CONTRACTS dataNeeded array.
  const registered = contractsSource.includes(`character.${field}`)
  ok(`${field}: named in PANEL_DATA_CONTRACTS' dataNeeded`, registered)

  // 4. Consumed: read anywhere outside src/types. Reported, and only a hard
  // failure under --strict.
  const readers = consumerCandidates.filter((file) => readCached(file).includes(`.${field}`))
  if (readers.length === 0) {
    const label = `${field}: read by at least one component/lib source`
    if (strict) {
      ok(label, false, '0 readers (strict mode: W0-published fields must have a consumer)')
    } else {
      info(label, '0 readers — expected pre-wiring; a later W1-W6 increment owns this. Re-run with --strict once it should not be zero.')
    }
  } else {
    ok(
      `${field}: read by at least one component/lib source`,
      true,
      `${readers.length} file(s): ${readers.map((f) => path.relative(repoRoot, f)).join(', ')}`,
    )
  }
}

console.log('')
const checked = pass + fail
console.log(`${checked} checked, ${fail} failed, ${notChecked} not checked`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
if (notChecked > 0) {
  console.log(`no failures, but ${notChecked} thing(s) went unchecked (informational — see INFO lines above)`)
  process.exit(0)
}
console.log('all passed')
