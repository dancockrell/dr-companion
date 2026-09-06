// Custom (player-supplied) portrait contract.
//
// Every assertion below was a top-level `assert.match(...)`, which has two
// costs the rest of the suite does not pay: the run stops at the first
// failure, so one broken pattern hides every later one; and it prints nothing
// per check, so `tools/run-tests.mjs` - which counts `OK`/`FAIL` lines -
// recorded this file as **zero checks**. Zero checks is indistinguishable
// from a file that asserted nothing, which is why the runner calls that state
// NOT RUN. The assertions are unchanged; they are now counted, and all of
// them run.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const native = read('src-tauri/src/custom_portraits.rs')
const commands = read('src-tauri/src/lib.rs')
const portrait = read('src/components/shared/Portrait.tsx')
const editor = read('src/components/shared/CustomPortraitEditor.tsx')
const processing = read('src/lib/customPortraits.ts')
const choices = read('src/lib/portraits.ts')
const battle = read('src/components/room/BattleColumn.tsx')
const docs = read('docs/PLAYER-ART.md')

let pass = 0
let fail = 0
const check = (label, fn) => {
  try {
    fn()
    console.log(`OK   ${label}`)
    pass++
  } catch (e) {
    console.log(`FAIL ${label} - ${String(e.message).split('\n')[0]}`)
    fail++
  }
}

check('the native store caps a stored portrait at 1 MB', () =>
  assert.match(native, /const MAX_BYTES: usize = 1_000_000/))
check('the native store caps a stored portrait at 2048px', () =>
  assert.match(native, /const MAX_DIMENSION: u16 = 2048/))
check('the identity hash is case- and whitespace-insensitive on the instance', () =>
  assert.match(native, /hash\.update\(instance\.trim\(\)\.to_lowercase\(\)\)/))
check('an unreadable stored image reads back as absent rather than erroring', () =>
  assert.match(native, /if validate\(&bytes\)\.is_err\(\)\s*\{\s*return Ok\(None\);\s*\}/))
check('a save writes through a temp file', () => assert.match(native, /webp\.tmp/))
check('a save keeps the previous image as a backup', () => assert.match(native, /webp\.bak/))
for (const command of ['save_custom_portrait', 'read_custom_portrait', 'remove_custom_portrait']) {
  check(`${command} is registered with Tauri`, () =>
    assert.match(commands, new RegExp(`custom_portraits::${command}`), `${command} must be registered with Tauri`))
}

check('the browser side refuses a source file over 20 MB', () =>
  assert.match(processing, /MAX_SOURCE_BYTES = 20_000_000/))
check('the browser side refuses a source image over 12000px', () =>
  assert.match(processing, /MAX_SOURCE_DIMENSION = 12_000/))
check('the object URL for the source image is revoked', () =>
  assert.match(processing, /URL\.revokeObjectURL\(url\)/))
check('the processed portrait is encoded as webp', () =>
  assert.match(processing, /toDataURL\('image\/webp'/))
check('portrait choice keys are lowercased on both character and instance', () =>
  assert.match(choices, /instance\.toLowerCase\(\).*character\.toLowerCase\(\)/))
check('clearing a choice deletes the identity key rather than blanking it', () =>
  assert.match(choices, /delete all\[identity\(character, instance\)\]/))
check('the battle column passes the character instance through', () =>
  assert.match(battle, /instance: character\.instance/))

check('the editor accepts a file picked from disk', () => assert.match(editor, /type="file"/))
check('the editor accepts a dropped file', () => assert.match(editor, /onDrop=/))
check('the editor accepts a pasted image', () => assert.match(editor, /onPaste=/))
check('the editor previews the dashboard crop', () => assert.match(editor, /Dashboard portrait preview/))
check('the editor previews the combat radar crop', () => assert.match(editor, /Combat radar portrait preview/))
check('the editor exposes zoom', () => assert.match(editor, /Zoom/))
check('the editor exposes horizontal framing', () => assert.match(editor, /Left \/ right/))
check('the editor exposes vertical framing', () => assert.match(editor, /Up \/ down/))
check('a stored portrait can be replaced or re-cropped', () =>
  assert.match(portrait, /Replace or re-crop your image/))
check('a stored portrait can be removed', () => assert.match(portrait, /Remove local image/))
check('a portrait can be reset to the automatic default', () =>
  assert.match(portrait, /Reset to automatic default/))
check('the UI says local images stay on this machine', () =>
  assert.match(portrait, /Local images stay private on this machine/))
check('portrait fallback is scoped to the image that failed', () =>
  assert.match(portrait, /failedSource === preferredUrl/, 'portrait fallback must be scoped to the image that failed'))
check('portrait errors record the failed image source', () =>
  assert.match(portrait, /setFailedSource\(preferredUrl\)/, 'portrait errors must record the failed image source'))
check('an old image failure does not poison later portrait sources', () =>
  assert.doesNotMatch(portrait, /const \[failed, setFailed\]/, 'an old image failure must not poison later portrait sources'))
check('portrait chooser art decodes without blocking and loads on demand', () =>
  assert.match(portrait, /loading="lazy"\s+decoding="async"/, 'portrait chooser art should decode without blocking and load on demand'))
check('the docs promise a portrait is never uploaded, committed or published', () =>
  assert.match(docs, /never uploads, commits, or publishes/))
check('the docs name the separate reviewed process for shipped art', () =>
  assert.match(docs, /separate, reviewed repository process/))

console.log('')
const total = pass + fail
// Far below the real count (34) on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 23
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `total`, not `pass`: the denominator has to be the number of checks that
// ran, or it shrinks by one per failure and reports a smaller suite on
// exactly the run where you need to know the size did not change.
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('custom portrait contract passed')
