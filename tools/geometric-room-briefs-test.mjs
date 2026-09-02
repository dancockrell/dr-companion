import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1 }
const pass = (message) => console.log(`OK   ${message}`)

execFileSync(process.execPath, ['tools/build-geometric-room-briefs.mjs'], { stdio: 'inherit' })
const outputPath = 'data/art/out/geometric-room-briefs.json'
if (!existsSync(outputPath)) fail('compiler writes its full generated catalogue')
else {
  const result = JSON.parse(readFileSync(outputPath, 'utf8'))
  const source = JSON.parse(readFileSync('data/art/room-prompts-priority.json', 'utf8'))
  const crossingNorth = result.briefs.find((brief) => brief.id === '1::Town Green North')
  const crossingNorthRoom = result.roomBriefs.find((brief) => brief.id === '1-14')
  const guild = result.briefs.find((brief) => brief.id === "1::Guildleader's Office")
  const market = result.briefs.find((brief) => brief.id === "1::Traders' Market")
  const water = result.briefs.find((brief) => brief.id === '1::Trollferry Quay')

  if (result.counts.describedPlaces !== Object.keys(source).length) fail('every authored description receives one brief')
  else pass(`every authored description receives one brief (${result.counts.describedPlaces})`)
  if (result.counts.roomBindings >= 17000) pass(`room graph bindings are retained (${result.counts.roomBindings})`)
  else fail('all known map room bindings are exported')
  if (result.counts.describedRoomBriefs > 10000 && result.roomBriefs.length === result.counts.roomBindings) pass(`each mapped room receives a distinct cell brief or an explicit unresolved record (${result.counts.describedRoomBriefs} described)`)
  else fail('room cells are not all represented in the generated catalogue')
  if (!crossingNorth?.prompt?.includes('\n\n') || crossingNorth.prompt.split('\n\n').length !== 2) fail('Town Green North has exactly two prose prompt paragraphs')
  else pass('Town Green North has exactly two prose prompt paragraphs')
  if (!crossingNorth?.prompt?.includes('bent grass') || !crossingNorth.prompt.includes('privet hedge')) fail('Town Green North prompt retains authored room facts')
  else pass('Town Green North prompt retains authored room facts')
  if (crossingNorthRoom?.briefStatus === 'described' && crossingNorthRoom.prompt?.split('\n\n').length === 2 && crossingNorthRoom.map?.name) pass('Town Green North has its own graph-aware room-cell brief')
  else fail('Town Green North has no graph-aware room-cell brief')
  if (guild?.classification?.tier === 'special' && guild.classification.tags.includes('guild')) pass('guilds are placed in the special queue')
  else fail('guilds are classified as special')
  if (market?.classification?.tier === 'special' && market.classification.tags.includes('market')) pass('markets are placed in the special queue')
  else fail('markets are classified as special')
  if (water?.classification?.tags.includes('water')) pass('waterfronts retain water-specific treatment')
  else fail('waterfronts retain water-specific treatment')
  if (result.specialPlaceIds.length > 100) pass(`special-place queue is substantial (${result.specialPlaceIds.length})`)
  else fail('special-place queue is too small')
  if (result.featurePlaceIds.length > 100) pass(`bridge/water/interior feature queue is substantial (${result.featurePlaceIds.length})`)
  else fail('feature-place queue is too small')
  if (result.missingDescriptions.every((binding) => binding.briefStatus === 'missing-description')) pass('missing descriptions remain explicit rather than receiving invented briefs')
  else fail('missing descriptions are not honest')
}
