import assert from 'node:assert/strict'
import { resolveRoomPresentation } from '../src/lib/roomText.ts'
import { grokRoomScene } from '../src/data/grokRoomScenes.ts'

const wiki = { title: 'Static title', text: 'Clear daylight on a pristine road.' }
const live = { title: 'Current title', text: 'Rain lashes a road burning during an invasion.' }

let checks = 0
function check(label: string, assertion: () => void) {
  try {
    assertion()
    checks++
    console.log(`OK   ${label}`)
  } catch (error) {
    console.error(`FAIL ${label}`)
    throw error
  }
}

check('live title and description win together', () => assert.deepEqual(resolveRoomPresentation(live, 'Map title', wiki), live))
check('map identity and static prose are used before live presentation arrives', () => assert.deepEqual(resolveRoomPresentation(null, 'Map title', wiki), {
  title: 'Map title', text: wiki.text,
}))
check('a missing live title does not discard the live description', () => assert.deepEqual(resolveRoomPresentation({ title: null, text: 'Live prose' }, 'Map title', wiki), {
  title: 'Map title', text: 'Live prose',
}))
check('absence stays absence', () => assert.deepEqual(resolveRoomPresentation(null, null, null), { title: null, text: null }))
check('a calm meadow selects neutral meadow art instead of the storm scene', () => {
  const art = grokRoomScene('1', 1, 'Meadow', 'A calm green meadow.')
  assert.match(art ?? '', /mountain-meadow/)
  assert.doesNotMatch(art ?? '', /storm/)
})
check('live storm text permits storm art', () => assert.match(grokRoomScene('1', 1, 'Meadow', 'Rain and lightning lash the meadow.') ?? '', /storm-grassland/))
check('daytime text cannot select night art', () => assert.doesNotMatch(grokRoomScene('1', 2, 'Market Square', 'Merchants trade beneath the noon sun.') ?? '', /night-market/))

console.log(`live room presentation: ${checks} checks passed`)
