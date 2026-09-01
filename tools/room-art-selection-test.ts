import assert from 'node:assert/strict'
import { roomArtSelection } from '../src/lib/roomText.ts'

const curated = roomArtSelection('1', 295, 'Sewer', 'A foul underground channel.')
assert.equal(curated.layer, 'curated')
assert.match(curated.url ?? '', /curated-crossing-sewer/)

const regional = roomArtSelection('47', 7, 'Street of Stoneworkers', 'A dry sandstone street.')
assert.equal(regional.layer, 'regional-or-semantic')
assert.match(regional.url ?? '', /town-muspar-i-city-street/)

const semantic = roomArtSelection('116', 108, 'Cavern', 'A rough underground cavern.')
assert.equal(semantic.layer, 'curated')
assert.match(semantic.url ?? '', /archetype-cavern/)

const conservative = roomArtSelection('1', 5, 'A Forest Path', 'Tall trees line the path.')
assert.equal(conservative.layer, 'text-fallback')
assert.match(conservative.url ?? '', /grok-art\/room-scenes/)

const unknown = roomArtSelection('67', 912, 'The Orrery', 'Brass rings turn without sound.')
assert.deepEqual(unknown, { url: null, layer: 'fingerprint' })

console.log('room art selection precedence passed')
