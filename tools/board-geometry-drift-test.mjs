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
 *   3. No script under godot/scripts carries any board dimension, or any of the
 *      near-misses derivable from one, as a float literal.
 *
 * The third began for issue #362 as a scan for CELL_PITCH_METRES alone.
 * `shared_asset_content.gd` drew every terrain, floor and water plane as
 * `5.0 x 5.0` and discarded its cell argument: 5 is the *pitch*, so the largest
 * surface a player looks at was sized at the distance between two rooms rather
 * than at the block, and two rooms at the minimum pitch had ground that met
 * exactly - the state CELL_GAP_METRES exists to prevent. A scan for 4.4 cannot
 * see a 5, which is why "the block has one source" was true and the board still
 * had no gutter under it.
 *
 * # And then a number that was neither
 *
 * Issue #366 found the last one, and it defeated both scans by being *nearly*
 * right. `world_root.gd` sized every cell's click target at a hand-typed
 * `Vector3(4.5, 1.0, 4.5)` while the manifest published
 * `board.selectionBounds` on all 19 cells. 4.5 is not the block and not the
 * pitch, so neither scan could see it; it is 4.4 rounded to a tidy number,
 * which is how a dimension gets typed by hand in the first place.
 *
 * So the third scan is by the class rather than by the instance. It derives the
 * refused set from `boardLayoutFor()` itself - the width and depth of every box
 * a cell publishes (`footprint`, `ground`, `selectionBounds`, for an ordinary
 * room and for an interior cutaway) - and then closes it over the ways a
 * hand-typed copy misses: plus or minus the gutter, plus or minus half of it,
 * half the dimension itself, and the nearest tidy half-metre to any of those.
 * Nothing in it is written down here; change CELL_GAP_METRES and the set moves.
 *
 * Two scope limits, stated rather than left to be discovered:
 *
 *   - Heights are deliberately out. The manifest publishes 1 and 3, and those
 *     are also a clamp bound, a colour channel and the deliberately implausible
 *     1 m marker cube. A value scan cannot tell those apart from a dimension,
 *     and a check that fires on all of them would be ignored. The height half
 *     is covered where it can be measured instead: `godot/tests/cell_click_
 *     target_test.gd` raycasts a real click onto a real cell and reads back the
 *     height it landed at.
 *   - The scan covers `godot/scripts` only. A fixture under `godot/tests` may
 *     legitimately name a superseded number in order to prove the wrong answer
 *     was reachable, which is the opposite of a viewer typing it.
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
import { CELL_BLOCK_METRES, CELL_GAP_METRES, CELL_PITCH_METRES, boardLayoutFor } from '../src/lib/isometric-board-layout.mjs'

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

/** 12 are derived today. The number that goes to zero when the derivation
 * below breaks, rather than when the viewer is clean. */
const MINIMUM_REFUSED_VALUES = 8

/**
 * What `world_root.gd` sized every cell's click target at until issue #366.
 *
 * Written down once, here, as the positive control on the derivation: this file
 * is the check, so a value it must refuse is the thing to name. The point of
 * deriving the set is that nobody had to know this number for it to be caught -
 * 4.5 is in the set because it is 4.4 rounded, not because it is written on
 * this line.
 */
const SUPERSEDED_CLICK_BOX_METRES = 4.5

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
/**
 * A run of digits is only a number when nothing identifier-like runs into it.
 * `Vector3.ZERO` otherwise reads as the literal 3.0 - digits, a point, and the
 * scan has no way to know the 3 belongs to a type name. That did not matter
 * while the only targets were 4.4 and 5; it does now that the refused set below
 * is derived and can grow.
 */
const IDENTIFIER = /[A-Za-z0-9_]/

const numberLiterals = (code) => {
  const digits = '0123456789.'
  const found = []
  let run = ''
  let attached = false
  let previous = ' '
  for (const ch of `${code} `) {
    if (digits.includes(ch)) {
      if (!run) attached = IDENTIFIER.test(previous)
      run += ch
      previous = ch
      continue
    }
    if (run) {
      const value = Number.parseFloat(run)
      if (Number.isFinite(value) && !attached) found.push({ value, raw: run })
      run = ''
    }
    previous = ch
  }
  return found
}

/** Two decimal places is the whole of this board's precision, and it is what
 * keeps 4.4 - 0.3 from arriving as 4.100000000000001 and matching nothing. */
const metres = (value) => Number(value.toFixed(2))

/**
 * Every board dimension a cell can publish, as a horizontal extent in metres.
 *
 * Read out of `boardLayoutFor()` for both cell kinds rather than named here, so
 * a box added to the layout is scanned for without this file being touched.
 */
const publishedDimensions = () => {
  const layouts = [boardLayoutFor({}), boardLayoutFor({ classification: { spatialMode: 'interior-cutaway' } })]
  const found = new Set()
  for (const layout of layouts) {
    for (const box of Object.values(layout)) {
      if (!box || typeof box !== 'object' || Array.isArray(box)) continue
      for (const field of ['width', 'depth']) {
        if (Number.isFinite(box[field])) found.add(metres(box[field]))
      }
    }
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * The refused set: each published dimension, the ways a hand-typed copy of one
 * lands beside it, and why - so an offender is reported with the derivation
 * that condemns it rather than as a bare number.
 */
const refusedDimensions = () => {
  const refused = new Map()
  const add = (value, why) => {
    const key = metres(value)
    if (key > 0 && !refused.has(key)) refused.set(key, why)
  }
  const published = publishedDimensions()

  // Exact, and one gutter (or half of one) either side of exact: the two
  // mistakes that produced #345 and #362 respectively.
  const exact = []
  for (const d of published) {
    exact.push([d, `${d} m, published by boardLayoutFor()`])
    for (const delta of [CELL_GAP_METRES, CELL_GAP_METRES / 2]) {
      exact.push([metres(d + delta), `${d} + ${delta} m`], [metres(d - delta), `${d} - ${delta} m`])
    }
  }
  for (const [value, why] of exact) add(value, why)

  // The tidy neighbour: 4.4 typed by hand as 4.5, which is #366 exactly.
  // Applied to the values above and not to the halves below, because half a
  // dimension rounded is two steps from anything the manifest says and lands on
  // ordinary counts (2.0 is `const LIVE_RETRY_SECONDS := 2.0`).
  for (const [value] of exact) add(Math.round(value * 2) / 2, `the nearest tidy half-metre to ${value}`)

  // And half of one, which is what a box written as a half-extent looks like.
  for (const d of published) add(d / 2, `half of the published ${d} m`)

  return refused
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
  const wanted = target instanceof Map ? target : new Map([[metres(target), `${target} m`]])
  const hits = []
  text.split('\n').forEach((line, index) => {
    const matched = numberLiterals(codeOnly(line)).find(
      ({ value, raw }) => wanted.has(metres(value)) && (!decimalOnly || raw.includes('.')),
    )
    if (matched) hits.push({ line: index + 1, text: line.trim(), value: metres(matched.value), why: wanted.get(metres(matched.value)) })
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
ok(
  'and does not read a type name as a number',
  literalHits('var center := Vector3.ZERO', 3).length === 0,
  'negative control: world_root.gd really does have this line, and it is not a 3.0',
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

// -- and no board dimension, or near-miss of one, is typed into the viewer --
// Three have been found this way and each defeated the check written for the
// last: 4.4 the block (#345), 5.0 the pitch drawn as ground (#362), and 4.5 -
// neither of those, 4.4 rounded to a tidy number, sizing every cell's click
// target while `board.selectionBounds` sat unread on all 19 cells (#366). So
// the set is derived rather than listed, and it covers the near-misses.
const REFUSED = refusedDimensions()

// The set before it is trusted to condemn anything. A derivation that produced
// an empty or tiny map would clear every script below and read as a clean tree.
ok(
  'the refused set is derived from the layout module, not listed here',
  REFUSED.size >= MINIMUM_REFUSED_VALUES,
  `${REFUSED.size} values, floor ${MINIMUM_REFUSED_VALUES}: ${[...REFUSED.keys()].sort((a, b) => a - b).join(', ')}`,
)
ok(
  'and it contains the two dimensions already known to have been retyped',
  REFUSED.has(metres(CELL_BLOCK_METRES)) && REFUSED.has(metres(CELL_PITCH_METRES)),
  `positive control: ${CELL_BLOCK_METRES} (#345) and ${CELL_PITCH_METRES} (#362)`,
)
ok(
  'and the near-miss that defeated both of those checks',
  REFUSED.has(SUPERSEDED_CLICK_BOX_METRES),
  `positive control: ${SUPERSEDED_CLICK_BOX_METRES} is ${REFUSED.get(SUPERSEDED_CLICK_BOX_METRES) ?? 'NOT in the set'}`,
)
ok(
  'and it still does not contain the ordinary scalars a viewer script means',
  ![2, 2.4, 1.5, 1.0, 0.6].some((value) => REFUSED.has(metres(value))),
  'negative control: LIVE_RETRY_SECONDS 2.0, an exit offset 2.4, a range 1.5, the marker cube 1.0, TRANSITION_SECONDS 0.6',
)

const scriptFiles = gdFiles(GODOT_SCRIPTS)
ok('the viewer-script walk found scripts to scan', scriptFiles.length >= MINIMUM_SCRIPT_FILES, `${scriptFiles.length} .gd files, floor ${MINIMUM_SCRIPT_FILES}`)

const dimensionOffenders = []
for (const file of scriptFiles) {
  for (const hit of literalHits(readFileSync(file, 'utf8'), REFUSED, { decimalOnly: true })) {
    dimensionOffenders.push(`${file}:${hit.line}  ${hit.text}   <- ${hit.value} is ${hit.why}`)
  }
}
ok(
  `no viewer script types a board dimension; a cell's geometry comes from the cell`,
  dimensionOffenders.length === 0,
  dimensionOffenders[0] ?? `${scriptFiles.length} scripts scanned against ${REFUSED.size} refused values`,
)
for (const offender of dimensionOffenders.slice(1)) console.log(`     also ${offender}`)

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
console.log('all passed')
