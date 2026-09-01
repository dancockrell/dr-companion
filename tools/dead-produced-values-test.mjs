import { readFileSync } from 'node:fs'

const sources = [
  'src/data/obstacles.ts',
  'src/data/skills.ts',
  'src/data/scriptCatalog.ts',
  'src/data/training.ts',
].map((path) => readFileSync(path, 'utf8')).join('\n')

const retired = [
  'PROVINCES', 'OBSTACLES', 'TRANSPORT_LEGS', 'checkObstacle',
  'skillSetFor', 'isMindLocked', 'isSaturated', 'isAbsorbing',
  'scriptsByCategory', 'filterTrainFocusForTier', 'describeTrainingPlan',
]
let failed = 0
let checked = 0
const ok = (label, condition) => {
  checked++
  if (!condition) failed++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
}

for (const name of retired) {
  ok(`${name} is not produced without a consumer`, !new RegExp(`\\b${name}\\b`).test(sources))
}

const soundControls = readFileSync('src/components/game/SoundControls.tsx', 'utf8')
ok('resetAlerts has a real UI consumer', /resetAlerts\(\)/.test(soundControls))
ok('enough inventory decisions were checked', checked >= 12)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
