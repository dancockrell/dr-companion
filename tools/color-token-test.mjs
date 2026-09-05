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

/** Every literal in one file, with the lines it appears on. */
export function scanText(text) {
  const lines = text.split('\n')
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
