import { readFileSync } from 'node:fs'

const flowStop = readFileSync('src/lib/flowStop.ts', 'utf8')
const taskPanel = readFileSync('src/components/dashboard/TaskFlowPanel.tsx', 'utf8')
const footer = readFileSync('src/components/layout/SafetyFooter.tsx', 'utf8')

let failed = 0
let checks = 0
function check(name, condition) {
  checks += 1
  if (!condition) failed += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}`)
}

check('Stop all directly owns Python process termination', /stopTask\(\)/.test(flowStop))
check('Stop all directly owns TypeScript process termination', /stopNodeTask\(\)/.test(flowStop))
check('both termination attempts settle independently', /Promise\.allSettled\(\[stopTask\(\), stopNodeTask\(\)\]\)/.test(flowStop))
check('the hideable Tasks panel is not the Stop-all owner', !/onStopAll/.test(taskPanel))
check('the persistent safety readout announces state changes', /role="status"[\s\S]*aria-live="polite"/.test(footer))

console.log(failed ? `${failed} of ${checks} failed` : `stop-all lifetime: ${checks} assertions passed`)
process.exit(failed ? 1 : 0)
