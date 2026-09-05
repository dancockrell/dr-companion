#!/usr/bin/env node
/**
 * No GDScript may read a documented-nullable presentation field into a String.
 *
 *   node tools/nullable-field-coercion-test.mjs
 *
 * # The class, not the instance
 *
 * Issue #376 was one line, and then it was two. `cell_visibility_policy.gd`
 * had `var target_id := String(exit.get("targetCellId", ""))` and
 * `bridge_client.gd` had `var target_id: String = exit.get("targetCellId", "")`.
 * Different spellings of one mistake: `targetCellId` is `string | null` in
 * `src/lib/presentationTypes.ts`, a null is the manifest's documented way of
 * saying the exit leaves the loaded subset, and neither `String(<Nil>)` nor an
 * assignment to a typed `String` will take one. Both raise, and a GDScript
 * raise abandons the running function - so the first emptied the entire board
 * and the second made a rejection two lines below it unreachable.
 *
 * The two were found in the same pass by reading. Nothing would have found a
 * third. This is what finds the third: the refused set is *derived from the
 * type declarations*, so a field that becomes nullable tomorrow is covered
 * without this file being touched, and a hand-kept list cannot fall behind the
 * contract it is supposed to describe.
 *
 * # What is refused, and what is not
 *
 * Refused, on a nullable field:
 *
 *   - `String(<anything>.get("field"...`      - no String constructor takes Nil
 *   - `: String = <anything>.get("field"...`  - Nil will not assign to a String
 *
 * Not refused, because these are the correct forms and the viewer already uses
 * them in a dozen places:
 *
 *   - `str(x.get("field", ""))`      - `str()` tolerates a null, giving "<null>"
 *   - `x.get("field") is String`     - the type test, which is what both fixes use
 *   - `var v = x.get("field")`       - untyped, so nothing coerces
 *
 * # Scope limits, stated rather than left to be discovered
 *
 *   - It is a *source* scan, so it sees the shape and not the value. A field
 *     read through a variable two lines earlier, or through a helper, is
 *     invisible to it. The cover for that is the Godot tests, which walk every
 *     null-targeted exit in the checked-in world and measure what comes back:
 *     `godot/tests/bridge_client_null_target_test.gd` and
 *     `godot/tests/cell_detail_window_test.gd`.
 *   - The refused field list is derived by *name*, and a name can appear in
 *     more than one interface - `position` is `Vec3` on a `WorldCell` and
 *     `number | null` on a player. That makes the scan slightly broader than
 *     the contract. It is the safe direction: a line it fires on is still a
 *     bare `String()` around a `.get()` of a field that is nullable somewhere
 *     in the same protocol, which is worth a type test either way.
 *   - A git submodule under `godot/` is another repository's code and is not
 *     scanned; that exclusion, and the `.gd` walk, come from
 *     `tools/godot-source-scan.mjs`.
 */
import { readFileSync } from 'node:fs'
import { sep as SEPARATOR } from 'node:path'
import { gdFiles as gdFilesIn, stripComment, submodulePaths } from './godot-source-scan.mjs'

const TYPES_SOURCE = 'src/lib/presentationTypes.ts'
const GODOT_ROOT = 'godot'

/** 12 are declared today. Far enough below that adding or removing one never
 * touches this, high enough that a parser which stopped matching reports itself
 * instead of certifying an empty refused set - the number that goes to zero
 * when the derivation breaks, rather than when the viewer is clean. */
const MINIMUM_NULLABLE_FIELDS = 7

/** 30 of ours exist. Same reasoning; see board-geometry-drift-test.mjs. */
const MINIMUM_GD_FILES = 15

/**
 * The two fields issue #376 was about, named here once as the positive control
 * on the derivation. The point of deriving the set is that nobody had to know
 * these for them to be in it.
 */
const KNOWN_NULLABLE = ['targetCellId', 'targetRoomId']

/** A field that is emphatically not nullable, so a derivation that returned
 * "every field" would be caught rather than read as thorough. */
const KNOWN_NON_NULLABLE = 'move'

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass += 1
    console.log(`OK   ${what.padEnd(70)} ${detail}`)
  } else {
    fail += 1
    console.log(`FAIL ${what.padEnd(70)} ${detail}`)
  }
}

/**
 * Every field name declared `| null` in `presentationTypes.ts`.
 *
 * Comments are stripped first, both kinds: the doc comments in that file
 * discuss nullability in prose ("null = never assessed"), and a scan that read
 * them would harvest words rather than fields.
 */
const nullableFields = (text) => {
  const found = new Set()
  let inBlockComment = false
  for (const raw of text.split('\n')) {
    let line = raw
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end === -1) continue
      inBlockComment = false
      line = line.slice(end + 2)
    }
    const start = line.indexOf('/*')
    if (start !== -1) {
      if (line.indexOf('*/', start) === -1) inBlockComment = true
      line = line.slice(0, start)
    }
    line = line.replace(/\/\/.*$/, '')

    const declaration = /^\s*(?:readonly\s+)?([A-Za-z_]\w*)\??\s*:\s*(.+?);?\s*$/.exec(line)
    if (!declaration) continue
    if (/(^|\|)\s*null\s*(\||$)/.test(declaration[2])) found.add(declaration[1])
  }
  return found
}

const FIELDS = nullableFields(readFileSync(TYPES_SOURCE, 'utf8'))

/**
 * `file:line` for every String coercion of one of `fields` in `text`.
 *
 * The receiver is `[\w.]+` rather than a fixed name, because the offending call
 * is `exit.get(...)` in one file and could be `cell.data.get(...)` in the next.
 */
const coercions = (text, fields) => {
  const hits = []
  text.split('\n').forEach((rawLine, index) => {
    const code = stripComment(rawLine)
    const patterns = [
      { re: /(?<![A-Za-z0-9_])String\(\s*[A-Za-z_][\w.]*\.get\(\s*["']([\w]+)["']/g, why: 'String() has no constructor taking Nil' },
      { re: /:\s*String\s*=\s*[A-Za-z_][\w.]*\.get\(\s*["']([\w]+)["']/g, why: 'Nil will not assign to a typed String' },
    ]
    for (const { re, why } of patterns) {
      for (const match of code.matchAll(re)) {
        if (fields.has(match[1])) hits.push({ line: index + 1, text: rawLine.trim(), field: match[1], why })
      }
    }
  })
  return hits
}

// -- the derivation, before it is trusted to condemn anything --
ok(
  `the refused field set is derived from ${TYPES_SOURCE}, not listed here`,
  FIELDS.size >= MINIMUM_NULLABLE_FIELDS,
  `${FIELDS.size} fields, floor ${MINIMUM_NULLABLE_FIELDS}: ${[...FIELDS].sort().join(', ')}`,
)
ok(
  'and it contains the two fields issue #376 was actually about',
  KNOWN_NULLABLE.every((field) => FIELDS.has(field)),
  `positive control: ${KNOWN_NULLABLE.map((f) => `${f}${FIELDS.has(f) ? '' : ' MISSING'}`).join(', ')}`,
)
ok(
  'and it does not simply contain every field it saw',
  !FIELDS.has(KNOWN_NON_NULLABLE),
  `negative control: WorldExit.${KNOWN_NON_NULLABLE} is a plain string and must not be in the set`,
)
// The parser against a fixture where the wrong answer is available: one real
// nullable field, one that is not, and a doc comment that says "null" in prose
// twice. That file really does carry lines like "null = never assessed", and a
// parser reading them would harvest words rather than fields.
const FIXTURE = [
  'export interface Probe {',
  '  /** Seconds since the last assess enriched this entry; null = never',
  '   * assessed, which is not the same as zero. */',
  '  probeAge: number | null',
  '  // probeGhost: string | null  <- commented out, and not a declaration',
  '  probeName: string',
  '}',
].join('\n')
const parsedFixture = nullableFields(FIXTURE)
ok(
  'and the parser reads declarations rather than prose about null',
  parsedFixture.size === 1 && parsedFixture.has('probeAge'),
  `control: expected {probeAge}, got {${[...parsedFixture].join(', ')}}`,
)

// -- the scanner, before it is trusted to report a clean tree --
ok(
  'the scanner sees the constructor form',
  coercions('\tvar target_id := String(exit.get("targetCellId", ""))', FIELDS).length === 1,
  'positive control: cell_visibility_policy.gd:29 as issue #376 found it',
)
ok(
  'and the typed-assignment form',
  coercions('\tvar target_id: String = exit.get("targetCellId", "")', FIELDS).length === 1,
  'positive control: bridge_client.gd:211 as issue #376 found it',
)
ok(
  'and one reached through a nested receiver',
  coercions('\tvar id: String = snapshot.activeRoom.get("targetRoomId")', FIELDS).length === 1,
  'positive control: the receiver is not always a bare local',
)
ok(
  'and does not see str(), which tolerates a null',
  coercions('\tvar target_id := str(exit.get("targetCellId", ""))', FIELDS).length === 0,
  'negative control: this is what every other reader of that field already does',
)
ok(
  'nor the type test both #376 fixes use',
  coercions('\tvar target_id: String = target_value if target_value is String else ""', FIELDS).length === 0,
  'negative control: bridge_client.gd as it stands today',
)
ok(
  'nor an untyped read',
  coercions('\tvar target_value = exit.get("targetCellId")', FIELDS).length === 0,
  'negative control: nothing coerces, so nothing can raise',
)
ok(
  'nor the same coercion on a field the contract does not call nullable',
  coercions(`\tvar move: String = exit.get("${KNOWN_NON_NULLABLE}", "")`, FIELDS).length === 0,
  `negative control: WorldExit.${KNOWN_NON_NULLABLE} is never null, and this line is correct`,
)
ok(
  'nor one written in a comment',
  coercions('\t# it used to be String(exit.get("targetCellId", "")) here', FIELDS).length === 0,
  'negative control: prose about the defect is how it gets documented',
)
ok(
  'nor a name that merely ends in one',
  coercions('\tvar s: String = exit.get("myTargetCellId", "")', FIELDS).length === 0,
  'negative control: the field name is matched whole',
)

// -- and now the tree --
const MODULE_PATHS = submodulePaths()
ok(
  'the submodule exclusion was read from .gitmodules',
  MODULE_PATHS.size >= 1,
  MODULE_PATHS.size ? [...MODULE_PATHS].join(', ') : 'no `path =` line parsed - the exclusion would exclude nothing',
)

const files = gdFilesIn(GODOT_ROOT, MODULE_PATHS)
ok('the GDScript walk found scripts to scan', files.length >= MINIMUM_GD_FILES, `${files.length} .gd files, floor ${MINIMUM_GD_FILES}`)

const offenders = []
for (const file of files) {
  for (const hit of coercions(readFileSync(file, 'utf8'), FIELDS)) {
    offenders.push(`${file.split(SEPARATOR).join('/')}:${hit.line}  ${hit.text}   <- ${hit.field} is nullable; ${hit.why}`)
  }
}
ok(
  'no GDScript reads a documented-nullable field into a String',
  offenders.length === 0,
  offenders[0] ?? `${files.length} scripts scanned against ${FIELDS.size} nullable fields`,
)
for (const offender of offenders.slice(1)) console.log(`     also ${offender}`)

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
console.log('all passed')
