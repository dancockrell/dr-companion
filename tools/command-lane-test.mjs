/**
 * Every caller of the send path names who is asking.
 *
 * The outbound lane (`src-tauri/src/command_gate.rs`) orders commands by their
 * source, and its whole first invariant — a player-typed command never sits
 * behind automation — is only true if each caller says which it is. Rust
 * refuses an unknown source, so a *wrong* label fails loudly at runtime; a
 * *missing* one is the failure this file exists for, because TypeScript's
 * default parameter would quietly make it `ui-action` and nothing would say so.
 *
 * # The denominator
 *
 * This walks `src/` and finds every call of `sendGame`, `sendGameAction` and
 * `requestGameAction`, then asserts each passes a source. "N of N passed a
 * source" is worth nothing if N came back 0 because the scanner broke, so:
 *
 *  - the call list is printed with its count,
 *  - a floor well under the real number fails an empty or truncated scan,
 *  - a positive control asserts the scanner finds a call it is *told* exists
 *    at a named file and line, so a regexp that stopped matching cannot report
 *    a clean tree,
 *  - and a negative control feeds the same scanner a snippet with a
 *    source-less call and requires it to be flagged. Without that, a checker
 *    that flags nothing would pass this file exactly as happily as a tree with
 *    nothing wrong in it.
 *
 * The last two are the ones that matter. A zero here is a claim about this
 * scanner before it is a claim about the tree.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
let checks = 0
function ok(pass, what, detail = '') {
  checks++
  if (pass) console.log(`OK   ${what}`)
  else {
    failures++
    console.log(`FAIL ${what}${detail ? ` — ${detail}` : ''}`)
  }
}

/** The vocabulary, kept in step with `CommandSource` in `src/lib/commandLane.ts`. */
const SOURCES = ['player', 'ui-action', 'keybind', 'macro', 'ai-suggestion', 'script']

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(name)) out.push(full.split('\\').join('/'))
  }
  return out
}

/**
 * Find calls of the send path and split the argument list at top level.
 *
 * Depth-tracked rather than a regexp over the whole call, because the second
 * argument is routinely a template literal containing a nested call
 * (`` `Look at ${card.name}` ``) and a comma inside one is not an argument
 * boundary. A regexp that got that wrong would miscount arguments in exactly
 * the files this is aimed at.
 */
function callsIn(file, source) {
  const found = []
  const re = /\b(sendGame|sendGameAction|requestGameAction)\s*\(/g
  let m
  while ((m = re.exec(source)) !== null) {
    // A declaration or an import is not a call site.
    const before = source.slice(Math.max(0, m.index - 30), m.index)
    if (/\b(function|import|export)\s*$/.test(before)) continue
    // Nor is a member call. `hooks.sendGame(...)` in `keybindings.ts` is the
    // injection point, not the transport: whoever supplies the hook supplies
    // the source, and that wiring (App.tsx) is itself a call site here.
    if (/[.?]\s*$/.test(before)) continue
    let depth = 0
    let i = m.index + m[0].length - 1
    const args = ['']
    for (; i < source.length; i++) {
      const c = source[i]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') {
        depth--
        if (depth === 0) break
      }
      if (depth === 1 && c === ',') {
        args.push('')
        continue
      }
      if (depth >= 1 && !(depth === 1 && c === '(' && args.length === 1 && args[0] === ''))
        args[args.length - 1] += c
    }
    const line = source.slice(0, m.index).split('\n').length
    found.push({
      file,
      line,
      fn: m[1],
      args: args.map((a) => a.trim()).filter((a, idx) => idx > 0 || a !== ''),
      text: source.slice(m.index, i + 1).replace(/\s+/g, ' '),
    })
  }
  return found
}

/** Which argument position carries the source, per function. */
const SOURCE_ARG = { sendGame: 1, sendGameAction: 2, requestGameAction: 2 }

/**
 * The one place a source may be a variable rather than a literal.
 *
 * `gameActions.ts` is the wrapper: `requestGameAction` hands its source to
 * `sendGameAction`, which hands it to `sendGame`. Both of those forward a
 * parameter rather than choosing a value, so a literal would be wrong there.
 *
 * Named exactly - file, function and argument text - rather than allowed by
 * shape. "Any identifier counts" would let every caller in the tree pass a
 * variable and still clear this file, which is the check going quietly vacuous.
 * The signatures that make these two safe are asserted separately below.
 */
const FORWARDERS = [
  { file: 'src/lib/gameActions.ts', fn: 'sendGame', arg: 'source' },
  { file: 'src/lib/gameActions.ts', fn: 'sendGameAction', arg: 'source' },
]

function labelled(call) {
  const arg = call.args[SOURCE_ARG[call.fn]]
  if (!arg) return false
  if (FORWARDERS.some((f) => call.file.endsWith(f.file) && call.fn === f.fn && arg === f.arg))
    return true
  // A literal is the only thing checkable from here. A variable of type
  // `CommandSource` is checked by tsc instead, and there are none today — if
  // one appears, this must be widened deliberately rather than by loosening it
  // into "any second argument counts".
  return SOURCES.some((s) => arg === `'${s}'` || arg === `"${s}"`)
}

/* ------------------------------------------------------------------ */
/* The controls, before anything the scanner says is believed          */
/* ------------------------------------------------------------------ */

console.log('-- the scanner, against calls whose answer is already known --')
{
  const positive = `requestGameAction(\`look \${target}\`, \`Look at \${selected}\`, 'ui-action')`
  const hits = callsIn('fixture.ts', positive)
  ok(hits.length === 1, `the scanner finds a labelled call (found ${hits.length})`)
  ok(hits.length === 1 && labelled(hits[0]), 'and reads its source through a template-literal label')

  // The negative control. A checker that flags nothing passes a clean tree and
  // a broken tree identically, and this is the only thing that separates them.
  const negative = `requestGameAction(\`look \${t}\`, \`Look at \${s}\`)`
  const bad = callsIn('fixture.ts', negative)
  ok(bad.length === 1, `the scanner finds an unlabelled call (found ${bad.length})`)
  ok(bad.length === 1 && !labelled(bad[0]), 'and refuses it')

  const wrong = `sendGame(outgoing, 'user')`
  const w = callsIn('fixture.ts', wrong)
  ok(w.length === 1 && !labelled(w[0]), 'a source outside the vocabulary is refused, not waved through')

  const twoArgSendGame = `await sendGame(outgoing, 'player')`
  const t = callsIn('fixture.ts', twoArgSendGame)
  ok(t.length === 1 && labelled(t[0]), 'sendGame takes its source in position 1, not 2')

  // The forwarder exemption is by exact file, so a variable named `source`
  // anywhere else must still be refused. Otherwise the exemption is a hole
  // shaped like an identifier.
  const elsewhere = callsIn('src/components/Something.tsx', `sendGame(cmd, source)`)
  ok(
    elsewhere.length === 1 && !labelled(elsewhere[0]),
    'a variable source outside gameActions.ts is still refused'
  )
}

/* ------------------------------------------------------------------ */
/* The tree                                                            */
/* ------------------------------------------------------------------ */

console.log('\n-- every call site in src/ --')
const files = walk('src')
ok(files.length > 100, `the walker sees the tree: ${files.length} .ts/.tsx files`)

/**
 * Comments are prose about the send path, not uses of it.
 *
 * `GameConnectionBar.tsx` names `sendGame()` in its header to say which
 * connection it controls. Scanning that as a call site reports a defect in a
 * documentation sentence - a false red, which costs more than a false green
 * because it is addressed to somebody else. Blanked rather than removed, so
 * the line numbers this prints still point at the real file.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\r\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
}

const calls = []
for (const file of files) {
  calls.push(...callsIn(file, withoutComments(readFileSync(file, 'utf8'))))
}

// The floor. Set well under the real count so it catches an empty or truncated
// scan and never needs touching otherwise. Measured at 20 when this was
// written; if it ever drops below 10, something stopped matching.
ok(calls.length >= 10, `call sites found: ${calls.length} (floor 10)`)

const unlabelled = calls.filter((c) => !labelled(c))
for (const c of calls) {
  console.log(`     ${labelled(c) ? 'ok  ' : 'BAD '} ${c.file}:${c.line} ${c.fn} ${c.args[SOURCE_ARG[c.fn]] ?? '(no source)'}`)
}
ok(
  unlabelled.length === 0,
  `${calls.length} of ${calls.length} call sites name a source`,
  unlabelled.map((c) => `${c.file}:${c.line}`).join(', ')
)

console.log('\n-- the forwarder is typed, so the one variable source is safe --')
{
  const ga = readFileSync('src/lib/gameActions.ts', 'utf8')
  const typed = (ga.match(/source: CommandSource = 'ui-action'/g) ?? []).length
  ok(
    typed === 2,
    `sendGameAction and requestGameAction both declare source: CommandSource (found ${typed})`
  )
  ok(
    /import type \{ CommandSource \}/.test(ga),
    'and the type comes from commandLane.ts, so tsc refuses anything outside the vocabulary'
  )
}

console.log('\n-- the comment stripper does not eat code --')
{
  // The stripper is the newest thing here, so it is the least trusted. It has
  // to blank a comment and leave an adjacent call standing; a version that ate
  // the call would make the whole tree scan come back clean.
  const mixed = "// sendGame('x') in a comment\nrequestGameAction(`a`, `b`, 'ui-action')\n"
  const seen = callsIn('fixture.ts', withoutComments(mixed))
  ok(seen.length === 1, `the stripper blanks the comment and keeps the call (found ${seen.length})`)
  ok(seen.length === 1 && seen[0].line === 2, 'and line numbers survive the blanking')
}

console.log('\n-- the two sides agree on the vocabulary --')
{
  const ts = readFileSync('src/lib/commandLane.ts', 'utf8')
  const rs = readFileSync('src-tauri/src/command_gate.rs', 'utf8')
  for (const s of SOURCES) {
    ok(ts.includes(`| '${s}'`), `commandLane.ts declares '${s}'`)
    ok(rs.includes(`"${s}" =>`), `command_gate.rs parses "${s}"`)
  }
  // And nothing extra on either side. A source Rust accepts that TypeScript
  // cannot name is a lane setting nobody can reach; the reverse is a runtime
  // rejection nobody predicted.
  const rustArms = [...rs.matchAll(/^\s+"([a-z-]+)" => Source::/gm)].map((m) => m[1]).sort()
  ok(
    rustArms.join(',') === [...SOURCES].sort().join(','),
    `Rust accepts exactly the declared sources (found ${rustArms.join(', ')})`
  )
}

console.log('\n-- one path to the socket --')
{
  const link = readFileSync('src-tauri/src/game_link.rs', 'utf8')
  // The write is crate-private and the lane is its only caller. A second
  // `write_all` to `h.out` would be a second writer, which is the whole thing
  // this lane exists to prevent.
  const writers = [...link.matchAll(/h\.out\s*\n?\s*\.write_all|h\.out\.write_all/g)].length
  ok(writers === 1, `exactly one socket write in game_link.rs (found ${writers})`)
  ok(
    /pub\(crate\) fn write_command/.test(link),
    'the writer is crate-private, so nothing outside Rust can route around the lane'
  )
  const gate = readFileSync('src-tauri/src/command_gate.rs', 'utf8')
  ok(
    (gate.match(/game_link::write_command/g) ?? []).length === 1,
    'and the lane calls it exactly once'
  )
  const api = readFileSync('src-tauri/src/script_api.rs', 'utf8')
  ok(
    !/game_link::game_send|game_link::write_command/.test(api),
    'script_api reaches the game through the lane, not around it'
  )
}

console.log('\n-- G11: the AI gate still has exactly one way out --')
{
  // Not this lane's guarantee to make, and precisely why it is checked here:
  // the lane sits *after* the confirmation gate, so if adding it had moved or
  // multiplied that boundary, this is where it would show.
  const ai = readFileSync('src/lib/aiSuggestions.ts', 'utf8')
  const sites = (ai.match(/requestGameAction\(/g) ?? []).length
  ok(sites === 1, `aiSuggestions.ts calls requestGameAction exactly once (found ${sites})`)
  ok(
    /requestGameAction\(command, label, 'ai-suggestion'\)/.test(ai),
    "and that one call is labelled 'ai-suggestion', below player and every UI source"
  )
}

console.log(`\n${failures ? 'FAILURES' : 'all passed'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
