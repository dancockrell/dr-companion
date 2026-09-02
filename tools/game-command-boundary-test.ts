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
ok('generated actions also inherit the one-line boundary',
  rejects(() => validateGameActionCommand('assess kobold\n;danger')))

console.log('\n-- both application and native boundaries own the invariant --')
{
  const link = readFileSync('src/lib/gameLink.ts', 'utf8')
  const actions = readFileSync('src/lib/gameActions.ts', 'utf8')
  const native = readFileSync('src-tauri/src/game_link.rs', 'utf8')
  ok('the raw frontend transport validates before invoke',
    /invokeTauri\('game_send', \{ command: validateGameCommand\(command\) \}\)/.test(link))
  ok('game-derived actions apply the stricter separator rule',
    /sendGame\(validateGameActionCommand\(command\)\)/.test(actions))
  ok('the native command validates before locking or writing',
    native.indexOf('validate_game_command(&command)?;') < native.indexOf('let mut guard = link.inner.lock().unwrap();'))
}

ok('enough was checked for a pass to mean something', checked >= 18, `${checked} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall game-command boundary checks passed')
process.exit(failed ? 1 : 0)
