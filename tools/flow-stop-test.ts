import { readFileSync } from 'node:fs'
import { stopAllTaskBackends } from '../src/lib/stopAllTasks.ts'

let failed = 0
let checked = 0

function ok(name: string, condition: boolean, detail = '') {
  checked += 1
  if (!condition) failed += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
}

console.log('-- Stop all owns both backend requests --')
{
  const called: string[] = []
  const results = await stopAllTaskBackends(
    async () => { called.push('python') },
    async () => { called.push('typescript') }
  )
  ok('Python is stopped', called.includes('python'))
  ok('TypeScript is stopped', called.includes('typescript'))
  ok('both calls settle successfully', results.every((result) => result.status === 'fulfilled'))
}

console.log('\n-- one broken backend cannot block the other --')
{
  const called: string[] = []
  const results = await stopAllTaskBackends(
    async () => {
      called.push('python')
      throw new Error('simulated Python stop failure')
    },
    async () => { called.push('typescript') }
  )
  ok('the failing Python stop was attempted', called.includes('python'))
  ok('TypeScript was still stopped', called.includes('typescript'))
  ok('the failure is contained as a settled result', results[0]?.status === 'rejected')
  ok('the independent stop still succeeds', results[1]?.status === 'fulfilled')
}

console.log('\n-- Stop does not live in a hideable panel --')
{
  const panel = readFileSync('src/components/dashboard/TaskFlowPanel.tsx', 'utf8')
  const owner = readFileSync('src/lib/flowStop.ts', 'utf8')
  const footer = readFileSync('src/components/layout/SafetyFooter.tsx', 'utf8')
  ok('TaskFlowPanel has no Stop-all subscription', !panel.includes('onStopAll'))
  ok('the module-level owner calls both backend functions',
    /stopAllTaskBackends\(stopTask, stopNodeTask\)/.test(owner))
  ok('the safety readout announces state changes',
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-atomic="true"/.test(footer))
}

ok('enough was checked for a pass to mean something', checked >= 10, `${checked} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall Stop-all checks passed')
process.exit(failed ? 1 : 0)
