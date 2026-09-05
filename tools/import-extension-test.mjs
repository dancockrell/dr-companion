/**
 * A ratchet on relative imports that Node cannot resolve.
 *
 *   node tools/import-extension-test.mjs           check
 *   node tools/import-extension-test.mjs --fix     rewrite the violations
 *   node tools/import-extension-test.mjs --write   regenerate the allowlist
 *
 * # What this is for
 *
 * Trap 1 in `docs/PLAN_TO_1_0.md`: `import x from './foo'` resolves under Vite
 * and fails under `node --experimental-strip-types` with `ERR_MODULE_NOT_FOUND`.
 * The error surfaces in whatever tool imports the module, never in the module
 * itself, so the session that pays for it is not the session that wrote it.
 * It has cost several lanes an hour each. It was written down and enforced by
 * nothing, which is the situation this repo's own rules say to end with a
 * check rather than with more care.
 *
 * The same trap has a second face: `import data from './x.json'` needs
 * `with { type: 'json' }` under Node. Same class, same failure, so it is
 * checked here rather than in a sibling tool.
 *
 * # Which forms are unsafe, measured rather than reasoned
 *
 * `tsconfig.app.json` sets `verbatimModuleSyntax: true`, and Node's type
 * stripping agrees with it: only the *declaration* form is erased. Measured on
 * node v24.19.0 against a three-file fixture:
 *
 *   import type { T } from './dep'    -> runs. The statement is erased whole.
 *   import { type T } from './dep'    -> ERR_MODULE_NOT_FOUND.
 *   import { v } from './dep'         -> ERR_MODULE_NOT_FOUND.
 *
 * So `import type` / `export type` are exempt and the inline `{ type X }` form
 * is not. The tempting blunt rule - "every specifier in the braces is marked
 * `type`, so the import is erased" - is wrong here, and wrong in the direction
 * that lets a real failure through. Node keeps the statement, emits
 * `import {} from './dep'`, and resolves it.
 *
 * # Why type-only imports are exempt rather than fixed for consistency
 *
 * Deliberate. An extension on a specifier Node never resolves buys nothing a
 * check can see, and the 124 of them live in files six lanes are editing at
 * once, so the cost is real rebase conflicts against no defect. A check that
 * flags what cannot fail teaches its readers to regenerate the allowlist,
 * which is how a ratchet stops being one.
 *
 * # Scope is all of `src/`, `.tsx` included
 *
 * Only Vite loads `.tsx` today, so the failure mode does not exist there yet.
 * It exists the first day somebody writes a test that imports a component, and
 * at that point the fix is 527 specifiers deep in files everyone is editing.
 * Cheaper now, and the rule is easier to state with no exceptions in it.
 *
 * # Why entries are keyed on the specifier, not the line
 *
 * Same reason as `tools/color-token-test.mjs`, from which this borrows the
 * shape: a line-keyed entry goes red when somebody two hundred lines above
 * adds an import, and the fastest way out of that is to regenerate - which
 * turns the ratchet into a snapshot of whatever the code happens to contain.
 * An entry is `{ file, specifier, count }` and survives every edit that does
 * not change how many times that file imports that specifier.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

/**
 * Overridable for the same reason as the allowlist below: pointing the walk at
 * a directory with almost nothing in it is the only way to execute the floor
 * branch on purpose, and a branch nobody can reach is a branch nobody can
 * prove they fixed.
 */
const ROOT = process.env.DRC_IMPORT_EXT_ROOT ?? 'src'

/**
 * Overridable so the missing-allowlist branch can be executed on purpose. A
 * branch nobody can reach is a branch nobody can prove they fixed.
 */
const ALLOWLIST = process.env.DRC_IMPORT_EXT_ALLOWLIST ?? 'tools/import-extension-allowlist.json'

/**
 * Extensions a specifier may already carry. `.ts`/`.tsx` are what the fix
 * writes; the rest are the asset and interop forms already in the tree, and
 * every one of them is something Node or Vite resolves without guessing.
 */
const KNOWN_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css|svg|png|webp|wasm)$/

/** Order matters: it is TypeScript's own resolution order, so the rewrite
 * lands on the file the compiler was already choosing. */
const CANDIDATES = ['.ts', '.tsx', '.mts', '.cts', '/index.ts', '/index.tsx']

/**
 * A floor, not the real count. It catches an empty or truncated walk - the
 * failure this whole file exists to make impossible - and never needs touching
 * otherwise. The tree held 927 relative specifiers across 201 files when this
 * was written.
 */
const MIN_FILES = 120
const MIN_SPECIFIERS = 600

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

/**
 * Every relative module specifier in one file, with the two facts that decide
 * whether it is a defect: whether the statement survives type stripping, and
 * whether a JSON import carries its attributes.
 */
function specifiersIn(file) {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found = []

  const visit = (node) => {
    let literal = null
    let erased = false
    let attributes = null

    if (ts.isImportDeclaration(node)) {
      literal = node.moduleSpecifier
      erased = !!node.importClause?.isTypeOnly
      attributes = node.attributes ?? null
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      literal = node.moduleSpecifier
      erased = !!node.isTypeOnly
      attributes = node.attributes ?? null
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      literal = node.arguments[0]
      // A second argument to import() is the options bag carrying `with`.
      attributes = node.arguments.length > 1 ? node.arguments[1] : null
    }

    if (literal && ts.isStringLiteral(literal) && literal.text.startsWith('.')) {
      found.push({
        specifier: literal.text,
        line: source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1,
        start: literal.getStart(source),
        end: literal.getEnd(),
        erased,
        hasAttributes: attributes !== null,
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return { text, found }
}

/** The real file a specifier names, or null. */
function resolveSpecifier(file, specifier) {
  const base = resolve(dirname(file), specifier)
  if (KNOWN_EXT.test(specifier)) return existsSync(base) ? base.replace(/\\/g, '/') : null
  for (const suffix of CANDIDATES) {
    if (existsSync(base + suffix)) return (base + suffix).replace(/\\/g, '/')
  }
  return null
}

/** What the specifier should read, given where it actually resolves. */
function fixedSpecifier(file, specifier) {
  const base = resolve(dirname(file), specifier)
  for (const suffix of CANDIDATES) {
    if (existsSync(base + suffix)) return specifier + suffix
  }
  return null
}

function scan() {
  const files = walk(ROOT)
  const violations = []
  let specifiers = 0

  for (const file of files) {
    const { found } = specifiersIn(file)
    specifiers += found.length
    for (const hit of found) {
      if (hit.erased) continue
      if (!KNOWN_EXT.test(hit.specifier)) {
        violations.push({ file, ...hit, kind: 'extension' })
      } else if (hit.specifier.endsWith('.json') && !hit.hasAttributes) {
        violations.push({ file, ...hit, kind: 'json-attributes' })
      }
    }
  }

  return { files, specifiers, violations }
}

/** A path may contain a space; it may not contain a NUL. */
const SEP = String.fromCharCode(0)

function keyOf(v) {
  return [v.file, v.specifier, v.kind].join(SEP)
}

/** `{ file, specifier, kind, count }`, sorted, so the diff of a shrinking
 * allowlist reads as the removals it is. */
function tally(violations) {
  const counts = new Map()
  for (const v of violations) {
    const key = keyOf(v)
    const row = counts.get(key)
    if (row) row.count += 1
    else counts.set(key, { file: v.file, specifier: v.specifier, kind: v.kind, count: 1 })
  }
  return [...counts.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier),
  )
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST)) return null
  return JSON.parse(readFileSync(ALLOWLIST, 'utf8')).entries
}

function fix() {
  const { violations } = scan()
  const byFile = new Map()
  for (const v of violations) {
    if (v.kind !== 'extension') continue
    if (!byFile.has(v.file)) byFile.set(v.file, [])
    byFile.get(v.file).push(v)
  }

  let changed = 0
  let refused = 0

  for (const [file, hits] of [...byFile.entries()].sort()) {
    const { text, found } = specifiersIn(file)
    const before = found.length

    // Right to left, so an earlier edit cannot move a later offset.
    const edits = []
    for (const hit of hits.sort((a, b) => b.start - a.start)) {
      const target = resolveSpecifier(file, hit.specifier)
      const replacement = fixedSpecifier(file, hit.specifier)
      if (!target || !replacement) {
        console.error(`  REFUSED ${file}:${hit.line} '${hit.specifier}' resolves to nothing on disk`)
        refused += 1
        continue
      }
      edits.push({ hit, replacement, target })
    }
    if (!edits.length) continue

    let next = text
    for (const edit of edits) {
      // start/end span the quotes; keep whichever quote character was used.
      const quote = text[edit.hit.start]
      next = next.slice(0, edit.hit.start) + quote + edit.replacement + quote + next.slice(edit.hit.end)
    }

    writeFileSync(file, next)

    // Re-parse and prove the rewrite moved nothing but the extensions: the same
    // number of specifiers, each still naming the same file on disk. A wrong
    // extension is a build error, which is the good case. A specifier that
    // silently resolves somewhere else is not, and only this comparison sees it.
    const after = specifiersIn(file)
    if (after.found.length !== before) {
      writeFileSync(file, text)
      console.error(`  REFUSED ${file}: specifier count ${before} -> ${after.found.length}, reverted`)
      refused += 1
      continue
    }
    const moved = edits.filter((e) => resolveSpecifier(file, e.replacement) !== e.target)
    if (moved.length) {
      writeFileSync(file, text)
      console.error(`  REFUSED ${file}: ${moved.length} specifier(s) would resolve elsewhere, reverted`)
      refused += 1
      continue
    }

    console.log(`  ${file}: ${edits.length} specifier(s)`)
    changed += edits.length
  }

  const json = violations.filter((v) => v.kind === 'json-attributes')
  for (const v of json) {
    console.log(`  MANUAL ${v.file}:${v.line} '${v.specifier}' needs with { type: 'json' }`)
  }

  console.log(`\nrewrote ${changed} specifier(s) across ${byFile.size} file(s); ${refused} refused; ${json.length} JSON import(s) left for hand editing`)
  return refused === 0 ? 0 : 1
}

function main() {
  const mode = process.argv[2]
  if (mode === '--fix') return process.exit(fix())

  const { files, specifiers, violations } = scan()

  if (files.length < MIN_FILES || specifiers < MIN_SPECIFIERS) {
    console.error(
      `import-extension-test: only ${files.length} file(s) and ${specifiers} relative specifier(s) examined ` +
        `(floor ${MIN_FILES}/${MIN_SPECIFIERS}). The walk is broken, not the tree.`,
    )
    process.exit(1)
  }

  const entries = tally(violations)

  if (mode === '--write') {
    writeFileSync(
      ALLOWLIST,
      `${JSON.stringify({ note: 'Shrinking allowlist. Entries may be removed, never added. See tools/import-extension-test.mjs.', entries }, null, 2)}\n`,
    )
    console.log(`wrote ${entries.length} entr(ies) to ${ALLOWLIST}`)
    return
  }

  const allowed = loadAllowlist()
  if (allowed === null) {
    // Three states, not two: an allowlist that is absent is not an allowlist
    // that is empty, and saying "passed" here would be the exact defect this
    // file exists to prevent.
    console.error(`import-extension-test: NOT CHECKED - allowlist ${ALLOWLIST} does not exist`)
    process.exit(1)
  }

  const allowedBy = new Map(allowed.map((e) => [[e.file, e.specifier, e.kind].join(SEP), e.count]))
  const failures = []

  for (const entry of entries) {
    const key = [entry.file, entry.specifier, entry.kind].join(SEP)
    const budget = allowedBy.get(key)
    if (budget === undefined) {
      const where = violations
        .filter((v) => v.file === entry.file && v.specifier === entry.specifier && v.kind === entry.kind)
        .map((v) => v.line)
        .join(', ')
      failures.push({
        file: entry.file,
        message:
          entry.kind === 'json-attributes'
            ? `${entry.file}:${where} imports '${entry.specifier}' without with { type: 'json' }`
            : `${entry.file}:${where} imports '${entry.specifier}' with no file extension`,
      })
    } else if (entry.count > budget) {
      failures.push({
        file: entry.file,
        message: `${entry.file} imports '${entry.specifier}' ${entry.count} time(s), allowlist permits ${budget}`,
      })
    }
    allowedBy.delete(key)
  }

  for (const stale of allowedBy.keys()) {
    const [file, specifier] = stale.split(SEP)
    failures.push({
      file,
      message: `allowlist entry ${file} -> '${specifier}' no longer matches anything; remove it`,
    })
  }

  // One line per file, because `run-tests.mjs` counts OK and FAIL lines and a
  // suite reporting zero checks is treated as NOT RUN however it exited. Files
  // is the right denominator: it is what goes to zero when the walk breaks,
  // which is the way this check fails silently if it fails silently at all.
  const badFiles = new Set(failures.map((f) => f.file))
  for (const file of files) {
    if (!badFiles.has(file)) console.log(`OK   ${file}`)
  }
  for (const f of failures) console.log(`FAIL ${f.message}`)

  console.log(
    `\nimport-extension-test: ${files.length} files, ${specifiers} relative specifiers, ` +
      `${violations.length} unresolvable-by-node, ${allowed.length} allowlisted`,
  )

  if (failures.length) {
    console.error(
      `\n${failures.length} failure(s). A relative import Node must resolve needs a file extension (trap 1).`,
    )
    process.exit(1)
  }

  console.log('all passed')
}

main()
