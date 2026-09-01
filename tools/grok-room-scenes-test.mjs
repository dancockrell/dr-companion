import { familyFor, grokRoomScene, stableSceneIndex } from '../src/data/grokRoomScenes.ts'

let failures = 0
const check = (label, condition) => {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (!condition) failures++
}

check('an explicit town square still selects town art', familyFor('A busy town square') === 'town')
check('an unrecognized private interior has no invented family', familyFor('A narrow octagonal room with ivory panels') === null)
check('an unusual planar space has no invented family', familyFor('Colors fold through one another beneath a silent glass sky') === null)
check('unclassified rooms remain on the fingerprint fallback', grokRoomScene('67', 912, 'The Orrery', 'Brass rings turn without sound.') === null)
check('recognized rooms still receive reviewed art', grokRoomScene('1', 5, 'A Forest Path', 'Tall trees line the path.')?.startsWith('/grok-art/room-scenes/') === true)
check('numeric neighbors are not forced into the same scene bucket', stableSceneIndex('1', 1, 97) !== stableSceneIndex('1', 2, 97))
check('the same room retains a stable scene bucket', stableSceneIndex('42', 701, 11) === stableSceneIndex('42', 701, 11))

console.log(failures ? `\n${failures} failed` : '\nall Grok room scene checks passed')
process.exit(failures ? 1 : 0)
