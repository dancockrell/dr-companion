import assert from 'node:assert/strict'
import { roomArtSelection } from '../src/lib/roomText.ts'

const bramblesStart = roomArtSelection('6', 26, 'Brambles', 'A scarred living thorn barricade.')
assert.deepEqual(bramblesStart, { url: '/scene-art/reels/brambles/01.webp', layer: 'reviewed-reel' })
const bramblesAdvance = roomArtSelection('6', 29, 'Brambles', 'A smashed opening through the thicket.')
assert.deepEqual(bramblesAdvance, { url: '/scene-art/reels/brambles/02.webp', layer: 'reviewed-reel' })

const sewer = roomArtSelection('1', 295, 'Sewer', 'A foul underground channel.')
assert.equal(sewer.layer, 'grok-text')
assert.match(sewer.url ?? '', /grok-art\/room-scenes/)

const regional = roomArtSelection('47', 7, 'Street of Stoneworkers', 'A dry sandstone street.')
assert.equal(regional.layer, 'grok-place-pattern')
assert.match(regional.url ?? '', /grok-art\/room-scenes/)

const semantic = roomArtSelection('116', 108, 'Cavern', 'A rough underground cavern.')
assert.equal(semantic.layer, 'grok-text')
assert.match(semantic.url ?? '', /grok-art\/room-scenes/)

const conservative = roomArtSelection('1', 5, 'A Forest Path', 'Tall trees line the path.')
assert.equal(conservative.layer, 'grok-text')
assert.match(conservative.url ?? '', /grok-art\/room-scenes/)

for (const selection of [bramblesStart, bramblesAdvance, sewer, regional, semantic, conservative]) {
  assert.doesNotMatch(selection.url ?? '', /^\/(?:rooms|room-scenes)\//)
}

const unknown = roomArtSelection('67', 912, 'The Orrery', 'Brass rings turn without sound.')
assert.deepEqual(unknown, { url: null, layer: 'fingerprint' })

console.log('room art selection precedence passed')
