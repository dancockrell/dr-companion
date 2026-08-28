/**
 * pinTaskGenerator.ts - turning a pin into a real python/tasks/user/*.py
 * file. Its only import is `import type { MapPin }`, which is fully erased
 * at compile time, so Node's native TS type-stripping can import the file
 * directly - no transpile-to-tempdir needed, unlike mapPins.ts/pinNudge.ts.
 */
import { taskNameForPin, uniqueTaskName, pinTaskSource } from '../src/lib/pinTaskGenerator.ts'

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!cond) failed++
}

const pin = (over = {}) => ({
  id: '1', roomId: 4821, zone: '1', label: 'Bank', color: 'gold', createdAt: 0, ...over,
})

console.log('-- task naming --')
ok('a simple label slugifies cleanly', taskNameForPin(pin()) === 'walk_to_bank', taskNameForPin(pin()))
ok(
  'spaces and punctuation become underscores',
  taskNameForPin(pin({ label: "Bob's Bank & Trust!" })) === 'walk_to_bob_s_bank_trust',
  taskNameForPin(pin({ label: "Bob's Bank & Trust!" }))
)
ok(
  'an empty label still produces a valid name',
  taskNameForPin(pin({ label: '   ' })) === 'walk_to_pin',
  taskNameForPin(pin({ label: '   ' }))
)

console.log('')
console.log('-- collision avoidance: never silently overwrites --')
ok('no collision, the plain name wins', uniqueTaskName([], pin()) === 'walk_to_bank')
ok('one collision, appends _2', uniqueTaskName(['walk_to_bank'], pin()) === 'walk_to_bank_2')
ok(
  'several collisions, finds the first free slot',
  uniqueTaskName(['walk_to_bank', 'walk_to_bank_2', 'walk_to_bank_3'], pin()) === 'walk_to_bank_4'
)
ok(
  'a gap is not required to be contiguous - just the first free number',
  uniqueTaskName(['walk_to_bank', 'walk_to_bank_3'], pin()) === 'walk_to_bank_2',
  uniqueTaskName(['walk_to_bank', 'walk_to_bank_3'], pin())
)

console.log('')
console.log('-- the generated source --')
const src = pinTaskSource(pin())
ok('names the room in a comment/docstring', src.includes('4821'))
ok('names the pin label', src.includes('Bank'))
ok('imports Task from drtask', src.includes('from drtask import Task'))
ok('calls walk_to with the room id', src.includes('self.walk_to(4821)'))
ok('stops itself rather than hanging in the listen loop', src.includes('self.stop()'))
ok('defines main() returning something with .run() - the README\'s own contract', /def main\(\):\s*\n\s*return \w+\(\)/.test(src))
ok(
  'the class name is a valid Python identifier even for a punctuation-heavy label',
  (() => {
    const weird = pinTaskSource(pin({ label: "221B Baker's!!" }))
    const m = weird.match(/^class (\w+)\(Task\):/m)
    return !!m && /^[A-Za-z_]\w*$/.test(m[1])
  })()
)
ok(
  'does not claim write_script asks before overwriting - it does not (src-tauri/src/scripts.rs)',
  !src.toLowerCase().includes('ask before overwrit')
)

console.log('')
console.log('-- python syntax sanity (a human, not a parser, but catches gross breakage) --')
ok('balanced parens', (src.match(/\(/g) ?? []).length === (src.match(/\)/g) ?? []).length)
ok('balanced triple-quotes', (src.match(/"""/g) ?? []).length % 2 === 0)

ok('enough was checked for a pass to mean something', checked >= 12, `${checked} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
