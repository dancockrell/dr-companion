import { readFileSync } from 'node:fs'
import { validateGameActionCommand, validateGameCommand } from '../src/lib/gameCommand.ts'

let failed = 0
let checked = 0

function ok(name: string, condition: boolean, detail = '') {
  checked += 1
  if (!condition) failed += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
}

function rejects(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

console.log('-- raw player commands remain one protocol line --')
for (const command of ['look', 'ask guard about ferry', ';status', 'appraise sword;health']) {
  ok(`raw command survives: ${command}`, validateGameCommand(command) === command)
}
for (const [name, command] of [
  ['newline', 'look\n;danger'],
  ['carriage return', 'look\rhealth'],
  ['NUL', 'look\0health'],
  ['tab', 'look\thealth'],
  ['escape', 'look\u001bhealth'],
  ['delete', 'look\u007fhealth'],
  ['Unicode control', 'look\u0085health'],
] as const) {
  ok(`${name} is rejected`, rejects(() => validateGameCommand(command)))
}

console.log('\n-- generated actions cannot smuggle a command separator --')
ok('an ordinary generated look survives', validateGameActionCommand('look kobold') === 'look kobold')
ok('an empty generated action is rejected', rejects(() => validateGameActionCommand('   ')))
ok('a semicolon in game-derived text is rejected',
  rejects(() => validateGameActionCommand('look kobold;#script abort all')))
ok('an overlong game-derived target is rejected',
  rejects(() => validateGameActionCommand(`look ${'x'.repeat(160)}`)))
ok('generated actions also inherit the one-line boundary',
  rejects(() => validateGameActionCommand('assess kobold\n;danger')))

console.log('\n-- a generated action cannot read as something other than it sends --')
// Every literal here is built from its code point rather than pasted, so the
// file stays reviewable in a plain editor and nothing depends on an escape
// surviving a tool, a heredoc or a checkout. `rejectionOf` returns the
// message so a case can assert the *reason* a player would be shown, not
// merely that something threw.
function rejectionOf(command: string): string | null {
  try {
    validateGameActionCommand(command)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// One representative per class of code point that renders as nothing, renders
// as something other than itself, or cannot render at all. The first four are
// the ones measured in #401 as ACCEPTED before this rule existed.
const REFUSED: readonly (readonly [number, string, string])[] = [
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE', 'Cf, bidi override - #401'],
  [0x200b, 'ZERO WIDTH SPACE', 'Cf, invisible - #401'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE', 'Cf, bidi isolate - #401'],
  [0x00ad, 'SOFT HYPHEN', 'Cf, invisible - #401'],
  [0x2069, 'POP DIRECTIONAL ISOLATE', 'Cf, bidi isolate'],
  [0x200f, 'RIGHT-TO-LEFT MARK', 'Cf, bidi mark'],
  [0x200d, 'ZERO WIDTH JOINER', 'Cf, joiner'],
  [0x2062, 'INVISIBLE TIMES', 'Cf, invisible operator'],
  [0xfe0f, 'VARIATION SELECTOR-16', 'Mn, variation selector'],
  [0xe0101, 'VARIATION SELECTOR-18', 'Mn, variation selector supplement'],
  [0xe000, 'PRIVATE USE FIRST', 'Co, private use area'],
  [0xf8ff, 'PRIVATE USE LAST', 'Co, private use area'],
  [0x0f0000, 'SUPPLEMENTARY PRIVATE USE A', 'Co, plane 15'],
  [0x100000, 'SUPPLEMENTARY PRIVATE USE B', 'Co, plane 16'],
  [0x0378, 'UNASSIGNED', 'Cn, unassigned'],
  [0xd800, 'LONE HIGH SURROGATE', 'Cs, surrogate'],
  [0xdfff, 'LONE LOW SURROGATE', 'Cs, surrogate'],
  [0x2028, 'LINE SEPARATOR', 'Zl'],
  [0x2029, 'PARAGRAPH SEPARATOR', 'Zp'],
  [0x00a0, 'NO-BREAK SPACE', 'Zs, not the space it looks like'],
  [0x3000, 'IDEOGRAPHIC SPACE', 'Zs, not the space it looks like'],
  [0x00e9, 'LATIN SMALL LETTER E WITH ACUTE', 'Ll, non-ASCII and so out of scope'],
  [0x0430, 'CYRILLIC SMALL LETTER A', 'Ll, homoglyph of ASCII a'],
]
for (const [code, name, why] of REFUSED) {
  const label = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
  const message = rejectionOf(`look my ring ${String.fromCodePoint(code)}rob the bank`)
  ok(`${label} ${name} is refused (${why})`, message !== null)
  ok(`${label} says which code point and why`,
    message !== null && message.includes(label) && /cannot carry/.test(message),
    message ?? '(accepted)')
}

// Ordinary ASCII commands must still survive, or the rule above would be
// indistinguishable from a validator that refuses everything.
for (const command of [
  'look kobold',
  "appraise my father's sword",
  'assess 2nd rolton',
  'analyze a rust-flecked broadsword (in my cloak)',
  'inventory',
  'look "the" #4 [x] {y} <z> 50% ~ok~ a|b',
]) {
  ok(`printable ASCII survives: ${command}`, validateGameActionCommand(command) === command)
}

console.log('\n-- property: the rule is an allow-list, so no class can be left out --')
{
  // Deny-listing one class at a time is what let U+202E through. This sweeps
  // every code point Unicode has and asserts N of N, so a future revision
  // adding a format character cannot open the hole again. The counts are
  // printed because a sweep that silently examined nothing would otherwise be
  // indistinguishable from a sweep that found no failures.
  const FORMAT = /\p{Cf}/u
  let swept = 0
  let refused = 0
  let formats = 0
  let formatsRefused = 0
  for (let code = 0; code <= 0x10ffff; code++) {
    if (code >= 0x20 && code <= 0x7e) continue
    const character = String.fromCodePoint(code)
    swept += 1
    const isFormat = FORMAT.test(character)
    if (isFormat) formats += 1
    if (rejectionOf(`look ring${character}`) !== null) {
      refused += 1
      if (isFormat) formatsRefused += 1
    }
  }
  ok('every \\p{Cf} format character is refused',
    formats > 0 && formatsRefused === formats, `${formatsRefused} of ${formats}`)
  ok('and so is every other code point that is not printable ASCII',
    swept > 1_000_000 && refused === swept, `${refused} of ${swept}`)
  // A positive control on the sweep itself: the loop must be able to see an
  // acceptance, or "N of N refused" is what a broken validator also prints.
  ok('the sweep can tell acceptance from refusal',
    rejectionOf('look ringA') === null && rejectionOf(`look ring${String.fromCodePoint(0x202e)}`) !== null)
}

console.log('\n-- both application and native boundaries own the invariant --')
{
  const link = readFileSync('src/lib/gameLink.ts', 'utf8')
  const actions = readFileSync('src/lib/gameActions.ts', 'utf8')
  const native = readFileSync('src-tauri/src/game_link.rs', 'utf8')
  // Both call sites now carry a `source` as well, for the outbound command
  // lane (src-tauri/src/command_gate.rs). The property these three assert is
  // unchanged - validation happens before the value leaves the layer - and the
  // patterns are widened to the new argument list rather than loosened: a
  // pattern that stopped naming `validateGameCommand` would pass a version
  // that had dropped it.
  ok('the raw frontend transport validates before invoke',
    /invokeTauri\('game_send', \{ command: validateGameCommand\(command\), source \}\)/.test(link))
  ok('game-derived actions apply the stricter separator rule',
    /sendGame\(validateGameActionCommand\(command\), source\)/.test(actions))
  // Twice in Rust now, and both matter. `game_send` is the lane's entry, so it
  // refuses a framing violation at the call site where the caller can still be
  // told; `write_command` is the only thing that touches the socket, and it
  // validates again because a queue is a gap in time and the invariant has to
  // hold at the write, not only at the submission.
  ok('the native entry point validates before it queues anything',
    native.indexOf('validate_game_command(&command)?;') <
      native.indexOf('gate.submit(command, source)'))
  ok('the native command validates before locking or writing',
    native.indexOf('validate_game_command(command)?;') <
      native.indexOf('let mut guard = link.inner.lock().unwrap();'))
}

// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
ok('enough was checked for a pass to mean something', checked >= 60, `${checked} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall game-command boundary checks passed')
process.exit(failed ? 1 : 0)
