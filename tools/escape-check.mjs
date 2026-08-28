#!/usr/bin/env node
/**
 * Fails the build on a regex whose backslash escapes were eaten before the
 * file was written.
 *
 * # Why this is a check and not another note
 *
 * Writing source through a shell heredoc halves backslash runs, so `\\d`
 * arrives on disk as `d`. The regex still compiles. `/-?\d+/` becomes
 * `/-?d+/`, which is a perfectly valid pattern meaning "an optional minus
 * then one or more letter d", and it matches nothing in a health bar. The
 * function returns empty, the panel shows no vitals, and it reads exactly
 * like the game never sent them.
 *
 * This repo's own notes have said "use the edit tools for anything containing
 * a backslash" since the first occurrence. It has now happened **four times**,
 * most recently in `vitalFromText`, where indicators worked and vitals were
 * silently empty. Four occurrences with the remedy already written down is
 * where a note has been measured and found not to work.
 *
 * # What it looks for
 *
 * A single letter from `dDwWsSbB` sitting in a regex where the escaped form is
 * almost certainly what was meant: immediately before a quantifier, or inside
 * a character class. `/-?d+/` is caught; `/id+/` would be too, which is why
 * ALLOW exists and why a suppression has to name the file and say why.
 *
 * It cannot catch every collapsed escape - a lone `\n` becoming `n` in a
 * pattern is indistinguishable from an intended letter - so this narrows the
 * blast radius rather than closing it. Stated plainly instead of implied,
 * because the gap is where the next one will come from.
 *
 * Run: node tools/escape-check.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

/** Overridable so both failure branches can be run deliberately. */
const ROOT = process.env.DRC_ESCAPE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_ROOTS = ['src', 'tools']

/**
 * A floor on files scanned.
 *
 * Set far below the real count so it never needs touching. It exists so a
 * walker that silently finds nothing reports itself rather than reporting a
 * clean tree - an empty scan and a clean codebase are otherwise identical.
 */
const MIN_FILES = 40

/**
 * Deliberate exceptions. A real `d+` in a pattern belongs here with a reason,
 * so the exemption is visible rather than accidental.
 *
 * Format: `relative/path.ts` — every suspicious hit in the file is allowed.
 * Kept coarse on purpose: a line-numbered allowlist rots on the next edit and
 * then gets deleted wholesale, which is worse.
 */
const ALLOW = new Set([
  // This file: the examples in its own doc comment and its own matcher.
  join('tools', 'escape-check.mjs'),
])

/** `\d` etc. collapsed to a bare letter, before a quantifier or in a class. */
const SUSPECT = /(^|[^\\A-Za-z0-9_])([dDwWsSbB])(?=[+*?{])|\[[^\]\n]*?(^|[^\\])([dDwWsSbB])[+*]/

function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|mjs|js)$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Regex literals only.
 *
 * Matching bare identifiers across whole files produces noise from prose and
 * from ordinary code, and a check that cries wolf gets suppressed - which
 * costs more than the check was worth.
 */
const LITERAL = /\/(?![/*])((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+)\/[gimsuy]*/g

const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)))

if (files.length < MIN_FILES) {
  console.error(
    `escape-check: scanned only ${files.length} files, expected at least ${MIN_FILES}.\n` +
      `Roots: ${SCAN_ROOTS.join(', ')} under ${ROOT}\n` +
      'This is the check failing, not the codebase passing. A walker that ' +
      'finds nothing looks exactly like a tree with no defects.'
  )
  process.exit(1)
}

let regexCount = 0
const hits = []

for (const file of files) {
  const rel = relative(ROOT, file)
  if (ALLOW.has(rel)) continue
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    // Skip comment lines: prose about regexes is not a regex.
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    for (const m of line.matchAll(LITERAL)) {
      regexCount++
      if (SUSPECT.test(m[1])) {
        hits.push({ file: rel, line: i + 1, pattern: m[0].slice(0, 60) })
      }
    }
  })
}

console.log(`Files scanned:          ${files.length}`)
console.log(`Regex literals found:   ${regexCount}`)
console.log(`Allowed files:          ${[...ALLOW].join(', ') || '(none)'}`)

if (regexCount === 0) {
  console.error(
    '\nescape-check: found zero regex literals across every scanned file.\n' +
      'That is the extractor being broken, not the codebase being free of ' +
      'them. Refusing to report a pass.'
  )
  process.exit(1)
}

if (hits.length === 0) {
  console.log('OK — no regex looks like it lost a backslash.')
  process.exit(0)
}

console.error('\nescape-check: FAILED\n')
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}  ${h.pattern}`)
}
console.error(
  '\nEach of these has a bare letter where an escape almost certainly belongs:\n' +
    '`d+` rather than the digit class, `s+` rather than whitespace, and so on.\n' +
    'The usual cause is writing the file through a shell, which halves\n' +
    'backslash runs - the pattern still compiles and silently matches the\n' +
    'wrong thing, which reads as missing data rather than as a bug.\n' +
    'Rewrite the file with the Write or Edit tools, which pass bytes through\n' +
    'unchanged, and verify with od -c rather than by eye - one backslash and\n' +
    'two are indistinguishable at a glance and mean different things.\n' +
    'If the pattern is genuinely correct, add the file to ALLOW here with a\n' +
    'reason, so the exemption is deliberate rather than accidental.\n'
)
process.exit(1)
