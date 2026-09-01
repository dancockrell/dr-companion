import assert from 'node:assert/strict'
import { resolveRoomPresentation } from '../src/lib/roomText.ts'
import { grokRoomScene } from '../src/data/grokRoomScenes.ts'

const wiki = { title: 'Static title', text: 'Clear daylight on a pristine road.' }
const live = { title: 'Current title', text: 'Rain lashes a road burning during an invasion.' }

assert.deepEqual(resolveRoomPresentation(live, 'Map title', wiki), live, 'live title and description win together')
assert.deepEqual(resolveRoomPresentation(null, 'Map title', wiki), {
  title: 'Map title', text: wiki.text,
}, 'map identity and static prose are used before live presentation arrives')
assert.deepEqual(resolveRoomPresentation({ title: null, text: 'Live prose' }, 'Map title', wiki), {
  title: 'Map title', text: 'Live prose',
}, 'a missing live title does not discard the live description')
assert.deepEqual(resolveRoomPresentation(null, null, null), { title: null, text: null }, 'absence stays absence')
assert.equal(grokRoomScene('1', 1, 'Meadow', 'A calm green meadow.'), null, 'a calm meadow cannot select the only storm scene')
assert.match(grokRoomScene('1', 1, 'Meadow', 'Rain and lightning lash the meadow.') ?? '', /storm-grassland/, 'live storm text permits storm art')
assert.doesNotMatch(grokRoomScene('1', 2, 'Market Square', 'Merchants trade beneath the noon sun.') ?? '', /night-market/, 'daytime text cannot select night art')

console.log('live room presentation: 7 checks passed')
