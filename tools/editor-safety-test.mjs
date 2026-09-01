import { readFileSync } from 'node:fs'

let failed = 0
const check = (label, condition) => {
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

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
