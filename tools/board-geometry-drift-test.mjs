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
 * Three scope limits, stated rather than left to be discovered:
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
 *   - A git submodule under `godot/` is another repository's code and is not
 *     scanned. `godot/shared-assets` is a checkout of
 *     `project-42-pirate-island-rpg`, whose setpiece scripts place props by
 *     hand: two coordinates in `reception_terrace_component.gd` happen to be
 *     4.4, and neither is a board dimension. Scanning them made this suite fail
 *     on any worktree that follows docs/PLAN_TO_1_0.md §0.4 - which runs
 *     `git submodule update --init` - while passing in CI, where
 *     `actions/checkout` leaves `submodules:` unset and the directory is empty.
 *     A check whose verdict depends on whether a submodule happens to be
 *     initialised is not a check about this repository.
 *
 *     The exclusion is read from `.gitmodules` rather than written here, so a
 *     second submodule is covered without this file being touched, and the two
 *     denominators below are what stop it becoming a way to see nothing: the
 *     submodule holds 32 of the 62 `.gd` files present when it is initialised,
 *     and the floors are set against the 30 that are ours.
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
import { join, sep as SEPARATOR } from 'node:path'
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

/** 30 of ours exist (62 with `godot/shared-assets` initialised, which is not
 * scanned - see the header). Far enough below that adding or removing a script
 * never touches it, high enough that a walk which found nothing cannot clear it
 * - the number that goes to zero when the directory walk breaks, or when the
 * submodule exclusion below starts excluding more than a submodule, rather than
 * when the repository is clean. */
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

/**
 * The repository-relative path of every git submodule, read out of
 * `.gitmodules`.
 *
 * Derived rather than listed so a second submodule is excluded without this
 * file being touched, and returned as a Set of forward-slash paths because that
 * is how `.gitmodules` spells them on every platform. `MODULE_PATHS.size` is
 * asserted below: an empty result would silently put the exclusion back to
 * scanning everything, which is the state this replaced.
 */
const submodulePaths = () => {
  const found = new Set()
  let text = ''
  try {
    text = readFileSync('.gitmodules', 'utf8')
  } catch {
    return found
  }
  for (const line of text.split('\n')) {
    const match = /^\s*path\s*=\s*(.+?)\s*$/.exec(line)
    if (match) found.add(match[1].split(SEPARATOR).join('/'))
  }
  return found
}

const MODULE_PATHS = submodulePaths()

/**
 * Every `.gd` file under `dir` that belongs to this repository.
 *
 * A directory named by `.gitmodules` is another repository's checkout and is
 * skipped whole, initialised or not. See the header for why: one of them places
 * props at coordinates that collide with a board dimension, and whether it has
 * been cloned is not a fact about this viewer.
 */
const gdFiles = (dir) => {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const relative = full.split(SEPARATOR).join('/')
    if (MODULE_PATHS.has(relative)) continue
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
//
// The exclusion before the walk that uses it. An empty `.gitmodules` parse
// would put this suite back to scanning another repository's setpieces, and it
// would do it silently, so the number that has to be non-zero is asserted
// rather than assumed.
ok(
  'the submodule exclusion was read from .gitmodules',
  MODULE_PATHS.size >= 1,
  MODULE_PATHS.size ? [...MODULE_PATHS].join(', ') : 'no `path =` line parsed - the exclusion would exclude nothing',
)
ok(
  'and it excludes a directory that really is one',
  [...MODULE_PATHS].some((p) => p.startsWith(`${GODOT_ROOT}/`)),
  `positive control: a submodule under ${GODOT_ROOT}/ is what this scan would otherwise walk into`,
)
ok(
  'and it does not swallow the viewer’s own scripts',
  !MODULE_PATHS.has(GODOT_SCRIPTS) && !MODULE_PATHS.has(GODOT_ROOT),
  `negative control: ${GODOT_SCRIPTS} and ${GODOT_ROOT} are ours`,
)

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

// -- and no hand-typed height in a script that places something on a block --
//
// The value scan above cannot do heights and says so in the header: the
// manifest publishes 1 and 3, which are also a clamp bound, a colour channel
// and the marker cube, so a scan that refused them would fire on all of those
// and be ignored. Issue #373 is what that hole cost.
// `entity_projection_layer.gd` placed every token with `0.4`, `0.4` and
// `-0.32`, correct against the 0.3 m placeholder slab they were written for;
// once #365 gave the placeholder the cell's own footprint, 117 of the 133
// anchors in the checked-in world sat below the top of the block they stood on,
// and on the three interior cutaways every token was more than a metre inside
// it. Nothing here could see that, and `cell_click_target_test.gd` - named in
// the header as the cover for the height half - raycasts a click box, not a
// token.
//
// So heights are scanned by *shape* rather than by value, which is what makes
// scanning them possible at all. In a script that places something on a block a
// height is never a bare number: it is the cell's, through
// `ContentRegistry.block_top_y()`, plus a named constant that says what the
// offset is for. `MARKER_THICKNESS_METRES` in the exit layer and
// `BAND_CLEARANCE_METRES` in the token layer are that, and neither is a board
// dimension.
//
// Two scope limits, stated rather than left to be discovered:
//
//   - It refuses a *literal*, so `const FOO := 0.4` used as a lift passes here.
//     The cover for that is `godot/tests/entity_projection_test.gd`, which
//     stands a token on a 0.3 m block and on a 3 m one and measures both: one
//     typed height, named or not, can satisfy exactly one of them.
//   - The middle argument of every `Vector3(` in these files is examined,
//     including the ones that are sizes rather than positions. A mesh's own
//     height is the same kind of claim, and both files already name it.
//
// The scanned set is derived rather than listed: every viewer script that
// mentions `block_top_y(`, which is the two layers that place things on a block
// plus the registry that answers them. A third layer added tomorrow is covered
// by asking the question, which is the only way it could place anything right.
const PLACEMENT_MARKER = 'block_top_y('

/** 3 today: the two placement layers and the registry that defines the
 * accessor. The number that goes to zero when the derivation stops finding
 * files, rather than when the viewer is clean. */
const MINIMUM_PLACEMENT_SCRIPTS = 2

/** Top-level commas only, so `Vector3(max(a, b), 0.4, c)` still yields three
 * arguments rather than four. */
const splitArguments = (inner) => {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of inner) {
    if (ch === '(' || ch === '[') depth += 1
    if (ch === ')' || ch === ']') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

/**
 * A whole argument that is nothing but a number, and not zero.
 *
 * Zero is allowed on purpose: "no lift at all" is the honest answer for a thing
 * the board did not place, and it is what `UNPLACED_TOKEN_LIFT_METRES` is.
 */
const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/
const isTypedHeight = (argument) => {
  const text = argument.trim()
  return BARE_NUMBER.test(text) && Number.parseFloat(text) !== 0
}

/**
 * Every hand-typed height in one script's code: the y of a `Vector3(...)`, and
 * the right-hand side of a `.position.y =`.
 */
const typedHeights = (text) => {
  const hits = []
  text.split('\n').forEach((line, index) => {
    const code = codeOnly(line)
    const report = (value, what) => hits.push({ line: index + 1, text: line.trim(), value, what })

    const assigned = /\.position\.y\s*=\s*(.+)$/.exec(code)
    if (assigned && isTypedHeight(assigned[1])) report(assigned[1].trim(), 'assigned straight to position.y')

    let at = code.indexOf('Vector3(')
    while (at !== -1) {
      let depth = 0
      let end = at + 'Vector3'.length
      for (; end < code.length; end += 1) {
        if (code[end] === '(') depth += 1
        else if (code[end] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      const args = splitArguments(code.slice(at + 'Vector3('.length, end))
      if (args.length === 3 && isTypedHeight(args[1])) report(args[1].trim(), 'the y of a Vector3')
      at = code.indexOf('Vector3(', end)
    }
  })
  return hits
}

// The shape scanner before it is trusted to say anything, same as the value one
// above: both halves shown firing on the lines issue #373 was filed about, and
// shown not firing on the lines that are correct today.
ok(
  'the height scanner sees a token height typed into a Vector3',
  typedHeights('\treturn Vector3(cos(angle) * distance, 0.4, sin(angle) * distance)').length === 1,
  'positive control: entity_projection_layer.gd:284 as issue #373 found it',
)
ok(
  'and one assigned straight to position.y',
  typedHeights('\tring.position.y = -0.39').length === 1,
  'positive control',
)
ok(
  'and does not see a height derived from the cell',
  typedHeights('\tmarker.position.y = block_top + MARKER_THICKNESS_METRES * 0.5 + MARKER_CLEARANCE_METRES').length === 0,
  'negative control: exit_anchor_layer.gd, which is the shape #362 moved to',
)
ok(
  'nor a named constant standing where a number would be',
  typedHeights('\tmesh.size = Vector3(1.2, MARKER_THICKNESS_METRES, 0.9)').length === 0,
  'negative control: a named offset is the allowed form',
)
ok(
  'nor an expression, nor a zero, nor a comment',
  typedHeights('\treturn Vector3(0.0, 1.2 + float(index) * 0.35, 0.0)\n\tvar a := Vector3(1.0, 0.0, 1.0)\n\t# it used to be Vector3(x, 0.4, z) here').length === 0,
  'negative control: three lines, none of them a typed height',
)

const placementScripts = scriptFiles.filter((file) => readFileSync(file, 'utf8').includes(PLACEMENT_MARKER))
ok(
  'the placement scripts were derived by the question they have to ask',
  placementScripts.length >= MINIMUM_PLACEMENT_SCRIPTS,
  `${placementScripts.length} mention ${PLACEMENT_MARKER}, floor ${MINIMUM_PLACEMENT_SCRIPTS}: ${placementScripts.map((f) => f.split(SEPARATOR).pop()).join(', ')}`,
)

const heightOffenders = []
for (const file of placementScripts) {
  for (const hit of typedHeights(readFileSync(file, 'utf8'))) {
    heightOffenders.push(`${file.split(SEPARATOR).join('/')}:${hit.line}  ${hit.text}   <- ${hit.value} is ${hit.what}`)
  }
}
ok(
  `no script that places something on a block types its height; it comes from the cell`,
  heightOffenders.length === 0,
  heightOffenders[0] ?? `${placementScripts.length} placement scripts scanned`,
)
for (const offender of heightOffenders.slice(1)) console.log(`     also ${offender}`)

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
console.log('all passed')
