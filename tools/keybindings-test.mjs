/**
 * Keyboard input, tested where it actually matters.
 *
 * Not "does the table have an entry for NumPad8" — the interesting cases are
 * the ones that would look fine in a demo and break the moment someone types
 * a sentence: a movement key firing while the player is composing a command,
 * and Escape being the one key that must reach them anyway.
 */
import { installKeybindings, isInteractionTarget, isTypingTarget, resolveKeybinding, codeToGenieKey } from '../src/lib/keybindings.ts'
import { readFileSync } from 'node:fs'

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

console.log('\n-- Escape stops when gameplay owns the keyboard --')
{
  ok('Escape while not typing stops', resolveKeybinding({ key: 'Escape', code: 'Escape' }, false), { kind: 'stop' })
}

console.log('\n-- Foreground interaction scopes suspend live-game shortcuts --')
{
  ok('bare Escape belongs to the foreground layer', resolveKeybinding({ key: 'Escape', code: 'Escape' }, true), null)
  ok('NumPad movement is suspended', resolveKeybinding({ key: '8', code: 'Numpad8' }, true), null)
  ok('Quick Switch is suspended', resolveKeybinding({ key: '1', code: 'Digit1' }, true), null)
  ok('the distinct emergency chord remains available', resolveKeybinding({ key: 'Escape', code: 'Escape', ctrlKey: true, shiftKey: true }, true), { kind: 'stop' })
  ok('Ctrl+Escape alone is not the emergency chord', resolveKeybinding({ key: 'Escape', code: 'Escape', ctrlKey: true }, true), null)
}

console.log('\n-- Interactive controls own gameplay-looking keys --')
{
  let selector = ''
  const target = { closest: (value) => { selector = value; return { tagName: 'BUTTON' } } }
  ok('a control detected through closest()', isInteractionTarget(target), true)
  ok('the ownership query covers controls and foreground scopes', selector.includes('button') && selector.includes('data-gameplay-shortcuts'), true)
  ok('a non-DOM target is not an interaction surface', isInteractionTarget({ tagName: 'DIV' }), false)
}

console.log('\n-- The installed listener respects the foreground boundary --')
{
  let listener
  let foregroundOpen = true
  let stopped = 0
  let sent = 0
  let switched = 0
  globalThis.window = {
    addEventListener: (_type, fn) => { listener = fn },
    removeEventListener: () => {},
  }
  globalThis.document = {
    querySelector: () => foregroundOpen ? {} : null,
  }
  const cleanup = installKeybindings({
    sendGame: () => { sent++ },
    stopAll: () => { stopped++ },
    quickSwitch: () => { switched++ },
  })
  const fire = (event) => listener({ preventDefault: () => {}, target: null, ctrlKey: false, shiftKey: false, ...event })
  fire({ key: 'Escape', code: 'Escape' })
  fire({ key: '8', code: 'Numpad8' })
  fire({ key: '1', code: 'Digit1' })
  ok('one foreground Escape causes zero Stop All calls', stopped, 0)
  ok('foreground movement sends zero game commands', sent, 0)
  ok('foreground digits cause zero Quick Switch calls', switched, 0)
  fire({ key: 'Escape', code: 'Escape', ctrlKey: true, shiftKey: true })
  ok('the emergency chord invokes Stop All exactly once', stopped, 1)
  foregroundOpen = false
  fire({ key: 'Escape', code: 'Escape' })
  ok('bare Escape resumes after the foreground closes', stopped, 2)
  cleanup()
}

console.log('\n-- Digit1..Digit9 switch Quick Switch slots, zero-indexed --')
{
  // code, not key: Shift+1 on a US layout still reports code "Digit1", and
  // the slot it should reach does not care whether Shift was held.
  const cases = [
    ['Digit1', 0], ['Digit2', 1], ['Digit3', 2], ['Digit4', 3], ['Digit5', 4],
    ['Digit6', 5], ['Digit7', 6], ['Digit8', 7], ['Digit9', 8],
  ]
  for (const [code, slot] of cases) {
    ok(`${code} -> slot ${slot}`, resolveKeybinding({ key: code, code }, false), { kind: 'quickswitch', slot })
  }
  ok('Digit0 is unbound — there is no slot 0 or 10', resolveKeybinding({ key: 'Digit0', code: 'Digit0' }, false), null)
  ok('a digit key does nothing while typing — "3" in a sentence is not a slot switch',
    resolveKeybinding({ key: '3', code: 'Digit3' }, true), null)
  // NumPad already owns movement; a top-row digit must not also walk, or
  // pressing "5" to reach slot 4 would collide with NumPad5's "out".
  ok('Digit5 does not collide with NumPad5 (out)', resolveKeybinding({ key: '5', code: 'Digit5' }, false), { kind: 'quickswitch', slot: 4 })
}

// installKeybindings itself is not tested here, deliberately rather than by
// omission: it calls the real global `window.addEventListener`, which does
// not exist in plain Node, and a mock would only be testing that the mock
// works. Its wiring — a real keydown reaching the real App-level hooks
// exactly once, cleaned up on unmount — is verified live in a browser
// against the running app instead, which is the only place "the real
// window" actually exists. Everything decided by resolveKeybinding and
// interaction ownership above it, which is where the actual logic lives, is
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

console.log('\n-- Every modal uses the shared accessible focus contract --')
{
  const modalHook = readFileSync(new URL('../src/lib/useModalDialog.ts', import.meta.url), 'utf8')
  for (const contract of ['role="dialog"', 'aria-modal="true"', 'aria-labelledby']) {
    const files = [
      'layout/SettingsSheet.tsx', 'layout/ReportDialog.tsx', 'config/ConfigManagerSheet.tsx',
      'dashboard/ScriptIconPicker.tsx', 'shared/PinEditor.tsx', 'shared/PlayerMarkerEditor.tsx',
    ]
    for (const file of files) {
      const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')
      ok(`${file} exposes ${contract}`, source.includes(contract), true)
      ok(`${file} uses the shared modal hook`, source.includes('useModalDialog'), true)
    }
  }
  ok('focus wraps forward at the last control', /document\.activeElement === last/.test(modalHook), true)
  ok('focus wraps backward at the first control', /document\.activeElement === first/.test(modalHook), true)
  ok('the background becomes inert', /sibling\.inert = true/.test(modalHook), true)
  ok('page scrolling is locked', /document\.body\.style\.overflow = 'hidden'/.test(modalHook), true)
  ok('only the top modal handles keys', /stack\.at\(-1\)/.test(modalHook), true)
  ok('focus returns to the opener', /opener\.focus\(\)/.test(modalHook), true)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
