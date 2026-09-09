#!/usr/bin/env node
/**
 * What the viewer can actually draw, compiled from the viewer's own source.
 *
 * The scene editor offers a player a choice of ground kind, block kind and
 * placed primitive. Every one of those lists has exactly one honest source:
 * `godot/scripts/shared_asset_content.gd`, which is the content pack that
 * calls `ContentRegistry.register(kind, factory)`. A kind nobody has
 * registered is drawn by `content_registry.gd::_placeholder` as a flat unlit
 * box in a colour chosen to be obviously wrong, so offering it in a dropdown
 * would be offering the player a way to make a room worse while the UI says
 * they chose something.
 *
 * A hand-typed list in TypeScript would be a second statement of that fact and
 * would be wrong the first time Codex registers a sixth kind - the same defect
 * `content_registry.gd`'s own comments spend two hundred lines on, where a
 * number typed into GDScript decided what a player saw while the manifest's
 * answer went unread. So this reads the GDScript, and `--check` fails if the
 * committed JSON has drifted from it.
 *
 * The roles are not read from anywhere. `primitivesFor()` in
 * `src/lib/world-content-rules.mjs` is the one statement of which kinds a cell
 * asks for and under what role, so this enumerates that function over its whole
 * input space and records what it emits. That is how `placeable` below gets its
 * meaning:
 *
 *   base      decided by the block kind. A cell has exactly one and a player
 *             changes it by changing the block kind, not by placing one.
 *   boundary  decided by which compass sides face nothing walkable, which is a
 *             fact about the map rather than a decoration.
 *   landform  everything else - the kinds that are scenery, and the only ones
 *             a person places by hand.
 *
 *   node tools/build-scene-registry.mjs           # write src/data/sceneRegistry.json
 *   node tools/build-scene-registry.mjs --check   # exit 1 if it has drifted
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  GROUND_KINDS,
  BLOCK_KINDS,
  blockKindFor,
  primitivesFor,
  COMPASS_SIDES,
} from '../src/lib/world-content-rules.mjs'
import { LANDMARK_KINDS } from '../src/lib/mapLandmarks.ts'
import { NO_CONTENT_PACK_REASON, advertisedKinds, findContentPack } from './godot-content-pack.mjs'

const SCENE_PATTERNS = 'src/data/roomScenePatterns.ts'
const OUT = 'src/data/sceneRegistry.json'

/**
 * A floor well under the real count, so an empty or truncated read is a loud
 * failure rather than a registry that admits nothing. Five kinds are registered
 * on 6 Sep 2026; this only has to catch the parse returning nothing.
 */
const MIN_REGISTERED = 3

/**
 * The same floor for the 2D backdrops. `roomScenePatterns.ts` carried 17
 * distinct images on 6 Sep 2026; this only has to catch the regex below
 * matching nothing, which would leave the art picker empty while claiming the
 * pipeline offers no art rather than that this file failed to read it.
 */
const MIN_SCENE_ART = 5

/**
 * kind -> role, by running `primitivesFor` over every input that can change
 * what it emits: each block kind, each tag it branches on, and boundary edges
 * present or absent.
 */
function rolesFromRules() {
  const roles = new Map()
  const tagSets = [[], ['water'], ['bridge'], ['water', 'bridge']]
  for (const blockKind of BLOCK_KINDS) {
    for (const tags of tagSets) {
      for (const boundaryEdges of [[], [COMPASS_SIDES[0]]]) {
        for (const p of primitivesFor({ blockKind, tags, boundaryEdges })) {
          const seen = roles.get(p.kind)
          if (seen && seen !== p.role) {
            throw new Error(`primitivesFor emits ${p.kind} as both ${seen} and ${p.role}; this file assumes one role per kind`)
          }
          roles.set(p.kind, p.role)
        }
      }
    }
  }
  return roles
}

/**
 * Every distinct backdrop `roomScenePatterns.ts` can select.
 *
 * Read out of the generated file rather than out of `public/`, and the
 * distinction matters: the directory holds every image anyone has ever
 * rendered, while the generated `ARTS` table is the reviewed subset
 * `tools/build-room-scene-patterns.mjs` actually assigns. Offering the
 * directory would let a player pick a picture the selection pipeline has
 * rejected, which is `docs/SCENE_ART.md`'s tier 4 ("no scene assignment -
 * preferable to confidently showing the wrong environment") undone by a
 * dropdown.
 */
function sceneArtUrls(source) {
  return [...new Set([...source.matchAll(/"(\/[a-z0-9-]+-art\/room-scenes\/[^"]+)"/g)].map((m) => m[1]))].sort()
}

/**
 * The kind list, and where it came from.
 *
 * Two sources, and the difference is the whole of this file's three states.
 *
 * **A content pack on disk** is the live source. Its register calls are the
 * registry, its `registeredKinds` advertisement is checked against them, and
 * `--check` is a real drift check over every field below.
 *
 * **No content pack** is where this repository stands on 9 Sep 2026: the 3D
 * pack was deleted (docs/NO-3D.md) and the 2D one is the Godot owner's and has
 * not landed. The registry is not deleted with it - `src/data/sceneRegistry
 * .json` is the scene editor's option lists, and the ground kinds, block kinds,
 * placements and backdrops in it are 2D-renderable content that survives 3D
 * entirely. So the committed `kinds` list is read back as a **frozen** list and
 * everything derived from it is still recomputed and still compared: a role
 * that changed in `primitivesFor()`, a backdrop added to
 * `roomScenePatterns.ts`, a landmark kind added to `mapLandmarks.ts` all still
 * take `--check` red. What cannot be checked, and is said out loud rather than
 * folded into the pass, is whether that frozen list is still the set Godot
 * registers factories for.
 *
 * Reading the committed file as its own input would be circular if it were the
 * *only* input, which is why the floor still applies to it and why the
 * unreadable case throws instead of yielding an empty registry.
 */
function kindSource() {
  const pack = findContentPack()
  if (pack) {
    const advertised = advertisedKinds(pack.source)
    if (advertised === null) {
      throw new Error(`${pack.file} has no "registeredKinds" list in shared_asset_status(); a pack is expected to advertise the kinds it registers, and this check exists because that list is a second copy of the register calls.`)
    }
    const drift = [
      ...pack.registered.filter((k) => !advertised.includes(k)).map((k) => `registered but not advertised: ${k}`),
      ...advertised.filter((k) => !pack.registered.includes(k)).map((k) => `advertised but not registered: ${k}`),
    ]
    if (drift.length) {
      throw new Error(`${pack.file} registers one set of kinds and advertises another. ${drift.join('; ')}`)
    }
    return { registered: pack.registered, source: pack.file, frozen: false }
  }

  const committed = JSON.parse(readFileSync(OUT, 'utf8'))
  const registered = (committed.kinds ?? []).map((k) => k.kind)
  return { registered, source: committed.source, frozen: true }
}

const kindOrigin = kindSource()

function build() {
  const { registered, source, frozen } = kindOrigin
  if (registered.length < MIN_REGISTERED) {
    throw new Error(`${frozen ? `${OUT} (frozen)` : source} yielded ${registered.length} registered kinds, floor ${MIN_REGISTERED}. Either the registration syntax changed or this parse is broken; a zero here would compile a registry that admits nothing and a scene editor with empty dropdowns.`)
  }

  const sceneArt = sceneArtUrls(readFileSync(SCENE_PATTERNS, 'utf8'))
  if (sceneArt.length < MIN_SCENE_ART) {
    throw new Error(`${SCENE_PATTERNS} yielded ${sceneArt.length} backdrop urls, floor ${MIN_SCENE_ART}. The generated ARTS table changed shape or this parse is broken; an empty list would be an art picker that silently offers nothing.`)
  }

  const roles = rolesFromRules()
  const unused = registered.filter((k) => !roles.has(k))
  const kinds = registered.map((kind) => ({ kind, role: roles.get(kind) ?? null }))

  const drawableBase = (blockKind) => {
    const base = primitivesFor({ blockKind, tags: [], boundaryEdges: [] })[0]
    return registered.includes(base.kind)
  }

  return {
    schemaVersion: 1,
    generatedBy: 'tools/build-scene-registry.mjs',
    source,
    /** Every kind the content pack registers a factory for, with the role
     * `primitivesFor` emits it under, or null when no cell ever asks for it. */
    kinds,
    /** The kinds a person may place by hand: scenery, not the cell's own base
     * and not the boundary kit the map decides. */
    placeable: kinds.filter((k) => k.role === 'landform').map((k) => k.kind),
    /** Registered but asked for by no cell - a factory nothing routes to. Empty
     * today; recorded rather than dropped, because a kind in here is either a
     * rule that stopped firing or art waiting for one. */
    unusedKinds: unused,
    /** Ground kinds whose cell would be drawn rather than placeheld. */
    groundKinds: GROUND_KINDS.filter((g) => drawableBase(blockKindFor(g))),
    /** Block kinds whose cell would be drawn rather than placeheld. */
    blockKinds: BLOCK_KINDS.filter(drawableBase),
    /** The landmark vocabulary `mapLandmarks.ts` decides for the 2D map and the
     * batch carries. The viewer draws none of them yet: there is no landmark
     * factory in the content pack, and `unusedKinds` is where one would appear.
     * Offered anyway because the field is real content the snapshot carries,
     * and labelled in the panel as not yet drawn rather than implied to be. */
    landmarkKinds: [...LANDMARK_KINDS],
    landmarksDrawn: kinds.some((k) => k.role === 'landmark'),
    /** The reviewed 2D backdrops `roomScenePatterns.ts` selects from, which is
     * `docs/SCENE_ART.md`'s tier-1 "curated landmark / published override"
     * vocabulary. */
    sceneArt,
  }
}

const built = build()
const text = JSON.stringify(built, null, 2) + '\n'

/**
 * Line endings are normalised before comparing, and that is not laziness.
 * `.gitattributes` checks this repo out with CRLF on Windows while `JSON
 * .stringify` here emits LF, so a byte comparison would fail on every Windows
 * checkout and pass on Linux CI - a check that reports a drift nobody made,
 * which teaches the reader to ignore it. The claim being made is about the
 * content, so the comparison is about the content.
 */
const normalise = (s) => s.split('\r\n').join('\n')

if (process.argv.includes('--check')) {
  const committed = readFileSync(OUT, 'utf8')
  const from = kindOrigin.frozen
    ? `${built.kinds.length} frozen kinds plus the live rules, backdrops and landmarks`
    : built.source
  if (normalise(committed) !== normalise(text)) {
    console.error(`FAIL ${OUT} is not what ${from} produces. Run: node tools/build-scene-registry.mjs`)
    process.exit(1)
  }
  console.log(`OK   ${OUT} matches ${from}: ${built.kinds.length} kinds, ${built.placeable.length} placeable, ${built.groundKinds.length} ground, ${built.blockKinds.length} block, ${built.landmarkKinds.length} landmark, ${built.sceneArt.length} backdrops`)
  // The third state. Everything above is a genuine comparison; this one field
  // is not, and saying so is the difference between a partial check and a
  // clean one. `tools/run-tests.mjs` collects this line and refuses to print
  // "all passed" over it.
  if (kindOrigin.frozen) {
    console.log(
      `NOT CHECKED the kind list against a Godot content pack   ${NO_CONTENT_PACK_REASON} ` +
        `The ${built.kinds.length} kinds above were read back out of ${OUT} itself and carried over frozen, so a kind Godot stopped registering would not be seen here. Everything derived from them - roles, placeable, ground, block, landmark, backdrops - was recomputed and compared.`
    )
  }
} else {
  if (kindOrigin.frozen) {
    console.log(
      `note: no Godot content pack on disk, so the ${built.kinds.length} kinds in ${OUT} were carried over from the committed file rather than read from GDScript. Everything else below is freshly derived.`
    )
  }
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT}: ${built.kinds.length} registered kinds (${built.kinds.map((k) => `${k.kind}=${k.role}`).join(', ')})`)
  console.log(`     placeable ${built.placeable.join(', ') || '(none)'} · ground ${built.groundKinds.length}/${GROUND_KINDS.length} · block ${built.blockKinds.length}/${BLOCK_KINDS.length} · landmark ${built.landmarkKinds.length} (drawn: ${built.landmarksDrawn}) · art ${built.sceneArt.length}`)
}
