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

const CONTENT_PACK = 'godot/scripts/shared_asset_content.gd'
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

/** Every `ContentRegistry.register("kind", ...)` in the content pack. */
function registeredKinds(source) {
  const kinds = []
  for (const line of source.split(/\r?\n/)) {
    const m = /ContentRegistry\.register\(\s*"([^"]+)"/.exec(line)
    if (m) kinds.push(m[1])
  }
  return kinds
}

/**
 * The list the same file also hands out through `shared_asset_status()`.
 *
 * Read only to be compared against the register calls above. It is a second
 * copy of the same fact living six lines from the first, and the day the two
 * disagree the viewer will report kinds it does not draw. Nothing here consumes
 * it; it exists to be checked.
 */
function advertisedKinds(source) {
  const m = /"registeredKinds"\s*:\s*\[([^\]]*)\]/.exec(source)
  if (!m) return null
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

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

function build() {
  const source = readFileSync(CONTENT_PACK, 'utf8')
  const registered = registeredKinds(source)
  if (registered.length < MIN_REGISTERED) {
    throw new Error(`${CONTENT_PACK} yielded ${registered.length} registered kinds, floor ${MIN_REGISTERED}. Either the registration syntax changed or this parse is broken; a zero here would compile a registry that admits nothing and a scene editor with empty dropdowns.`)
  }

  const advertised = advertisedKinds(source)
  if (advertised === null) {
    throw new Error(`${CONTENT_PACK} has no "registeredKinds" list in shared_asset_status(); it used to, and this check exists because it is a second copy of the register calls.`)
  }
  const drift = [
    ...registered.filter((k) => !advertised.includes(k)).map((k) => `registered but not advertised: ${k}`),
    ...advertised.filter((k) => !registered.includes(k)).map((k) => `advertised but not registered: ${k}`),
  ]
  if (drift.length) {
    throw new Error(`${CONTENT_PACK} registers one set of kinds and advertises another. ${drift.join('; ')}`)
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
    source: CONTENT_PACK,
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
  if (normalise(committed) !== normalise(text)) {
    console.error(`FAIL ${OUT} is not what ${CONTENT_PACK} produces. Run: node tools/build-scene-registry.mjs`)
    process.exit(1)
  }
  console.log(`OK   ${OUT} matches ${CONTENT_PACK}: ${built.kinds.length} kinds, ${built.placeable.length} placeable, ${built.groundKinds.length} ground, ${built.blockKinds.length} block, ${built.landmarkKinds.length} landmark, ${built.sceneArt.length} backdrops`)
} else {
  writeFileSync(OUT, text)
  console.log(`wrote ${OUT}: ${built.kinds.length} registered kinds (${built.kinds.map((k) => `${k.kind}=${k.role}`).join(', ')})`)
  console.log(`     placeable ${built.placeable.join(', ') || '(none)'} · ground ${built.groundKinds.length}/${GROUND_KINDS.length} · block ${built.blockKinds.length}/${BLOCK_KINDS.length} · landmark ${built.landmarkKinds.length} (drawn: ${built.landmarksDrawn}) · art ${built.sceneArt.length}`)
}
