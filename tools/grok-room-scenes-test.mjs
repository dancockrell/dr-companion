import { familyFor, grokRoomScene, stableSceneIndex } from '../src/data/grokRoomScenes.ts'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

let failures = 0
const check = (label, condition) => {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (!condition) failures++
}

check('an explicit town square still selects town art', familyFor('A busy town square') === 'town')
check('a guildleader office title selects institutional art', familyFor("Empaths' Guild, Guildleader's Office") === 'guildHall')
check('an unrecognized private interior has no invented family', familyFor('A narrow octagonal room with ivory panels') === null)
check('an unusual planar space has no invented family', familyFor('Colors fold through one another beneath a silent glass sky') === null)
check('unclassified rooms remain on the fingerprint fallback', grokRoomScene('67', 912, 'The Orrery', 'Brass rings turn without sound.') === null)
check('recognized rooms still receive reviewed art', grokRoomScene('1', 5, 'A Forest Path', 'Tall trees line the path.')?.startsWith('/grok-art/room-scenes/') === true)
check('incidental leather furniture cannot turn a private office into a leather workshop', grokRoomScene('1', 308, 'A Private Office', 'A massive mahogany desk faces a leather wing chair.') === null)
check('the demo guild office selects guild art instead of a leather workshop', /guild-hall/.test(grokRoomScene('1', 308, "Empaths' Guild, Guildleader's Office", 'A massive mahogany desk faces a leather wing chair.') ?? ''))
check('numeric neighbors are not forced into the same scene bucket', stableSceneIndex('1', 1, 97) !== stableSceneIndex('1', 2, 97))
check('the same room retains a stable scene bucket', stableSceneIndex('42', 701, 11) === stableSceneIndex('42', 701, 11))

const runtimeSources = ['src/data/grokRoomScenes.ts', 'src/data/roomScenePatterns.ts']
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
const runtimeArt = new Set(
  [...runtimeSources.matchAll(/\/grok-art\/room-scenes\/[^'"\s]+\.jpg/g)].map((match) => match[0])
)
for (const art of runtimeArt) check(`runtime art exists: ${art}`, existsSync(`public${art}`))

const curationFiles = [
  'data/art/grok-room-curation.json',
  'data/art/grok-room-landscape-expansion.json',
]
const curatedArt = new Set()
for (const path of curationFiles) {
  const registry = JSON.parse(readFileSync(path, 'utf8'))
  let completeSubjects = true
  for (const subject of Object.values(registry.subjects)) {
    completeSubjects &&= (
      typeof subject.exactSubject === 'string' && subject.exactSubject.length > 0
      && Array.isArray(subject.canonicalTraits) && subject.canonicalTraits.length > 0
      && typeof subject.habitat === 'string' && subject.habitat.length > 0
      && Object.hasOwn(subject, 'currentImage')
      && Array.isArray(subject.rejects) && subject.rejects.length > 0
      && typeof subject.regenerationNeeded === 'boolean'
    )
    for (const art of [subject.approvedPrimary, ...subject.approvedVariants].filter(Boolean)) curatedArt.add(art)
  }
  check(`${path} subjects have complete curation decisions`, completeSubjects)
}

const shippedArt = readdirSync('public/grok-art/room-scenes')
  .filter((name) => name.endsWith('.jpg'))
  .map((name) => `/grok-art/room-scenes/${name}`)
check('every shipped Grok room scene has a subject-level curation decision', shippedArt.every((art) => curatedArt.has(art)))
check('every approved Grok room scene exists', [...curatedArt].every((art) => existsSync(`public${art}`)))
check('every runtime Grok room scene is approved', [...runtimeArt].every((art) => curatedArt.has(art)))

const legacyFiles = ['public/rooms', 'public/room-scenes']
  .flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith('.webp')))
check('legacy low-resolution room libraries contain no WebP filler', legacyFiles.length === 0)
for (const dir of ['public/rooms', 'public/room-scenes']) {
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'))
  check(`${dir} manifest matches the empty retired library`, Array.isArray(manifest) && manifest.length === 0)
}
check('generated patterns cannot reintroduce a legacy room-art path', !/["']\/(?:rooms|room-scenes)\//.test(readFileSync('src/data/roomScenePatterns.ts', 'utf8')))

console.log(failures ? `\n${failures} failed` : '\nall Grok room scene checks passed')
process.exit(failures ? 1 : 0)
