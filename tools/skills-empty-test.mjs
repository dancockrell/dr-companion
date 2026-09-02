/**
 * An empty skills list has two causes and they need different words.
 *
 * `skillsReady` is false only while DRInfomon's post-login startup is still
 * filling skills in. Empty during that window means "not asked yet"; empty
 * outside it means the payload does not carry skills at all.
 *
 * The bug this locks down was not a missing message, it was a false one.
 * `skillsReady` was sent by the bridge and declared on `CharacterStatus` with
 * a comment saying precisely what it was for, and nothing read it - so during
 * startup the Training panel told the player their bridge was too old to do
 * something it was in the middle of doing.
 *
 * That is why this file checks the whole chain rather than the function. A
 * correct `emptySkillsReason` that nobody calls is the same defect again, one
 * level along, and it would pass a test that only exercised the function.
 */
import { readFileSync } from 'node:fs'
import { emptySkillsReason } from '../src/data/skills.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(58)}${detail}`)
}

console.log('-- the rule --')
ok('false means waiting', emptySkillsReason(false) === 'waiting', emptySkillsReason(false))
ok('undefined is the old always-ready behaviour', emptySkillsReason(undefined) === 'unsupported', emptySkillsReason(undefined))
ok('true means the payload really has no skills', emptySkillsReason(true) === 'unsupported', emptySkillsReason(true))

// Undefined is deliberately not a third state; see CharacterStatus.skillsReady.
ok(
  'undefined and true agree, so the flag adds no third case',
  emptySkillsReason(undefined) === emptySkillsReason(true)
)

console.log('\n-- the producing side still sends it --')
const bridge = readFileSync(new URL('../lich-scripts/companion_bridge.lic', import.meta.url), 'utf8')
ok("the bridge emits a 'skillsReady' key", /'skillsReady'\s*=>/.test(bridge))
ok('CharacterStatus still declares it', /skillsReady\?:\s*boolean/.test(
  readFileSync(new URL('../src/types/index.ts', import.meta.url), 'utf8')
))

console.log('\n-- the consuming side still reads it --')
const panel = readFileSync(new URL('../src/components/shared/TrainingPanel.tsx', import.meta.url), 'utf8')
ok('TrainingPanel calls emptySkillsReason', panel.includes('emptySkillsReason('))
ok('and still has both messages to choose between',
  /Waiting for skills/.test(panel) && /No skill data/.test(panel))

// A function nobody calls is the bug this exists to prevent, so prove the
// check above can actually fail rather than trusting that it would.
console.log('\n-- controls --')
const sabotaged = panel.replace(/emptySkillsReason\(/g, 'somethingElse(')
if (sabotaged === panel) {
  failed++
  console.log('FAIL sabotage changed nothing - the call-site check proves nothing')
} else {
  ok('CONTROL: the call-site check fails when the call is removed',
    !sabotaged.includes('emptySkillsReason('))
}
ok('CONTROL: an unexpected value does not silently become "waiting"',
  emptySkillsReason(null) === 'unsupported', emptySkillsReason(null))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
