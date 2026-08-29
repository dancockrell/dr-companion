/**
 * Keyboard input, tested where it actually matters.
 *
 * Not "does the table have an entry for NumPad8" — the interesting cases are
 * the ones that would look fine in a demo and break the moment someone types
 * a sentence: a movement key firing while the player is composing a command,
 * and Escape being the one key that must reach them anyway.
 */
import { isTypingTarget, resolveKeybinding, codeToGenieKey } from '../src/lib/keybindings.ts'

let failed = 0
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(60)}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`
  )
}

console.log('-- isTypingTarget recognises where text goes --')
{
  ok('an input', isTypingTarget({ tagName: 'INPUT' }), true)
  ok('a textarea', isTypingTarget({ tagName: 'TEXTAREA' }), true)
  ok('contenteditable', isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  ok('a plain div', isTypingTarget({ tagName: 'DIV' }), false)
  ok('a button', isTypingTarget({ tagName: 'BUTTON' }), false)
  ok('null', isTypingTarget(null), false)
}

console.log('\n-- NumPad movement, read off Dan\'s Genie config --')
{
  const cases = [
    ['Numpad8', 'n'], ['Numpad2', 's'], ['Numpad4', 'w'], ['Numpad6', 'e'],
    ['Numpad7', 'nw'], ['Numpad9', 'ne'], ['Numpad1', 'sw'], ['Numpad3', 'se'],
    ['NumpadDecimal', 'up'], ['Numpad0', 'down'], ['Numpad5', 'out'],
  ]
  for (const [code, command] of cases) {
    ok(`${code} -> ${command}`, resolveKeybinding({ key: code, code }, false), { kind: 'game', command })
  }
}

console.log('\n-- F-keys --')
{
  ok('F1 -> look @', resolveKeybinding({ key: 'F1', code: 'F1' }, false), { kind: 'game', command: 'look @' })
  ok('F2 -> health', resolveKeybinding({ key: 'F2', code: 'F2' }, false), { kind: 'game', command: 'health' })
  ok('F4 -> skills', resolveKeybinding({ key: 'F4', code: 'F4' }, false), { kind: 'game', command: 'skills' })
  ok('F3 is unbound (Dan\'s config never binds it)', resolveKeybinding({ key: 'F3', code: 'F3' }, false), null)
}

console.log('\n-- A bound key does nothing while the player is typing --')
{
  // This is the property most likely to be missing and most likely to
  // matter: without it, typing a sentence containing a bound key walks the
  // character instead of finishing the sentence. Tested against real bound
  // keys (NumPad and F-keys), not a letter key — nothing here is bound to a
  // literal letter, so plain text was never at risk; the actual keys that
  // could misfire mid-sentence are these.
  ok('NumPad8 while typing sends nothing', resolveKeybinding({ key: '8', code: 'Numpad8' }, true), null)
  ok('F2 while typing sends nothing', resolveKeybinding({ key: 'F2', code: 'F2' }, true), null)
  ok('an unbound key while typing is still nothing', resolveKeybinding({ key: 'a', code: 'KeyA' }, true), null)
}

console.log('\n-- Escape is the one exception: it works even while typing --')
{
  ok('Escape while not typing stops', resolveKeybinding({ key: 'Escape', code: 'Escape' }, false), { kind: 'stop' })
  ok('Escape while typing still stops', resolveKeybinding({ key: 'Escape', code: 'Escape' }, true), { kind: 'stop' })
}

// installKeybindings itself is not tested here, deliberately rather than by
// omission: it calls the real global `window.addEventListener`, which does
// not exist in plain Node, and a mock would only be testing that the mock
// works. Its wiring — a real keydown reaching the real App-level hooks
// exactly once, cleaned up on unmount — is verified live in a browser
// against the running app instead, which is the only place "the real
// window" actually exists. Everything decided by resolveKeybinding and
// isTypingTarget above it, which is where the actual logic lives, is
// covered here.

console.log('\n-- codeToGenieKey matches every key name Dan\'s real macros.cfg actually uses --')
{
  const cases = [
    ['F1', 'F1'], ['F9', 'F9'], ['F12', 'F12'],
    ['Numpad0', 'NumPad0'], ['Numpad9', 'NumPad9'],
    ['NumpadDecimal', 'Decimal'], ['NumpadMultiply', 'Multiply'],
    ['NumpadAdd', 'Add'], ['NumpadSubtract', 'Subtract'], ['NumpadDivide', 'Divide'],
    ['Escape', 'Escape'],
    ['KeyD', 'D'], ['KeyZ', 'Z'],
    ['Digit0', 'D0'], ['Digit9', 'D9'],
  ]
  for (const [code, want] of cases) ok(`${code} -> ${want}`, codeToGenieKey(code), want)
}
console.log('\n-- codeToGenieKey refuses codes no macro in the corpus binds --')
{
  ok('ShiftLeft is a modifier, not a key', codeToGenieKey('ShiftLeft'), null)
  ok('ControlLeft is a modifier, not a key', codeToGenieKey('ControlLeft'), null)
  ok('Tab is unmapped (nothing in the file binds it)', codeToGenieKey('Tab'), null)
  ok('F13 does not exist in the observed corpus', codeToGenieKey('F13'), null)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
