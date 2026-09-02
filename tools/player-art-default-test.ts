import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  profiledPlayerDefaultFor,
  registerBulkNpcManifest,
  registerNpcDefaultManifest,
  resetBulkNpcCache,
  resetNpcDefaultCache,
} from '../src/lib/npcDefaults.ts'

resetNpcDefaultCache()
resetBulkNpcCache()

// A prettier but race-neutral hand-curated image exists. A fully profiled
// player must still choose the exact race + role + gender bulk portrait.
registerNpcDefaultManifest({ 'warrior-male': ['curated.webp'] })
registerBulkNpcManifest([
  'npc-guard-gor-tog-male-01.webp',
  'npc-guard-human-male-01.webp',
])

const profiled = profiledPlayerDefaultFor('warrior', 'gor-tog', 'male', 'Aric')
assert.equal(profiled?.url, '/npcs/npc-guard-gor-tog-male-01.webp')

const playerArt = readFileSync(new URL('../src/lib/playerArt.ts', import.meta.url), 'utf8')
const mockBridge = readFileSync(new URL('../src/bridge/mockBridge.ts', import.meta.url), 'utf8')
assert.match(playerArt, /export function registerPlayerProfiles/)
assert.match(playerArt, /profiledPlayerDefaultFor\(role, race, sex, name\)/)
assert.match(playerArt, /portraitUrl\(`\$\{portraitSlug\(race\)\}-\$\{sex\}`\)/)
assert.match(playerArt, /genericPortraitFor\(name\)/)
assert.match(mockBridge, /DEMO_INVASION_PLAYER_PROFILES/)
assert.match(mockBridge, /registerPlayerProfiles\(DEMO_INVASION_PLAYER_PROFILES\)/)
for (const fact of ["Gor'", "S'", 'Kaldar', 'Elothean', 'Prydaen', 'Rakash', 'Barbarian', 'Moon Mage', 'Bard']) {
  assert.ok(mockBridge.includes(fact), `mock portrait profiles should exercise ${fact}`)
}

console.log('player art profile defaults passed')
