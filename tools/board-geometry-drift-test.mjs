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

/** Every number written as a literal in that code, as JS numbers. */
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
      if (Number.isFinite(value)) found.push(value)
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

/** file:line for every code literal equal to `target`. */
const literalHits = (text, target) => {
  const hits = []
  text.split('\n').forEach((line, index) => {
    if (numberLiterals(codeOnly(line)).some((value) => value === target)) hits.push({ line: index + 1, text: line.trim() })
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

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
console.log('all passed')
