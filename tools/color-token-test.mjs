/**
 * A ratchet on raw colour literals in components.
 *
 *   node tools/color-token-test.mjs           check
 *   node tools/color-token-test.mjs --write   regenerate the allowlist
 *
 * # What this is for
 *
 * Issues #176 and #179: colours are declared as tokens in `src/index.css`, and
 * components are supposed to use them. Many do not, and the cost is not
 * tidiness - it is that two components can disagree about what a bank pin
 * looks like, and neither is wrong about anything a test can see. A token is
 * one place to change; a literal is as many places as somebody typed it.
 *
 * Every literal that exists today is allowed, so this does not block work. It
 * refuses only *new* ones, and refuses an allowlist entry that no longer
 * matches anything, so the list can only shrink. That is the whole mechanism:
 * the codebase is allowed to be where it is and not allowed to get worse.
 *
 * # Why entries are keyed on the literal, not the line
 *
 * Several sessions edit `src/components` at once. A line-keyed entry goes red
 * when somebody two hundred lines above adds an import - nothing about colour
 * changed, and the fastest way out is to regenerate the allowlist. A ratchet
 * that gets regenerated is not a ratchet; it is a snapshot of whatever the
 * code happens to contain, which is the state this exists to end.
 *
 * So an entry is `{ file, literal, count }`. It survives every edit that does
 * not change how many times that literal appears in that file. Line numbers
 * are still printed in failures, because that is what a person needs in order
 * to go and fix it - they are diagnostic output, not identity.
 *
 * # The count matters
 *
 * Without it, a file already allowlisted for `#fff` could take ten more `#fff`
 * and stay green. The allowlist records how many were there, and more is a
 * failure.
 *
 * # Comments are prose, and prose is not code
 *
 * Three of the fifty-two literals this shipped with were not colours. Two were
 * `#268` - a pull request number in a sentence explaining why a panel exists -
 * and the third was `rgb(46,42,32)` in a comment recording a border colour
 * somebody had measured in the running app. `#[0-9a-f]{3,8}` matches every
 * issue and PR number this project has, because every digit 0-9 is also a hex
 * digit: `#176`, `#179`, `#294` and `#300` all read as colours to a blunt
 * matcher.
 *
 * "Deliberately blunt" is right about *code* and wrong here, and the reason
 * matters more than the three entries: a check that goes red when you explain
 * something teaches people to stop explaining. That already happened once in
 * this repo - `scrollable-region-test.mjs` flagged the comment written to
 * explain why a file no longer set `touch-none` (C10).
 *
 * So comments are stripped before matching. String literals are not: a colour
 * in a string is a colour that reaches the DOM, and `stripComments` tracks
 * quoting precisely so that `'https://x'` is not mistaken for a line comment
 * and a `//` inside a `style` string cannot hide the rest of the line.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src/components'
const ALLOWLIST = 'tools/color-token-allowlist.json'

/**
 * Deliberately blunt. A cleverer matcher that understood context would
 * eventually decide some literal is fine; refusing on shape alone costs a
 * one-line allowlist entry when it is wrong, and misses nothing when it is
 * right.
 *
 * `\b` after the hex digits stops `#abcdef12345` matching as an 8-digit hex
 * followed by junk. Tailwind's arbitrary-value syntax is caught separately
 * because `bg-[#123456]` also contains a bare hex, and counting it twice
 * would make the numbers meaningless.
 */
const PATTERNS = [
  { name: 'hex', re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'rgb', re: /\brgba?\([^)]*\)/g },
  { name: 'hsl', re: /\bhsla?\([^)]*\)/g },
]

/** Files scanned must not silently collapse to nothing. Set far below the real
 * count so it never needs touching and still catches a broken walk. */
const MIN_FILES = 40

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.tsx')) out.push(path.split('\\').join('/'))
  }
  return out
}

/**
 * Blank out `//` and block comments, replacing them with spaces so every
 * remaining character keeps its line and column. Quoting is tracked because
 * the alternative silently loses code: `'https://…'` inside a string would
 * end the line at the `//`, and anything after it — including a colour — would
 * stop being scanned. That is the failure this whole file exists to prevent,
 * arriving through the door marked "convenience".
 *
 * JSX text is treated as code, which is correct: a comment written inside a
 * string stays code, and a JSX comment is a real block comment to the parser
 * and to this. Template-literal `${…}` nesting is not modelled; nothing under
 * `src/components` puts a comment inside an interpolation, and if something
 * ever does, the worst case is that a real literal is missed and the ratchet
 * under-reports — which the allowlist's shrink-only rule then catches, because
 * an entry that stops matching is a failure.
 */
export function stripComments(text) {
  let out = ''
  let i = 0
  const n = text.length
  // 'code' | 'line' | 'block' | a quote character while inside a string
  let mode = 'code'
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line'
        out += '  '
        i += 2
        continue
      }
      if (c === '/' && next === '*') {
        mode = 'block'
        out += '  '
        i += 2
        continue
      }
      if (c === '"' || c === "'" || c === '`') mode = c
      out += c
      i++
      continue
    }
    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code'
        out += c
      } else out += ' '
      i++
      continue
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') {
        mode = 'code'
        out += '  '
        i += 2
        continue
      }
      out += c === '\n' ? c : ' '
      i++
      continue
    }
    // inside a string: only the matching quote closes it, and a backslash
    // escapes whatever follows. A newline in a non-template string means the
    // file does not parse, so falling back to 'code' there is the honest
    // recovery rather than swallowing the rest of the file.
    if (c === '\\') {
      out += c + (next ?? '')
      i += 2
      continue
    }
    if (c === mode) mode = 'code'
    else if (c === '\n' && mode !== '`') mode = 'code'
    out += c
    i++
  }
  return out
}

/** Every literal in one file, with the lines it appears on. */
export function scanText(text) {
  const lines = stripComments(text).split('\n')
  const hits = new Map() // literal -> line numbers
  lines.forEach((line, i) => {
    for (const { re } of PATTERNS) {
      re.lastIndex = 0
      for (const m of line.matchAll(re)) {
        const literal = m[0]
        if (!hits.has(literal)) hits.set(literal, [])
        hits.get(literal).push(i + 1)
      }
    }
  })
  return hits
}

const files = walk(ROOT)
if (files.length < MIN_FILES) {
  console.error(`FAILED: scanned only ${files.length} files under ${ROOT} (floor ${MIN_FILES}); the walk is broken`)
  process.exit(1)
}

const found = [] // { file, literal, count, lines }
for (const file of files) {
  for (const [literal, lines] of scanText(readFileSync(file, 'utf8'))) {
    found.push({ file, literal, count: lines.length, lines })
  }
}

if (process.argv.includes('--write')) {
  const entries = found
    .map(({ file, literal, count }) => ({ file, literal, count }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.literal.localeCompare(b.literal))
  writeFileSync(
    ALLOWLIST,
    JSON.stringify(
      {
        note: 'Raw colour literals present when the ratchet was installed. This list may only shrink: tools/color-token-test.mjs fails on a new literal and on an entry that no longer matches. Do not regenerate it to make a failure go away - that is the one move it exists to prevent.',
        entries,
      },
      null,
      2
    ) + '\n'
  )
  console.log(`wrote ${entries.length} entries covering ${entries.reduce((n, e) => n + e.count, 0)} literals`)
  process.exit(0)
}

const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
const permitted = new Map(allow.entries.map((e) => [`${e.file}\u0000${e.literal}`, e]))
const seen = new Set()

let failed = 0
let ok = 0
const fail = (line) => {
  failed++
  console.log(`FAIL ${line}`)
}
const check = (label, actual, expected) => {
  if (actual === expected) {
    ok++
    console.log(`OK   ${label}`)
  } else fail(`${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

/**
 * The stripper runs before every other assertion in this file, so if it eats
 * code the whole ratchet under-reports and the allowlist's shrink-only rule is
 * the only thing left standing between that and a silent pass. These are the
 * cases that would do it, and they are checked here rather than in a separate
 * suite because a second file answering "does the scanner work" is the drift
 * this project forbids.
 */
const lit = (text) => [...scanText(text).keys()].sort()
check('a colour in code is found', lit('const a = "#abcdef"').join(), '#abcdef')
check('a colour in a line comment is not', lit('// see #abcdef').length, 0)
check('a colour in a block comment is not', lit('/* see PR #268\n * and rgb(1,2,3) */').length, 0)
check('a colour in a JSX comment is not', lit('{/* PR #268 */}').length, 0)
check(
  'a URL in a string does not end the line',
  lit(`const u = 'https://x'; const c = '#abcdef'`).join(),
  '#abcdef'
)
check(
  'a comment marker inside a string is not a comment',
  lit(`const s = '/* '; const c = '#abcdef'`).join(),
  '#abcdef'
)
check('code after a block comment is still scanned', lit('/* x */ const c = "#abcdef"').join(), '#abcdef')
check('an apostrophe in prose does not swallow the file', lit("// don't\nconst c = '#abcdef'").join(), '#abcdef')
check('every line number survives stripping', scanText('// x\n// y\nconst c = "#abcdef"').get('#abcdef').join(), '3')

for (const hit of found) {
  const key = `${hit.file}\u0000${hit.literal}`
  seen.add(key)
  const entry = permitted.get(key)
  if (!entry) {
    fail(`${hit.file}:${hit.lines.join(',')} — new raw colour ${hit.literal}; use a token from src/index.css`)
  } else if (hit.count > entry.count) {
    fail(
      `${hit.file}:${hit.lines.join(',')} — ${hit.literal} appears ${hit.count} times, allowlist permits ${entry.count}`
    )
  } else {
    ok++
    // One line per group, because `run-tests.mjs` counts OK and FAIL lines and
    // treats a suite that prints neither as having asserted nothing - which is
    // exactly what it should do, and what this suite did on its first run.
    console.log(
      `OK   ${hit.file}:${hit.lines[0]} ${hit.literal} within its allowance (${hit.count}/${entry.count})`
    )
  }
}

// The other direction: an entry that matches nothing is a literal somebody
// removed, and leaving it would let the same literal come back for free.
for (const [key, entry] of permitted) {
  if (!seen.has(key)) {
    fail(`${entry.file} — allowlist still lists ${entry.literal}, which is gone; remove the entry (the list only shrinks)`)
  }
}

const remaining = found.reduce((n, h) => n + h.count, 0)
const byDir = new Map()
for (const hit of found) {
  const dir = hit.file.split('/').slice(0, 3).join('/')
  byDir.set(dir, (byDir.get(dir) ?? 0) + hit.count)
}
console.log(`\nremaining: ${remaining} raw colour literals in ${new Set(found.map((h) => h.file)).size} files`)
for (const [dir, n] of [...byDir].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${dir}`)
}
console.log(`\n${ok} allowlisted literal group(s) checked across ${files.length} component files`)

if (failed) {
  console.error(`FAILED: ${failed} colour finding(s)`)
  process.exit(1)
}
console.log('all passed')
