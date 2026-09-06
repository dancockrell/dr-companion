import { readFileSync } from 'node:fs'

let checked = 0
let failed = 0
const check = (label, condition) => {
  checked++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (!condition) failed++
}

const editor = readFileSync('src/components/dashboard/ScriptEditor.tsx', 'utf8')
const connection = readFileSync('src/components/game/GameConnectionBar.tsx', 'utf8')

check('dirty close routes through an explicit decision', editor.includes("setDecision('close')") && editor.includes('Save and close') && editor.includes('Discard changes') && editor.includes('Keep editing'))
check('delete names the exact script and requires confirmation', editor.includes("setDecision('delete')") && editor.includes('Permanently delete {name}.') && editor.includes('`Delete ${name}`'))
check('delete is disabled while native deletion is in flight', editor.includes('if (deleting) return') && editor.includes('disabled={deleting}'))
check('failed deletion preserves the editor and reports the error', editor.includes('setNote(e instanceof Error ? e.message : String(e))') && editor.includes('setDeleting(false)'))
check('scrollback clearing requires a named irreversible confirmation', connection.includes("confirm('Clear all game scrollback? This cannot be undone. The live connection will stay attached.')"))

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 3
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failed} failed`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
