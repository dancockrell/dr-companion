/**
 * groupTasksByCategory (taskGrouping.ts) - the Tasks tab's presentation
 * grouping. Its only import is `import type { TaskInfo }`, fully erased at
 * compile time, so Node's native TS type-stripping can import it directly.
 */
import { groupTasksByCategory } from '../src/lib/taskGrouping.ts'

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!cond) failed++
}

const task = (id, category) => ({ id, title: id, summary: '', kind: 'sends commands', category })

console.log('-- an empty catalog groups to nothing --')
ok('no groups', groupTasksByCategory([]).length === 0)

console.log('')
console.log('-- adjacent same-category tasks join one group, in arrival order --')
const groups = groupTasksByCategory([
  task('flow.hunt', 'Combat'),
  task('flow.ambush', 'Combat'),
  task('flow.recover', 'Recovery'),
  task('task.watch', 'Utility'),
])
ok('three groups', groups.length === 3, JSON.stringify(groups.map((g) => g.category)))
ok(
  'Combat group keeps both tasks, in the order they arrived',
  groups[0].category === 'Combat' && groups[0].items.map((t) => t.id).join(',') === 'flow.hunt,flow.ambush',
  JSON.stringify(groups[0])
)
ok('Recovery group has exactly its one task', groups[1].category === 'Recovery' && groups[1].items.length === 1)
ok('Utility group has exactly its one task', groups[2].category === 'Utility' && groups[2].items.length === 1)

console.log('')
console.log('-- the same category appearing twice, NOT adjacently, is two groups --')
// This is what a caller that forgot to pre-sort the catalog would produce,
// and the function is documented to trust arrival order rather than re-sort
// - so this is the shape that proves it does not silently merge them back
// together, which would hide a real ordering bug on the Python side.
const scattered = groupTasksByCategory([
  task('flow.hunt', 'Combat'),
  task('flow.recover', 'Recovery'),
  task('flow.ambush', 'Combat'),
])
ok(
  'three groups, not two - Combat is not merged across the Recovery gap',
  scattered.length === 3,
  JSON.stringify(scattered.map((g) => g.category))
)

console.log('')
console.log('-- a single task is its own group --')
const single = groupTasksByCategory([task('user.mine', 'Custom')])
ok('one group, one item', single.length === 1 && single[0].items.length === 1)

console.log('')
console.log('-- the input array is not mutated --')
const original = [task('flow.hunt', 'Combat')]
const copy = JSON.stringify(original)
groupTasksByCategory(original)
ok('unchanged after grouping', JSON.stringify(original) === copy)

console.log('')
ok('enough was checked for a pass to mean something', checked >= 8, `${checked} assertions`)

console.log('')
console.log(failed === 0 ? 'all passed' : `${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
