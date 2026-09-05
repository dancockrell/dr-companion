/**
 * Compiles src/data/appearanceDefaults.json: which mesh, if any, the viewer
 * should hold in an entity's hand or put on its body.
 *
 * A generator rather than a hand-written table, for the reason
 * docs/THREE_D_REBUILD_HANDOFF.md section 11 gives: the class vocabularies
 * already exist and are already tested, so a second hand-maintained copy of
 * either would be free to drift from the one the rest of the app uses.
 *
 *   weapon classes  <- SKILLS_BY_SET.Weapon (src/data/skills.ts), minus the
 *                      meta-skills that name no object
 *   armour classes  <- ARMOR_COVERAGE (src/lib/armorLoadout.ts)
 *   ids             <- selections[].id (godot/assets/shared_asset_selections.json)
 *
 * The one thing genuinely authored here is CLASS_MODEL_IDS: which admitted
 * registry asset stands for each class. Everything else is derived.
 *
 *   node tools/build-appearance-defaults.mjs           # write the JSON
 *   node tools/build-appearance-defaults.mjs --check   # fail on drift
 *
 * # Why nearly everything is null today, and why that is the right answer
 *
 * The registry admits two ids and both are scenery. There is no weapon mesh
 * and no armour mesh to point at. Section 11 and the registry's own
 * `admission.forbiddenSubstitutions` both say the same thing about that: a
 * generic mesh must not stand in for a named thing, so an unmapped class
 * resolves to null and the viewer shows its neutral token. A "generic sword"
 * for a class nobody has made art for is exactly the substitution that rule
 * forbids, one scale down from a generic guild hall.
 *
 * That makes the id assertion below vacuous today - zero ids emitted, zero
 * ids checked - which is the shape of check that reports success for work it
 * never did. So it is not left to be trusted: `assertRegistryReaderWorks`
 * runs the same predicate against an id the registry certainly contains, and
 * the summary prints the denominator rather than only the verdict.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { SKILLS_BY_SET } from '../src/data/skills.ts'
import { ARMOR_COVERAGE } from '../src/lib/armorLoadout.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const REGISTRY_PATH = 'godot/assets/shared_asset_selections.json'
const OUTPUT_PATH = 'src/data/appearanceDefaults.json'

/**
 * Weapon skills that name a way of fighting rather than a thing you hold.
 * Nothing can be worn or wielded that "is a Melee Mastery", so none of these
 * can own a mesh. Named here rather than pattern-matched on the word
 * "Mastery" so that a future skill list change is a visible conflict instead
 * of a silent reclassification.
 */
const META_WEAPON_SKILLS = new Set([
  'Parry Ability',
  'Offhand Weapon',
  'Melee Mastery',
  'Missile Mastery',
  'Expertise',
])

/**
 * Item nouns to weapon class.
 *
 * Longest phrase wins, so "bastard sword" resolves to Large Edged and never
 * falls through to the bare "sword" entry below it. Anything absent resolves
 * to no class at all - see `classify`.
 */
const WEAPON_NOUNS = {
  'Small Edged': [
    'dagger', 'knife', 'dirk', 'stiletto', 'kris', 'shortsword', 'short sword',
    'rapier', 'main gauche', 'parrying blade', 'hand axe', 'handaxe', 'hatchet',
  ],
  'Large Edged': [
    'sword', 'broadsword', 'broad sword', 'longsword', 'long sword', 'bastard sword',
    'scimitar', 'sabre', 'saber', 'cutlass', 'falchion', 'katana', 'backsword',
    'battle axe', 'battleaxe', 'war axe', 'waraxe',
  ],
  'Twohanded Edged': [
    'claymore', 'zweihander', 'greatsword', 'great sword', 'twohanded sword',
    'two-handed sword', 'no-dachi', 'nodachi', 'greataxe', 'great axe',
    'twohanded axe', 'two-handed axe',
  ],
  'Small Blunt': [
    'club', 'cudgel', 'sap', 'blackjack', 'hammer', 'mallet', 'truncheon',
  ],
  'Large Blunt': [
    'mace', 'morning star', 'morningstar', 'war hammer', 'warhammer', 'flail',
  ],
  'Twohanded Blunt': [
    'maul', 'great hammer', 'greatmaul', 'twohanded mace', 'two-handed mace',
    'war mattock', 'mattock',
  ],
  Slings: ['sling', 'staff sling', 'staffsling'],
  Bow: [
    'bow', 'shortbow', 'short bow', 'longbow', 'long bow', 'composite bow',
    'recurve bow',
  ],
  Crossbow: ['crossbow', 'arbalest', 'light crossbow', 'heavy crossbow'],
  Staves: ['staff', 'quarterstaff', 'quarter staff', 'runestaff', 'walking stick'],
  Polearms: [
    'halberd', 'pike', 'awl-pike', 'lance', 'spear', 'glaive', 'naginata',
    'bardiche', 'poleaxe', 'polearm', 'pole-arm', 'trident',
  ],
  'Light Thrown': [
    'dart', 'throwing knife', 'throwing blade', 'discus', 'shuriken',
  ],
  'Heavy Thrown': [
    'javelin', 'throwing axe', 'throwing hammer', 'bola', 'bolas', 'harpoon',
  ],
  Brawling: [
    'cestus', 'knuckle-duster', 'brass knuckles', 'katar', 'punch dagger',
    'tiger claw',
  ],
}

/**
 * Class to registry id. Empty of ids on purpose: the registry currently
 * admits only scenery, and pointing a weapon class at a rock would be the
 * substitution `admission.forbiddenSubstitutions` forbids.
 *
 * Admitting a mesh is two steps and this is the second: Codex adds the
 * selection to the registry, then one line here. The assertion below refuses
 * any id the registry does not actually contain, so a typo fails the build
 * instead of shipping as a mesh that silently never loads.
 */
const CLASS_MODEL_IDS = {}

/** Every id the registry admits, and nothing else. */
function registryIds(registry) {
  return new Set((registry.selections ?? []).map((s) => s.id))
}

/**
 * A zero here would otherwise be indistinguishable from a broken reader, and
 * with no ids emitted the real assertion checks nothing at all. So prove the
 * predicate can find something before trusting it to find nothing.
 */
function assertRegistryReaderWorks(ids, registry) {
  if (ids.size === 0) {
    throw new Error(
      `${REGISTRY_PATH}: read 0 ids. Either the registry is empty or selections[] moved; ` +
        'either way the id assertion below would pass vacuously.'
    )
  }
  const control = (registry.selections ?? [])[0]?.id
  if (!control || !ids.has(control)) {
    throw new Error(
      `positive control failed: selections[0].id (${control ?? 'missing'}) is not in the id set the ` +
        'assertion uses, so the assertion cannot be trusted to reject anything either.'
    )
  }
  const forbidden = registry.admission?.forbiddenSubstitutions
  if (!Array.isArray(forbidden) || forbidden.length === 0) {
    throw new Error(
      `${REGISTRY_PATH}: admission.forbiddenSubstitutions is missing or empty. That rule is what ` +
        'stops this table pointing a class at a mesh that means something else; it is not optional.'
    )
  }
  return { control, forbiddenRules: forbidden.length }
}

function build() {
  const registry = JSON.parse(readFileSync(join(ROOT, REGISTRY_PATH), 'utf8'))
  const ids = registryIds(registry)
  const control = assertRegistryReaderWorks(ids, registry)

  const weaponClasses = SKILLS_BY_SET.Weapon.filter((s) => !META_WEAPON_SKILLS.has(s))
  const armorClasses = [...ARMOR_COVERAGE]

  // Named in WEAPON_NOUNS but not a real weapon skill: a typo here would
  // otherwise compile into a class the rest of the app has never heard of.
  for (const className of Object.keys(WEAPON_NOUNS)) {
    if (!weaponClasses.includes(className)) {
      throw new Error(
        `WEAPON_NOUNS names "${className}", which is not in SKILLS_BY_SET.Weapon minus the meta-skills. ` +
          `Known classes: ${weaponClasses.join(', ')}`
      )
    }
  }

  const known = new Set([...weaponClasses, ...armorClasses])
  const emitted = []
  for (const [className, id] of Object.entries(CLASS_MODEL_IDS)) {
    if (!known.has(className)) {
      throw new Error(`CLASS_MODEL_IDS names "${className}", which is not a weapon or armour class.`)
    }
    if (id === null) continue
    if (!ids.has(id)) {
      throw new Error(
        `CLASS_MODEL_IDS["${className}"] = "${id}", which is not a selections[].id in ${REGISTRY_PATH}. ` +
          `An id that resolves to nothing is a mesh that silently never loads. Known ids: ${[...ids].join(', ')}`
      )
    }
    emitted.push({ className, id })
  }

  const nouns = {}
  for (const [className, list] of Object.entries(WEAPON_NOUNS)) {
    for (const noun of list) {
      if (nouns[noun] && nouns[noun] !== className) {
        throw new Error(`the noun "${noun}" is claimed by both ${nouns[noun]} and ${className}.`)
      }
      nouns[noun] = className
    }
  }

  const classesOf = (list) =>
    Object.fromEntries(list.map((c) => [c, CLASS_MODEL_IDS[c] ?? null]))

  const data = {
    version: 1,
    generatedBy: 'tools/build-appearance-defaults.mjs',
    doNotEdit: 'Derived. Edit the generator, then run it; --check fails the build on drift.',
    registry: {
      source: REGISTRY_PATH,
      schemaVersion: registry.schemaVersion ?? null,
      idCount: ids.size,
      forbiddenSubstitutionRules: control.forbiddenRules,
      // Carried into the client so `appearance.ts` can refuse a player
      // override naming an id the registry does not admit. Without it the
      // client would have no way to tell a valid override from one pointing
      // at a mesh that will silently never load - the same defect the build
      // assertion above exists to stop, arriving from the other direction.
      ids: [...ids].sort(),
    },
    weapon: {
      classes: classesOf(weaponClasses),
      nouns: Object.fromEntries(Object.keys(nouns).sort().map((n) => [n, nouns[n]])),
    },
    armor: { classes: classesOf(armorClasses) },
  }

  return { data, weaponClasses, armorClasses, emitted, ids, control }
}

/** Git checks this repo out with CRLF, so a byte comparison against a freshly
 * generated LF string would report drift on a file nobody has touched. */
function normalizeEol(text) {
  return text.split('\r\n').join('\n')
}

function serialize(data) {
  return `${JSON.stringify(data, null, 2)}\n`
}

function summary(built) {
  const { weaponClasses, armorClasses, emitted, data, control } = built
  const resolved = (list) => list.filter((c) => data.weapon.classes[c] ?? data.armor.classes[c]).length
  const lines = [
    `registry ${REGISTRY_PATH}: ${built.ids.size} ids, positive control "${control.control}" found, ` +
      `${control.forbiddenRules} forbidden-substitution rules`,
    `weapon classes: ${weaponClasses.length} (${SKILLS_BY_SET.Weapon.length} skills minus ${META_WEAPON_SKILLS.size} meta) ` +
      `- ${resolved(weaponClasses)} resolved to a registry id, ${weaponClasses.length - resolved(weaponClasses)} to null`,
    `armour classes: ${armorClasses.length} - ${resolved(armorClasses)} resolved to a registry id, ` +
      `${armorClasses.length - resolved(armorClasses)} to null`,
    `weapon nouns: ${Object.keys(data.weapon.nouns).length}`,
    `ids emitted and checked against the registry: ${emitted.length}`,
  ]
  if (emitted.length === 0) {
    lines.push(
      'NOT CHECKED: no class points at an id, so the "every id exists" assertion examined nothing. ' +
        'The positive control above is the only evidence the assertion works at all.'
    )
  }
  return lines
}

const check = process.argv.includes('--check')
let built
try {
  built = build()
} catch (error) {
  console.error(`FAIL ${error.message}`)
  process.exit(1)
}

for (const line of summary(built)) console.log(line)

const next = serialize(built.data)
const outPath = join(ROOT, OUTPUT_PATH)

if (!check) {
  writeFileSync(outPath, next)
  console.log(`
wrote ${OUTPUT_PATH}`)
  process.exit(0)
}

// --check is a suite, so it reports individual assertions: run-tests.mjs
// counts OK/FAIL lines and treats a suite that asserted nothing as NOT RUN
// rather than as a pass, which is the whole point of the count.
let pass = 0
let fail = 0
function ok(label, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(64)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(64)} ${detail ?? ''}`)
  }
}

console.log('')
ok('the registry reader finds a known id (positive control)',
  built.ids.has(built.control.control), built.control.control)
ok('the registry still carries its forbidden-substitution rules',
  built.control.forbiddenRules > 0, `${built.control.forbiddenRules} rules`)
ok('weapon classes are SKILLS_BY_SET.Weapon minus the five meta-skills',
  built.weaponClasses.length === SKILLS_BY_SET.Weapon.length - META_WEAPON_SKILLS.size,
  `${built.weaponClasses.length} classes`)
ok('every armour class is an ARMOR_COVERAGE location',
  built.armorClasses.length === ARMOR_COVERAGE.length &&
    built.armorClasses.every((c) => ARMOR_COVERAGE.includes(c)),
  `${built.armorClasses.length} classes`)
// Vacuous while nothing is admitted, and it says so rather than reading as a
// pass it did not earn. build() throws before reaching here on a bad id, so
// the real defence is that failure, not this line.
ok('every emitted modelId exists in the registry',
  built.emitted.every((e) => built.ids.has(e.id)),
  built.emitted.length === 0 ? '0 emitted - nothing to check' : `${built.emitted.length} checked`)

let current = null
try {
  current = readFileSync(outPath, 'utf8')
} catch {
  current = null
}
ok(`${OUTPUT_PATH} exists`, current !== null)
ok(`${OUTPUT_PATH} matches a fresh generation`,
  current !== null && normalizeEol(current) === next,
  current !== null && normalizeEol(current) === next
    ? `${next.length} bytes`
    : 'stale or missing - run: node tools/build-appearance-defaults.mjs')

console.log('')
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
