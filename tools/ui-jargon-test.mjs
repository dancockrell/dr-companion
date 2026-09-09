/**
 * No string a player can read names a thing only a developer knows about.
 *
 * # The instance this came from
 *
 * On 9 September 2026 the Lich card in the running app showed Dan, in red,
 * above a Start button:
 *
 *   Signing a character in is `lich_login_launch` now, not `launch_lich`:
 *   Lich's saved-entry route needed Genie to create the entry, and the app
 *   performs the account login itself.
 *
 * Every word of that is true and none of it is actionable. It names two Tauri
 * command identifiers and a third-party client that was removed three days
 * earlier, it reads as an error when nothing is wrong, and it was returned by
 * a Rust command whose author was writing to the next programmer. The webview
 * renders a command's `Err` string straight into the panel, so the audience
 * of a developer note and the audience of the app are the same people.
 *
 * # What this checks
 *
 * Rendered strings in `src/**` (JSX text, string literals reaching the DOM)
 * and the user-facing strings Rust commands return, against a name set that is
 * *derived* rather than typed:
 *
 *   - every command registered in `generate_handler!` (`src-tauri/src/lib.rs`),
 *     so a command added tomorrow is covered without anybody remembering to
 *     add it here;
 *   - plus RETIRED_NAMES below, for products and routes that no longer exist
 *     and can therefore never appear in a registry.
 *
 * Deriving the set matters more than the list: a hand-typed list of banned
 * words is a promise to keep it up to date, and this file exists because a
 * promise to be careful is what failed.
 *
 * # What it deliberately does not check
 *
 * Comments and `invoke('...')` arguments. Code has every right to name code;
 * the defect is a code name reaching a *reader*. The negative control below
 * asserts exactly that, because a check that flagged both would be turned off
 * within a week.
 *
 * # Three states
 *
 * The parsers refuse rather than return empty. A `generate_handler!` block
 * that does not parse, or a component walk that finds no files, is an abort
 * naming the reason - never a clean pass. `tools/ui-jargon-break-check.mjs`
 * sabotages this file's three checks in turn and asserts which ones go red.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
let checks = 0
const ok = (name, cond, detail = '') => {
  checks++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(66)}  ${detail}`)
}

const read = (p) => readFileSync(p, 'utf8')

/**
 * Names no registry can produce, because the thing they name is gone.
 *
 * Each carries the date it was retired, so a reader can tell a live product
 * from a dead one without going to look. Deliberately short: anything that
 * still exists somewhere is in the derived set instead.
 */
const RETIRED_NAMES = [
  // Lich's saved-entry launch route, deleted 6 Sep 2026 with the third-party
  // client that was the only way to create an entry. Named here rather than
  // in a registry because a deleted thing has no registry to appear in.
  'saved-entry route',
  // Rust internals that are not `#[tauri::command]`s and so are absent from
  // `generate_handler!`, but have appeared in text a player can read.
  'launch_lich_with_launch_data',
  'launch_lich_bare',
  'gui_login_usable',
]

/**
 * Deliberately NOT banned: the word `Genie` on its own.
 *
 * The obvious reading of the defect this file came from is "Genie is retired,
 * so the app must stop saying Genie". That is wrong, and the tree says so:
 * `PlayerConfigPanel`, `AliasesTab`, `GagsTab` and `ExportImportTab` offer to
 * import a player's existing Genie aliases and gags, and "your Genie install"
 * is exactly the right words for that - the player has one, on their disk,
 * with their macros in it. What was retired on 6 September 2026 is the
 * *sign-in route through Genie*, not the product, and banning the noun would
 * make this check fire on six live features until somebody turned it off.
 * A check that cries wolf is as empty as one that never fires (CLAUDE.md
 * section 1).
 */

const LIB_RS = process.env.DRC_UI_JARGON_LIB_RS ?? 'src-tauri/src/lib.rs'
const SRC = process.env.DRC_UI_JARGON_SRC ?? 'src'

// --------------------------------------------------------------------------
// The derived identifier set.
// --------------------------------------------------------------------------
/** Registered command names, or a thrown error. Never a quiet empty list. */
function registeredCommands(text) {
  const m = text.match(/generate_handler!\s*\[([\s\S]*?)\]/)
  if (!m) {
    throw new Error(
      `${LIB_RS}: generate_handler! block not found - the parser is broken, this is not an empty result`,
    )
  }
  const names = m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .join('')
    .split(',')
    .map((s) => s.trim().split('::').pop())
    .filter((s) => /^[a-z][a-z0-9_]*$/.test(s))
  if (names.length === 0) throw new Error(`${LIB_RS}: parsed zero command names`)
  return [...new Set(names)]
}

let commands
try {
  commands = registeredCommands(read(LIB_RS))
} catch (e) {
  console.log(`FAIL could not derive the command set: ${e.message}`)
  process.exit(1)
}
ok(
  'the command registry parsed and produced names',
  commands.length >= 40,
  `${commands.length} registered command(s)`,
)

/**
 * The names to look for, longest first so `lich_login_launch` is reported
 * rather than a shorter name that happens to be a substring of it.
 */
const BANNED = [...commands, ...RETIRED_NAMES].sort((a, b) => b.length - a.length)

// --------------------------------------------------------------------------
// The population: strings a reader can see.
// --------------------------------------------------------------------------
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.tsx$/.test(entry.name)) files.push(p)
  }
}
walk(SRC)
ok('the component walk found files to read', files.length >= 50, `${files.length} .tsx file(s)`)

/**
 * Strip everything that is code-about-code, leaving what a reader sees.
 *
 * Order matters: block comments first (they can contain quotes), then line
 * comments, then `invoke`/`invokeTauri` calls with their command-name
 * argument. What is left is JSX text and the string literals around it.
 *
 * Newlines are preserved through every removal so the line number reported
 * for a hit is the real one - a line count that drifts is a file:line
 * pointing somewhere else, which is worse than no pointer.
 */
const blank = (s) => s.replace(/[^\n]/g, '')
function renderedText(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1)
    .replace(/invoke(?:Tauri)?\s*(?:<[^>]*>)?\s*\(\s*(['"`])[^'"`]*\1/g, blank)
}

function hits(text, file) {
  const found = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const name of BANNED) {
      // Word boundary: `game_send` must not be found inside `game_sender`,
      // `launch_lich` not inside `launch_lich_bare`. `\b` is wrong for
      // snake_case here because `_` is a word character, so the guard is
      // explicit on both sides.
      const re = new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`)
      if (re.test(line)) {
        found.push(`${file}:${i + 1} "${name}"`)
        break
      }
    }
  })
  return found
}

const offenders = []
let scanned = 0
for (const f of files) {
  const text = renderedText(read(f))
  scanned += text.split('\n').length
  offenders.push(...hits(text, f))
}
ok(
  'the scan read a real number of rendered lines',
  scanned >= 5000,
  `${scanned} line(s) across ${files.length} file(s)`,
)
ok(
  'no rendered string in src/ names a command, an internal or a retired product',
  offenders.length === 0,
  offenders.slice(0, 8).join('; ') + (offenders.length > 8 ? ` (+${offenders.length - 8} more)` : ''),
)

// --------------------------------------------------------------------------
// The same rule on the Rust side: an `Err` string is rendered verbatim.
// --------------------------------------------------------------------------
// `LichLauncher.tsx` puts `String(e)` from a failed `invokeTauri` straight
// into the panel in red, and it is not alone. So a `Result<_, String>` from a
// `#[tauri::command]` is user-facing text, and the same rule applies to it.
{
  const lich = read('src-tauri/src/lich.rs')
  // Only the string literals inside `Err(...)`/`.into()` returns, not the
  // doc comments above them - the doc comments are for developers and are
  // allowed to name anything they like.
  const codeOnly = lich
    .split('\n')
    .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l))
    .join('\n')
  const strings = [...codeOnly.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
  ok('the Rust string extractor found strings', strings.length >= 20, `${strings.length} literal(s)`)
  // Sentences, not identifiers: a string with a space in it and a lowercase
  // word is prose headed for a human. `"rubyw.exe"` and `"--headless="` are
  // not, and flagging those would make this unusable.
  const prose = strings.filter((s) => / [a-z]/.test(s) && s.length > 25)
  ok('the prose filter kept a real population', prose.length >= 10, `${prose.length} sentence(s)`)
  const jargon = prose.filter((s) =>
    BANNED.some((n) => new RegExp(`(^|[^A-Za-z0-9_])${n}(?![A-Za-z0-9_])`).test(s)),
  )
  ok(
    'no sentence a Rust command returns names a command or a retired product',
    jargon.length === 0,
    jargon.map((s) => `"${s.slice(0, 70)}"`).join('; '),
  )
}

// --------------------------------------------------------------------------
// Controls. Neither the positive nor the negative is optional: without the
// first a green result may be nothing running, without the second this check
// is one that fires on everything and gets switched off.
// --------------------------------------------------------------------------
{
  const planted = [
    `      <p>Signing a character in is \`lich_login_launch\` now, not \`launch_lich\`.</p>`,
    `      <p>Its saved-entry route cannot create the entry.</p>`,
  ].join('\n')
  const caught = hits(renderedText(planted), 'PLANTED')
  ok(
    'positive control: a planted jargon sentence is caught on both lines',
    caught.length === 2,
    caught.join('; ') || 'nothing caught - this check is not running',
  )

  const legitimate = [
    `      // launch_lich is the bare open; see lich.rs.`,
    `      /* lich_login_launch returns the port. The saved-entry route is gone. */`,
    `      const said = await invokeTauri('launch_lich')`,
    `      await invoke('lich_login_launch', { account })`,
  ].join('\n')
  const falsePositives = hits(renderedText(legitimate), 'LEGIT')
  ok(
    'negative control: comments and invoke() arguments are not flagged',
    falsePositives.length === 0,
    falsePositives.join('; '),
  )

  // The line-number guard. A stripper that ate newlines would still catch the
  // planted string and would point at the wrong line, which is a false
  // pointer wearing a green tick.
  // Three lines of block comment, not three blank lines: the blanker is
  // what has to preserve them, and a control that never invokes the
  // blanker cannot tell a correct one from a broken one.
  const padded = `/* pad\n     pad\n     pad */\n${planted}`
  const lineOf = hits(renderedText(padded), 'PADDED')[0] ?? ''
  ok(
    'a hit reports the real line number',
    lineOf.startsWith('PADDED:4 '),
    lineOf || 'no hit at all',
  )

  // Word boundaries, on the pair that actually collides: `launch_lich` is a
  // strict prefix of nothing here, but `game_send` is of `game_sender`.
  ok(
    'a longer identifier is not matched by a shorter registered prefix',
    hits(renderedText(`      <p>Call the game_sender helper.</p>`), 'B').length === 0,
  )
}

console.log(`\n${checks} checks, ${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
