#!/usr/bin/env node
/**
 * One source for the board's block size, and nothing in the viewer allowed to
 * retype it.
 *
 * `src/lib/isometric-board-layout.mjs` states the geometry once:
 * CELL_PITCH_METRES is how far apart two rooms sit, CELL_GAP_METRES is the
 * gutter left between their blocks, and CELL_BLOCK_METRES is stated as the
 * relation between them rather than as a third number that happens to agree.
 * Every cell in every manifest carries the result as `board.footprint`, and the
 * Godot viewer draws what the cell published.
 *
 * `godot/scripts/content_registry.gd` used to hold
 * `const FALLBACK_BLOCK_METRES := 4.4` - the same dimension typed a fourth
 * time, tied to its source by nothing but the fact that 5 - 0.6 is 4.4 today.
 * Nothing could see it: the two agreed, so no capture of the board could
 * differ, and the mock fixture stripped `board` from all 19 cells so the
 * fallback was the only path the checked-in world ever took (issue #345).
 *
 * That combination - a copy that is correct, on a path that is the only one
 * exercised - is invisible to every other check in this repository. So this is
 * the check that watches for it coming back:
 *
 *   1. CELL_BLOCK_METRES is derived, both in value and in how it is written.
 *   2. No GDScript under godot/ carries that number as a code literal. Prose
 *      about it is fine and is what the comments in content_registry.gd are;
 *      a number the engine can read is not.
 *   3. No script under godot/scripts carries CELL_PITCH_METRES as a float
 *      literal either.
 *
 * The third was added for issue #362, which found the same defect one file over
 * and invisible to the first two. `shared_asset_content.gd` drew every terrain,
 * floor and water plane as `5.0 x 5.0` and discarded its cell argument: 5 is the
 * *pitch*, so the largest surface a player looks at was sized at the distance
 * between two rooms rather than at the block, and two rooms at the minimum pitch
 * had ground that met exactly - the state CELL_GAP_METRES exists to prevent. A
 * scan for 4.4 cannot see a 5, which is why "the block has one source" was true
 * and the board still had no gutter under it.
 *
 * The complementary half - that every cell actually publishes a footprint, so
 * the viewer never has to fall back at all - is
 * `tools/godot-fixture-contract-test.mjs`. Neither substitutes for the other:
 * this one would still pass against a fixture with no boards in it, and that
 * one would still pass with a stray constant sitting unused in a .gd file.
 *
 * Run: node tools/board-geometry-drift-test.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CELL_BLOCK_METRES, CELL_GAP_METRES, CELL_PITCH_METRES } from '../src/lib/isometric-board-layout.mjs'

const LAYOUT_SOURCE = 'src/lib/isometric-board-layout.mjs'
const GODOT_ROOT = 'godot'

/**
 * The pitch is scanned across the viewer's own scripts rather than all of
 * `godot/`, because a test fixture may legitimately place a probe room 5 metres
 * from another one - that is what a board at the minimum pitch is - while no
 * production script has any business writing the number down at all.
 */
const GODOT_SCRIPTS = 'godot/scripts'

/** 13 exist. Same reasoning as the floor below it. */
const MINIMUM_SCRIPT_FILES = 8

/** 27 exist. Far enough below that adding or removing a script never touches
 * it, high enough that a walk which found nothing cannot clear it - the number
 * that goes to zero when the directory walk breaks, rather than when the
 * repository is clean. */
const MINIMUM_GD_FILES = 15

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
 * The code half of one GDScript line: string literals blanked, then everything
 * from the first surviving `#` dropped.
 *
 * Blanking strings first is not tidiness. `Color("#58724b")` in
 * shared_asset_content.gd puts a `#` inside a string on a line that also
 * carries real numbers, so cutting at the first `#` would hide them and the
 * scan would report clean because it had stopped reading.
 */
const codeOnly = (line) => {
  let out = ''
  let quote = ''
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#') break
    out += ch
  }
  return out
}

/**
 * Every number written as a literal in that code, as `{ value, raw }`.
 *
 * `raw` is kept because the pitch check below has to tell `5.0` from `5`, and
 * their values are the same number.
 */
const numberLiterals = (code) => {
  const digits = '0123456789.'
  const found = []
  let run = ''
  for (const ch of `${code} `) {
    if (digits.includes(ch)) {
      run += ch
      continue
    }
    if (run) {
      const value = Number.parseFloat(run)
      if (Number.isFinite(value)) found.push({ value, raw: run })
      run = ''
    }
  }
  return found
}

const gdFiles = (dir) => {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...gdFiles(full))
    else if (entry.endsWith('.gd')) out.push(full)
  }
  return out
}

/**
 * file:line for every code literal equal to `target`.
 *
 * With `decimalOnly`, only a literal written with a decimal point counts - `5.0`
 * but not `5`. That distinction is what makes the pitch check below usable at
 * all: 4.4 is a number nothing in this viewer means by accident, while 5 is a
 * retry limit (`MAX_RECONNECT_ATTEMPTS: int = 5`), a roundtime, a sequence
 * number and a fixture coordinate. A metre is written as a float in this
 * codebase and a count is not, so the decimal point separates a board dimension
 * from every one of those.
 *
 * The limit of that, stated rather than left to be discovered: a pitch typed as
 * a bare `5` in a Vector2 would not be caught. It buys a check that can run at
 * all in exchange for a hole that the Godot tests - which measure the drawn
 * mesh, not the source - are the cover for.
 */
const literalHits = (text, target, { decimalOnly = false } = {}) => {
  const hits = []
  text.split('\n').forEach((line, index) => {
    const matched = numberLiterals(codeOnly(line)).some(
      ({ value, raw }) => value === target && (!decimalOnly || raw.includes('.')),
    )
    if (matched) hits.push({ line: index + 1, text: line.trim() })
  })
  return hits
}

// -- the scanner itself, before it is trusted to say anything about the repo --
// A clean report and a scanner that reads nothing are the same output.
ok(
  'the scanner sees a block size written as code',
  literalHits(`const FALLBACK_BLOCK_METRES := ${CELL_BLOCK_METRES}`, CELL_BLOCK_METRES).length === 1,
  'positive control',
)
ok(
  'the scanner sees one written inside a Color() string, past a #',
  literalHits(`var x := _piece(Color("#58724b"), ${CELL_BLOCK_METRES})`, CELL_BLOCK_METRES).length === 1,
  'positive control: strings are blanked, not cut at',
)
ok(
  'the scanner does not see one in a comment',
  literalHits(`# it used to be ${CELL_BLOCK_METRES} metres here`, CELL_BLOCK_METRES).length === 0,
  'negative control',
)
ok(
  'the scanner does not see one inside a string',
  literalHits(`push_error("was ${CELL_BLOCK_METRES}")`, CELL_BLOCK_METRES).length === 0,
  'negative control',
)
ok(
  'the scanner sees a pitch written as a float',
  literalHits(`plane.size = Vector2(${CELL_PITCH_METRES.toFixed(1)}, ${CELL_PITCH_METRES.toFixed(1)})`, CELL_PITCH_METRES, { decimalOnly: true }).length === 1,
  'positive control: this is the line issue #362 was filed about',
)
ok(
  'and does not mistake a count for one',
  literalHits(`const MAX_RECONNECT_ATTEMPTS: int = ${CELL_PITCH_METRES}`, CELL_PITCH_METRES, { decimalOnly: true }).length === 0,
  'negative control: bridge_client.gd really does have this line',
)

// -- one source --
ok('the block is the pitch less the gutter, in value', CELL_BLOCK_METRES === CELL_PITCH_METRES - CELL_GAP_METRES, `${CELL_PITCH_METRES} - ${CELL_GAP_METRES} = ${CELL_BLOCK_METRES}`)

const layout = readFileSync(LAYOUT_SOURCE, 'utf8')
ok(
  'and in how it is written, so it cannot silently become a third number',
  /CELL_BLOCK_METRES\s*=\s*CELL_PITCH_METRES\s*-\s*CELL_GAP_METRES/.test(layout),
  `${LAYOUT_SOURCE}`,
)

// -- and no second copy in the viewer --
const files = gdFiles(GODOT_ROOT)
ok('the GDScript walk found scripts to scan', files.length >= MINIMUM_GD_FILES, `${files.length} .gd files, floor ${MINIMUM_GD_FILES}`)

const offenders = []
for (const file of files) {
  for (const hit of literalHits(readFileSync(file, 'utf8'), CELL_BLOCK_METRES)) {
    offenders.push(`${file}:${hit.line}  ${hit.text}`)
  }
}
ok(
  `no GDScript retypes the ${CELL_BLOCK_METRES} m block; it comes from the cell`,
  offenders.length === 0,
  offenders[0] ?? `${files.length} files scanned`,
)
for (const offender of offenders.slice(1)) console.log(`     also ${offender}`)

// -- and the pitch is not typed into the viewer either --
// `shared_asset_content.gd` drew terrain, floors and water as `5.0 x 5.0`
// planes with the cell argument discarded, so the largest surface on the board
// was sized at the *pitch* - how far apart two rooms sit - rather than at the
// block, and the gutter CELL_GAP_METRES exists to create did not exist for the
// ground (issue #362). The check above could not see it: it looks for 4.4, and
// this was 5.
const scriptFiles = gdFiles(GODOT_SCRIPTS)
ok('the viewer-script walk found scripts to scan', scriptFiles.length >= MINIMUM_SCRIPT_FILES, `${scriptFiles.length} .gd files, floor ${MINIMUM_SCRIPT_FILES}`)

const pitchOffenders = []
for (const file of scriptFiles) {
  for (const hit of literalHits(readFileSync(file, 'utf8'), CELL_PITCH_METRES, { decimalOnly: true })) {
    pitchOffenders.push(`${file}:${hit.line}  ${hit.text}`)
  }
}
ok(
  `no viewer script retypes the ${CELL_PITCH_METRES} m pitch; a cell's ground is its own block`,
  pitchOffenders.length === 0,
  pitchOffenders[0] ?? `${scriptFiles.length} scripts scanned`,
)
for (const offender of pitchOffenders.slice(1)) console.log(`     also ${offender}`)

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
console.log('all passed')
