/**
 * What a room's scene is, after the player has had their say.
 *
 * `tools/build-world-content.mjs` classifies all 17,750 rooms from the
 * cartography and commits the answer to `src/data/world/<zone>.json`. It is
 * right about 95% of them and honestly unsure about 86. This file is the other
 * half of that: one resolver, `resolveScene`, that reads the batch's guess and
 * the player's override and returns the single answer both the snapshot
 * compiler and the scene editor use.
 *
 * # Same shape as the three that came before it
 *
 * `portraits.ts`, `creatureArt.ts` and `playerArt.ts` each do generated guess,
 * player override in prefs, one resolver; `appearance.ts` is the fourth. This
 * is the fifth and it is deliberately not a variant of them - it resolves a
 * different domain (a room's scene, not an entity's mesh) and shares their
 * storage helper rather than their tables.
 *
 * # What an override may say
 *
 * Only what the viewer can draw. `src/data/sceneRegistry.json` is compiled from
 * `godot/scripts/shared_asset_content.gd` by `tools/build-scene-registry.mjs`,
 * so a kind that has no factory registered cannot be stored here at all -
 * `setSceneField` refuses it and names it. An override that named an
 * unregistered kind would render as `content_registry.gd`'s deliberately-wrong
 * placeholder box, which the player would read as the editor being broken
 * rather than as their choice having no art behind it.
 *
 * # Derived, not stored
 *
 * `block`, `spatialMode` and `tier` follow from the ground kind through
 * `world-content-rules.mjs`, which is the pipeline's own statement of those
 * rules. Overriding the ground kind therefore moves the block kind and the
 * cell's height with it, and a player who wants a different block kind
 * overrides that separately. Storing the derived values alongside the ground
 * kind would be the same decision written twice, with the copy going stale the
 * day the rules change.
 */
import registry from '../data/sceneRegistry.json' with { type: 'json' }
import { blockKindFor, spatialModeFor, tierFor } from './world-content-rules.mjs'
import { readJSON, writeJSONVerified, type StorageWriteResult } from './storage.ts'
import { readEnvelope, shortenValue, type ExportEnvelope } from './exportEnvelope.ts'
import type { RoomContent } from './worldContent.ts'

export const SCENE_STORAGE_KEY = 'drc.scene.v1'

/** The half-width of a cell, in metres, that a placed primitive lives inside.
 * `CELL_BLOCK_METRES` is 4.4 (`isometric-board-layout.mjs`), so an offset runs
 * -2.2 to +2.2 on each axis and the centre is 0. Imported rather than typed
 * would be better and is not possible here: that module is `.mjs` and this file
 * is loaded by the compiler, the panel and the Godot-facing tests alike, so the
 * clamp is stated once, here, and `tools/scene-editor-test.mjs` asserts it
 * equals the layout module's block size. */
export const PLACEMENT_HALF_EXTENT = 2.2

/**
 * Pull a placement back inside the cell.
 *
 * Exported so the picker cannot state the clamp a second time. A control doing
 * its own arithmetic could hand `setSceneField` a value a float past the edge,
 * which `isDrawable` then refuses - and the refusal would arrive as a red
 * message about a click the player made *inside* the square they were shown,
 * which reads as the editor being broken rather than as a rounding error. The
 * control clamps with the same function the store validates against, so a
 * click inside the drawn footprint is always storable.
 *
 * Godot's own clamp is `content_registry.gd::_place`, against the cell's
 * published block rather than against this constant, because a cell may be
 * smaller than the layout's nominal block. This is the editor's bound; that is
 * the renderer's, and they are allowed to differ in that direction.
 */
export function clampToCell(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-PLACEMENT_HALF_EXTENT, Math.min(PLACEMENT_HALF_EXTENT, value))
}

/** One thing a person put somewhere inside a cell. */
export interface PlacedPrimitive {
  /** A `placeable` kind from the scene registry. */
  kind: string
  /** Metres east of the cell centre, in [-2.2, 2.2]. */
  x: number
  /** Metres south of the cell centre, in [-2.2, 2.2]. */
  z: number
}

/**
 * What one room's override says. Every field is optional and an absent field
 * means "the batch's answer stands" - which is why reset deletes a field rather
 * than writing the guess into it. Writing the guess would freeze it, and the
 * next pipeline run that improved that room would have no way to reach it.
 */
export interface SceneOverride {
  ground?: string
  block?: string
  /** `null` is a real value here and is not the same as absent: it means "this
   * room has no landmark", which is a correction the batch cannot express. */
  landmark?: string | null
  /** A backdrop url from the registry's `sceneArt`. */
  art?: string
  primitives?: PlacedPrimitive[]
}

/** Room id (`<zone>-<room>`, the same key `presentationBridge.ts::cellId` and
 * `tools/world-content-residue.csv` both use) to that room's override. */
export type SceneOverrides = Record<string, SceneOverride>

/** Which of the two answers each field came from. `guess` when the batch
 * decided it, `override` when the player did, `none` when neither has an
 * opinion - a room with no content file and no override at all. */
export type SceneFieldSource = 'guess' | 'override' | 'none'

export type SceneField = 'ground' | 'block' | 'landmark' | 'art' | 'primitives'

/** Every field an override may carry, in the order an export writes them. One
 * list: the schema, the exporter and the importer all read it, so a sixth field
 * cannot arrive in one of them and be silently dropped by the others. */
export const SCENE_FIELDS: readonly SceneField[] = ['ground', 'block', 'landmark', 'art', 'primitives']

export interface ResolvedScene {
  ground: string
  block: string
  landmark: string | null
  art: string | null
  primitives: PlacedPrimitive[]
  classification: { tags: string[]; specialKinds: string[]; spatialMode: string; tier: string }
  boundaryEdges: string[]
  sources: Record<SceneField, SceneFieldSource>
}

const PLACEABLE = new Set<string>(registry.placeable)
const GROUND_KINDS = new Set<string>(registry.groundKinds)
const BLOCK_KINDS = new Set<string>(registry.blockKinds)
const LANDMARK_KINDS = new Set<string>(registry.landmarkKinds)
const SCENE_ART = new Set<string>(registry.sceneArt)

/** What the editor may offer for each field, and nothing else. Exported as one
 * function so the panel and the test read the same lists; a component building
 * its own would be the hand-typed copy this whole file exists to avoid. */
export function sceneOptions(): {
  ground: string[]
  block: string[]
  landmark: string[]
  art: string[]
  placeable: string[]
  /** False while `shared_asset_content.gd` registers no landmark factory, which
   * is the state on 6 Sep 2026. The panel says so rather than implying a
   * landmark choice changes what is on screen. */
  landmarksDrawn: boolean
} {
  return {
    ground: [...registry.groundKinds],
    block: [...registry.blockKinds],
    landmark: [...registry.landmarkKinds],
    art: [...registry.sceneArt],
    placeable: [...registry.placeable],
    landmarksDrawn: registry.landmarksDrawn,
  }
}

/**
 * The parsed store, held until something changes it.
 *
 * Not a performance cache, or not only: `useSyncExternalStore` compares
 * snapshots by identity, so a loader that parsed fresh JSON on every call would
 * re-render the panel forever. Holding the object makes "the overrides" a value
 * with a stable identity between edits, which is what a React subscription
 * needs and what the compiler wants anyway - it resolves 1,060 cells per
 * publish.
 *
 * Invalidated by `saveSceneOverrides` for this window and by the `storage`
 * event for the others. That event is the only signal a popped-out panel's edit
 * ever gives the main window: a pop-out is a separate webview with its own
 * JavaScript context, so nothing in this module's own state can hear it.
 */
let cached: SceneOverrides | null = null

/** Test-only: forget what has been parsed, so a case can start from an empty
 * store. The same escape hatch, for the same reason, as
 * `worldContent.ts::resetWorldContentCache`. */
export function resetSceneOverridesCache(): void {
  cached = null
}

/** What the last load of the store could not keep. Read by the panel, which is
 * the only place a person can act on it. Empty on a healthy store, which is
 * every store this build has ever written: it fills only when a file was
 * hand-edited, when a future format was written by a newer build, or when
 * something else on the machine put a value under this key. */
let storeRefusals: SceneRefusal[] = []

/** Why the store dropped something on the way in. Never a claim about the
 * registry: an unregistered kind is left alone here on purpose - see
 * `parseSceneOverrideSet`'s `requireDrawable`. */
export function sceneStoreRefusals(): SceneRefusal[] {
  return storeRefusals
}

export function loadSceneOverrides(): SceneOverrides {
  if (cached) return cached
  const raw = readJSON<unknown>(SCENE_STORAGE_KEY, {})
  // The same schema the importer uses, with kinds left alone. A store written
  // by a build whose registry admitted a kind this one does not is not a
  // corrupt store - `resolveScene` ignores such a value and keeps it, so a
  // content pack that re-registers the kind brings the player's choice back.
  // Validating kinds here would delete the work that design exists to protect.
  const parsed = parseSceneOverrideSet(raw, { requireDrawable: false })
  storeRefusals = parsed.refusals
  cached = parsed.overrides
  return cached
}

/**
 * Who to tell when a room's scene changes.
 *
 * The snapshot publisher republishes when the zone, the room or the character
 * changes, and an edit in the scene editor is none of those: without this the
 * player would change a room's ground kind and watch the viewer not change,
 * until they happened to walk somewhere and back. So the store has a revision
 * and `usePresentationBridgePublisher` forces a publish when it moves.
 *
 * A counter as well as the value, because the compiler wants to know only
 * *that* something changed while the panel wants to know what to.
 */
const listeners = new Set<() => void>()
let revision = 0

export function subscribeSceneOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function sceneOverridesRevision(): number {
  return revision
}

/**
 * Write the set, and say whether it actually landed.
 *
 * The result is returned rather than discarded, which is the whole of issue
 * #461's fourth finding: at quota this reported nothing, `setSceneField`
 * returned `{ok: true}`, the in-memory cache held the edit and the panel drew
 * it as saved. The reload disagreed. `writeJSONVerified` reads the key back, so
 * a store that accepts and keeps nothing is a failure here rather than a
 * surprise later.
 *
 * The cache is still updated on a failed write, deliberately: the session-only
 * value is what `StorageWarning`'s Retry retries, and dropping it would make a
 * full quota erase the player's work in front of them. What must not happen is
 * calling that saved, and the returned result is how a caller avoids it.
 */
export function saveSceneOverrides(value: SceneOverrides): StorageWriteResult {
  const written = writeJSONVerified(SCENE_STORAGE_KEY, value)
  // A fresh object, never the one handed in. `setSceneField` builds its next
  // state by copying what `loadSceneOverrides()` returned, and if the caller
  // ever passes that same reference back, `useSyncExternalStore` compares it
  // against itself and skips the render - the panel writes the choice to
  // localStorage and does not redraw, which is exactly what the browser
  // capture caught before this line existed.
  cached = { ...value }
  announce()
  return written
}

function announce(): void {
  revision += 1
  for (const listener of listeners) listener()
}

// The only signal a popped-out panel's edit ever gives this window: a pop-out
// is a separate webview with its own JavaScript context, so nothing in this
// module's own state can hear it. Guarded because this module is imported by
// `presentationBridge.ts`, which the Node test suites load with no window at
// all.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== SCENE_STORAGE_KEY) return
    cached = null
    announce()
  })
}

/** Whether a value is one this build can draw. Exported because the panel
 * disables what it cannot offer and the importer counts what it dropped, and
 * both have to agree with `setSceneField` about the rule. */
export function isDrawable(field: SceneField, value: unknown): boolean {
  switch (field) {
    case 'ground':
      return typeof value === 'string' && GROUND_KINDS.has(value)
    case 'block':
      return typeof value === 'string' && BLOCK_KINDS.has(value)
    case 'landmark':
      return value === null || (typeof value === 'string' && LANDMARK_KINDS.has(value))
    case 'art':
      return typeof value === 'string' && SCENE_ART.has(value)
    case 'primitives':
      return (
        Array.isArray(value) &&
        value.every(
          (p) =>
            p != null &&
            typeof p === 'object' &&
            PLACEABLE.has((p as PlacedPrimitive).kind) &&
            Number.isFinite((p as PlacedPrimitive).x) &&
            Number.isFinite((p as PlacedPrimitive).z) &&
            Math.abs((p as PlacedPrimitive).x) <= PLACEMENT_HALF_EXTENT &&
            Math.abs((p as PlacedPrimitive).z) <= PLACEMENT_HALF_EXTENT
        )
      )
  }
}

// ---------------------------------------------------------------------------
// The schema. One statement of what an override set may say, at the boundary.
// ---------------------------------------------------------------------------

/**
 * The bounds every path into this store is held to.
 *
 * Chosen from a measurement rather than from a round number that felt safe.
 * Issue #461 measured the store with none of these: every room in the game on
 * every field is 4,361,241 characters. `tools/scene-editor-shots.mjs` measures
 * what the origin will actually hold by filling one key until it refuses -
 * 5,177,344 characters on 6 Sep 2026 - and that is the whole origin, shared
 * with prefs, layout, highlights, portraits and every other key in
 * `docs/PLAYER_DATA.md`, so the scene editor may not have all of it. The
 * unbounded store was therefore within one import of taking every other
 * preference in the app down with it.
 *
 * - `totalChars` 1,048,576 is a fifth of the measured origin quota, which
 *   leaves four fifths for everything else the app saves. One zone with every
 *   room and every field decided measures 188,634
 *   characters (Crossing, 1,060 rooms), so this holds five such zones, or a
 *   single-field opinion about every room in the game (509,491 characters).
 *   Somebody who has genuinely decided more than that has a pipeline file, not
 *   a browser preference: `data/scene-overrides.json` is the committed tier and
 *   has no quota.
 * - `roomChars` 4,096 is about twenty times the 178 characters a fully decided
 *   room measures, and comfortably fits `primitivesPerRoom` at ~40 characters
 *   each. Its job is to refuse a payload, not to ration a room.
 * - `primitivesPerRoom` 64 against a 4.4 m cell. The picker places one per
 *   click and the viewer builds every one of them.
 * - `roomIdPattern` is the map's own id shape: 85 zone ids, every one of them
 *   `[0-9A-Za-z]` and at most five characters, and room numbers 1 to 1,060.
 *   It also refuses `__proto__`, which has no `-` in it, and which the old
 *   importer counted as added while assigning it set a prototype instead of a
 *   key.
 */
export const SCENE_LIMITS = {
  /** The only `SceneExport.version` this build reads. */
  formatVersion: 1,
  roomIdPattern: /^[0-9A-Za-z]{1,8}-[0-9]{1,6}$/,
  primitivesPerRoom: 64,
  roomChars: 4096,
  totalChars: 1048576,
  /** A primitive's kind is a registry id, not a document: the longest the
   * registry holds is 15 characters. Bounded so a refusal message can quote it
   * without quoting a megabyte. */
  kindChars: 64,
  /** A field value. 256 rather than `kindChars` because `art` is a url and the
   * longest the registry ships is 57 - a bound that fits today's longest value
   * with four characters to spare would be a trap for whoever adds the next
   * backdrop. `tools/scene-editor-test.mjs` puts every option the registry
   * offers through the schema, so a value this refuses fails the build. */
  valueChars: 256,
} as const

/**
 * One thing a parse would not keep, and why.
 *
 * A count is not enough and #461 said so from both ends: "refused 3" tells an
 * importer of 200 rooms nothing about which three, and an override silently
 * dropped at compile told them nothing at all. Every refusal names its room,
 * its field where it has one, and a sentence a person can act on.
 */
export interface SceneRefusal {
  roomId: string | null
  field: SceneField | null
  reason: string
}

/** So a refusal about a 1 MB key does not itself carry a megabyte. The
 *  implementation moved to `exportEnvelope.ts` when the player config export
 *  needed the same bound; this is the name the rest of this file calls it by,
 *  not a second copy. */
const shorten = shortenValue

/**
 * The typed shape of a placed primitive, and nothing else on the object.
 *
 * `isDrawable` checked `kind`, `x` and `z` and accepted every other key, so an
 * import could carry arbitrary nested payloads into prefs verbatim - #461's
 * second finding, and the mechanism by which its fourth became reachable
 * without 17,750 rooms. Extra keys are refused and named rather than stripped:
 * a file carrying a field this build does not understand is a file whose author
 * expected it to mean something, and quietly dropping it is how the two ends
 * come to disagree about what was transferred.
 */
function parsePrimitives(value: unknown): { ok: true; value: PlacedPrimitive[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: `primitives must be a list, not ${shorten(value)}.` }
  if (value.length > SCENE_LIMITS.primitivesPerRoom)
    return { ok: false, reason: `${value.length} primitives in one room, and the limit is ${SCENE_LIMITS.primitivesPerRoom}.` }
  const out: PlacedPrimitive[] = []
  for (const entry of value) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry))
      return { ok: false, reason: `a primitive must be an object, not ${shorten(entry)}.` }
    const extra = Object.keys(entry).filter((key) => key !== 'kind' && key !== 'x' && key !== 'z')
    if (extra.length > 0)
      return { ok: false, reason: `a primitive carries ${extra.map((k) => shorten(k, 24)).join(', ')}; this build reads kind, x and z and nothing else.` }
    const { kind, x, z } = entry as Partial<PlacedPrimitive>
    if (typeof kind !== 'string' || kind.length === 0 || kind.length > SCENE_LIMITS.kindChars)
      return { ok: false, reason: `${shorten(kind)} is not a primitive kind.` }
    if (!Number.isFinite(x) || !Number.isFinite(z))
      return { ok: false, reason: `a primitive at ${shorten(x)}, ${shorten(z)} has no finite position.` }
    if (Math.abs(x as number) > PLACEMENT_HALF_EXTENT || Math.abs(z as number) > PLACEMENT_HALF_EXTENT)
      return { ok: false, reason: `a primitive at ${x}, ${z} is outside the cell, which runs ±${PLACEMENT_HALF_EXTENT} m.` }
    out.push({ kind, x: x as number, z: z as number })
  }
  return { ok: true, value: out }
}

/** What a parse kept, what it would not keep, and whether rooms were checked
 * at all. Three states on that last one on purpose: a caller with no room list
 * to check against has not proved the rooms are real, and saying so is not the
 * same as saying they are. */
export interface SceneParsedSet {
  overrides: SceneOverrides
  refusals: SceneRefusal[]
  /** False when no `knownRooms` was supplied: room existence was not checked. */
  roomsChecked: boolean
}

/**
 * Validate an override set: the one gate the store's load path and the importer
 * both go through.
 *
 * `requireDrawable` is the single difference between the two callers and it is
 * a deliberate one. An import is somebody else's file arriving now, so a field
 * naming a kind this build has no factory for is refused and named. The store's
 * own load is not: `resolveScene` ignores an unregistered kind and leaves it
 * where it is, so that a content pack re-registering the kind brings the
 * player's choice back, and a loader that deleted such values would destroy the
 * work that design exists to protect. Structure, shape and size are checked
 * identically on both paths.
 */
export function parseSceneOverrideSet(
  value: unknown,
  options: { requireDrawable: boolean; knownRooms?: ReadonlySet<string> | null }
): SceneParsedSet {
  const refusals: SceneRefusal[] = []
  const overrides: SceneOverrides = {}
  const roomsChecked = options.knownRooms != null
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    refusals.push({ roomId: null, field: null, reason: `An override set must be an object of rooms, not ${shorten(value)}.` })
    return { overrides, refusals, roomsChecked }
  }

  let totalChars = 2 // the braces the set itself costs
  for (const [roomId, room] of Object.entries(value as Record<string, unknown>)) {
    if (!SCENE_LIMITS.roomIdPattern.test(roomId)) {
      refusals.push({
        roomId: shorten(roomId, 24),
        field: null,
        reason: `${shorten(roomId, 24)} is not a room id. They read <zone>-<room>, like 1-42.`,
      })
      continue
    }
    if (options.knownRooms && !options.knownRooms.has(roomId)) {
      refusals.push({ roomId, field: null, reason: `${roomId} is not a room in this map.` })
      continue
    }
    if (room == null || typeof room !== 'object' || Array.isArray(room)) {
      refusals.push({ roomId, field: null, reason: `${roomId} holds ${shorten(room)}, which is not an override.` })
      continue
    }

    const kept: SceneOverride = {}
    const unknownFields = Object.keys(room).filter((key) => !SCENE_FIELDS.includes(key as SceneField))
    if (unknownFields.length > 0)
      refusals.push({
        roomId,
        field: null,
        reason: `${roomId} carries ${unknownFields.map((k) => shorten(k, 24)).join(', ')}, which this build does not read.`,
      })
    for (const field of SCENE_FIELDS) {
      if (!(field in room)) continue
      const raw = (room as Record<string, unknown>)[field]
      if (field === 'primitives') {
        const parsed = parsePrimitives(raw)
        if (!parsed.ok) {
          refusals.push({ roomId, field, reason: `${roomId}: ${parsed.reason}` })
          continue
        }
        if (options.requireDrawable && !isDrawable('primitives', parsed.value)) {
          refusals.push({ roomId, field, reason: undrawable(field, parsed.value) })
          continue
        }
        kept.primitives = parsed.value
        continue
      }
      if (field === 'landmark' && raw === null) {
        kept.landmark = null
        continue
      }
      if (typeof raw !== 'string' || raw.length > SCENE_LIMITS.valueChars) {
        refusals.push({ roomId, field, reason: `${roomId}: ${shorten(raw)} is not a ${field}.` })
        continue
      }
      if (options.requireDrawable && !isDrawable(field, raw)) {
        refusals.push({ roomId, field, reason: undrawable(field, raw) })
        continue
      }
      ;(kept as Record<string, unknown>)[field] = raw
    }

    if (Object.keys(kept).length === 0) continue
    const cost = JSON.stringify(kept).length + roomId.length + 4
    if (cost > SCENE_LIMITS.roomChars) {
      refusals.push({ roomId, field: null, reason: `${roomId} is ${cost} characters and one room may be ${SCENE_LIMITS.roomChars}.` })
      continue
    }
    if (totalChars + cost > SCENE_LIMITS.totalChars) {
      refusals.push({
        roomId,
        field: null,
        reason: `${roomId} did not fit: the set is already ${totalChars} characters and the whole store may be ${SCENE_LIMITS.totalChars}.`,
      })
      continue
    }
    totalChars += cost
    overrides[roomId] = kept
  }

  return { overrides, refusals, roomsChecked }
}

function undrawable(field: SceneField, value: unknown): string {
  return `${shorten(value)} is not a ${field} this build can draw. The viewer's registry (${registry.source}) admits: ${optionsFor(field).join(', ') || '(none)'}.`
}

/**
 * Validate a whole exported file, envelope and all.
 *
 * `version` and `provenance` were type-only until #461: a file saying
 * `version: 99` imported as if it were version 1, which is the "a field nobody
 * reads is an absence with more steps" shape with the field sitting in the type
 * the whole time. There is no migration table here because there is no older
 * format to migrate from - version 1 is the first and only one this app has
 * ever written. When there is a version 2, the migration goes in this function,
 * ahead of the set parse, and this comment is how the next person knows that is
 * where it belongs rather than in a second reader beside it.
 *
 * The four header refusals themselves are `exportEnvelope.ts`'s since Q6, and
 * the wording is unchanged - the player config export needed the identical
 * checks, and writing them twice would have been two opinions about what a
 * valid document header is. `migratable` is empty here because it is true: no
 * older scene format has ever existed.
 */
export function parseSceneOverrides(
  file: unknown,
  options: { knownRooms?: ReadonlySet<string> | null } = {}
): { ok: true; parsed: SceneParsedSet } | { ok: false; reason: string } {
  const header = readEnvelope(file, {
    kind: 'a scene export',
    version: SCENE_LIMITS.formatVersion,
    provenanceChars: SCENE_LIMITS.valueChars,
  })
  if (!header.ok) return { ok: false, reason: header.reason }
  const envelope = file as Partial<SceneExport>
  return {
    ok: true,
    parsed: parseSceneOverrideSet(envelope.overrides, { requireDrawable: true, knownRooms: options.knownRooms }),
  }
}

export type SceneWriteResult = { ok: true } | { ok: false; reason: string }

/**
 * Set one field of one room's override.
 *
 * Refused, naming the value, when the viewer cannot draw it. Refusing loudly
 * rather than storing it is the whole point: a stored-but-undrawable choice
 * looks to the player exactly like a bug in the editor, because the room does
 * not change and nothing says why.
 */
export function setSceneField(roomId: string, field: SceneField, value: unknown): SceneWriteResult {
  if (!isDrawable(field, value)) return { ok: false, reason: undrawable(field, value) }
  const all = { ...loadSceneOverrides() }
  const next: SceneOverride = { ...(all[roomId] ?? {}) }
  ;(next as Record<string, unknown>)[field] = value
  all[roomId] = next
  // The same schema the importer and the load path use, over the set this write
  // would produce. The panel cannot reach a bad room id or an oversize room -
  // it offers one room at a time from the zone - and checking here anyway is
  // what makes the bound a property of the store rather than of the one caller
  // that happens to be careful.
  const checked = parseSceneOverrideSet(all, { requireDrawable: false })
  const refused = checked.refusals.find((r) => r.roomId === roomId || r.roomId === shorten(roomId, 24))
  if (refused) return { ok: false, reason: refused.reason }
  const written = saveSceneOverrides(all)
  if (!written.ok) {
    return {
      ok: false,
      reason: `This device would not save that: ${written.message} The change is on screen for this session only, and will be gone after a reload.`,
    }
  }
  return { ok: true }
}

function optionsFor(field: SceneField): string[] {
  const options = sceneOptions()
  if (field === 'primitives') return options.placeable
  return options[field]
}

/**
 * Forget one field, so the batch's answer stands again.
 *
 * Exactly one field. A room whose override empties is deleted from the store
 * rather than left as `{}`, so the exported set is the set of rooms somebody
 * actually decided something about.
 */
export function resetSceneField(roomId: string, field: SceneField): void {
  const all = { ...loadSceneOverrides() }
  const room = { ...(all[roomId] ?? {}) }
  if (!all[roomId]) return
  delete room[field]
  if (Object.keys(room).length === 0) delete all[roomId]
  else all[roomId] = room
  saveSceneOverrides(all)
}

/**
 * The one answer for one room: the player's, else the batch's.
 *
 * `null` when there is neither - a room in a zone this app has no cartography
 * for and that nobody has edited. That is a real state and the caller publishes
 * a cell with no content rather than inventing one, which is the contract
 * `presentationBridge.ts` already has.
 *
 * `overrides` is a parameter rather than a read, so the compiler can resolve
 * 1,060 cells against one load and a test can resolve against a store it built
 * itself. `resolveSceneForRoom` below is the one-room convenience.
 */
export function resolveScene(
  roomId: string,
  guess: RoomContent | null,
  overrides: SceneOverrides = loadSceneOverrides()
): ResolvedScene | null {
  const override = overrides[roomId] ?? null
  if (!guess && !override) return null

  const usable = <T>(field: SceneField, value: T | undefined): T | undefined =>
    value !== undefined && isDrawable(field, value) ? value : undefined

  // An override the registry has since stopped admitting is ignored rather than
  // honoured, the same way `appearance.ts` ignores a model id the registry no
  // longer holds. The stored value is left alone: a kind can come back when a
  // content pack re-registers it, and deleting somebody's choice because this
  // build cannot draw it today would lose work that a later build could use.
  const ground = usable('ground', override?.ground) ?? guess?.ground ?? 'unknown'
  const block = usable('block', override?.block) ?? (override?.ground ? blockKindFor(ground) : guess?.block ?? blockKindFor(ground))
  const landmark =
    override && 'landmark' in override && isDrawable('landmark', override.landmark)
      ? (override.landmark ?? null)
      : guess?.landmark ?? null

  const tags = guess?.classification.tags ?? []
  const specialKinds = guess?.classification.specialKinds ?? []

  return {
    ground,
    block,
    landmark,
    art: usable('art', override?.art) ?? null,
    primitives: usable('primitives', override?.primitives) ?? [],
    classification: {
      tags,
      specialKinds,
      // Recomputed rather than carried, because the block kind may have moved.
      // `boardLayoutFor` branches on `spatialMode` for a cell's height, so a
      // block-kind override that did not reach this would change the label in
      // the editor and nothing on screen.
      spatialMode: spatialModeFor(block, tags),
      tier: tierFor(specialKinds, tags),
    },
    boundaryEdges: guess?.boundaryEdges ?? [],
    sources: {
      ground: usable('ground', override?.ground) !== undefined ? 'override' : guess ? 'guess' : 'none',
      block: usable('block', override?.block) !== undefined ? 'override' : guess ? 'guess' : 'none',
      landmark:
        override && 'landmark' in override && isDrawable('landmark', override.landmark)
          ? 'override'
          : guess
            ? 'guess'
            : 'none',
      art: usable('art', override?.art) !== undefined ? 'override' : 'none',
      primitives: usable('primitives', override?.primitives) !== undefined ? 'override' : 'none',
    },
  }
}

/** One room, reading the store. The panel's entry point. */
export function resolveSceneForRoom(roomId: string, guess: RoomContent | null): ResolvedScene | null {
  return resolveScene(roomId, guess, loadSceneOverrides())
}

/**
 * One player's curated set, in the shape `tools/build-world-content.mjs` reads
 * back as its first rule.
 *
 * `provenance` says what the file is: a reader who finds one on disk knows it
 * is somebody's hand corrections and not a generated table. Same field, same
 * reason, as `AppearanceExport`. Both it and `version` are read by
 * `parseSceneOverrides` and a file without them is refused - they were
 * type-only until #461, which is the state where a field's existence is doing
 * no work at all.
 */
export interface SceneExport extends ExportEnvelope {
  version: 1
  overrides: SceneOverrides
}

export function exportSceneOverrides(overrides: SceneOverrides = loadSceneOverrides()): SceneExport {
  return { version: SCENE_LIMITS.formatVersion, provenance: 'player', overrides: sorted(overrides) }
}

/**
 * Key order is fixed on the way out, so two exports of the same set are the
 * same bytes. A file whose diff is the insertion order of a Map is a file
 * nobody can review, and this one is meant to be committed as the pipeline's
 * curated tier.
 */
function sorted(overrides: SceneOverrides): SceneOverrides {
  const out: SceneOverrides = {}
  for (const roomId of Object.keys(overrides).sort()) {
    const room = overrides[roomId]
    const next: SceneOverride = {}
    for (const field of SCENE_FIELDS) {
      if (field in room) (next as Record<string, unknown>)[field] = room[field]
    }
    out[roomId] = next
  }
  return out
}

export interface SceneImportResult {
  /** Rooms taken from the file because the local player had no choice there. */
  added: number
  /** Rooms where the file and the local player disagree. Never applied: an
   * import is somebody else's opinion arriving at a machine whose owner has
   * already expressed their own. */
  conflicts: Array<{ roomId: string; field: SceneField; mine: unknown; theirs: unknown }>
  /** Fields naming something this build cannot draw. Counted rather than
   * dropped in silence, and named one by one in `refusals`. */
  undrawable: number
  /** Rooms in the file that were already identical here. */
  unchanged: number
  /** Everything the schema would not keep, each naming its cause. A count of
   * three tells an importer of 200 rooms nothing about which three. */
  refusals: SceneRefusal[]
  /** False when the caller supplied no room list, so nothing here was checked
   * against the map. Not the same claim as "every room is real". */
  roomsChecked: boolean
}

/**
 * Merge somebody else's file into this machine's set.
 *
 * Two stages, and the first is the one #461 was about: nothing reaches the
 * merge that `parseSceneOverrides` has not admitted, so a version this build
 * cannot read, a file with no provenance, a key that is not a room id, a room
 * this map does not have, a primitive carrying a nested payload and a set past
 * the size caps are each refused by name before any of it is stored. The second
 * stage is unchanged: the local player's own choice always wins a conflict.
 *
 * `knownRooms` is how room existence is checked, and it is a parameter because
 * this module cannot ask: the cartography is 85 files loaded a zone at a time,
 * and the panel is the caller that knows which zones a file names. Omitted, the
 * rooms are not checked and `roomsChecked` says so - which is a third answer,
 * not a quiet pass.
 */
export function importSceneOverrides(
  file: unknown,
  mine: SceneOverrides = loadSceneOverrides(),
  options: { knownRooms?: ReadonlySet<string> | null } = {}
): { ok: false; reason: string } | { ok: true; result: SceneImportResult; merged: SceneOverrides } {
  const parsed = parseSceneOverrides(file, options)
  if (!parsed.ok) return parsed
  const incoming = parsed.parsed.overrides
  const result: SceneImportResult = {
    added: 0,
    conflicts: [],
    undrawable: parsed.parsed.refusals.filter((r) => r.field !== null).length,
    unchanged: 0,
    refusals: parsed.parsed.refusals,
    roomsChecked: parsed.parsed.roomsChecked,
  }
  const merged: SceneOverrides = structuredClone(mine)

  for (const roomId of Object.keys(incoming).sort()) {
    const theirs = incoming[roomId]
    for (const field of SCENE_FIELDS) {
      if (!(field in theirs)) continue
      const value = theirs[field]
      const here = merged[roomId]
      if (here && field in here) {
        if (JSON.stringify(here[field]) === JSON.stringify(value)) result.unchanged += 1
        else result.conflicts.push({ roomId, field, mine: here[field], theirs: value })
        continue
      }
      merged[roomId] = { ...(here ?? {}) }
      ;(merged[roomId] as Record<string, unknown>)[field] = value
      result.added += 1
    }
  }

  // The merge can exceed the total cap even when both halves were inside it, so
  // it is checked again on the way out and the rooms that did not fit are named
  // rather than written and then lost at the quota.
  const bounded = parseSceneOverrideSet(sorted(merged), { requireDrawable: false })
  result.refusals = [...result.refusals, ...bounded.refusals]
  return { ok: true, result, merged: bounded.overrides }
}

/**
 * What a compile could not apply, for the rooms it was asked about.
 *
 * #461's third finding: an override naming a room that does not exist was
 * accepted, stored, and then dropped by `compileWorldSnapshot` without a word -
 * the compiler maps over the zone's rooms and never consults an unmatched key,
 * and the snapshot had no field that could have said so. This is that field's
 * source, and both the compiler and the panel read it, so the panel cannot
 * report a different set of problems from the one the viewer actually has.
 *
 * Scoped to one zone on purpose. An override for a room in Ratha is not a fault
 * while Crossing is being compiled - it is simply not this zone's business - so
 * only keys carrying this zone's id are judged, and a key for another zone is
 * not mentioned at all.
 */
export function sceneOverrideDiagnostics(
  zone: { id: string; roomIds: ReadonlySet<string> },
  overrides: SceneOverrides = loadSceneOverrides()
): SceneRefusal[] {
  const out: SceneRefusal[] = []
  for (const [roomId, override] of Object.entries(overrides)) {
    const dash = roomId.lastIndexOf('-')
    if (dash < 0 || roomId.slice(0, dash) !== zone.id) continue
    if (!zone.roomIds.has(roomId)) {
      out.push({ roomId, field: null, reason: `${roomId} is not a room in ${zone.id}, so nothing was drawn for it.` })
      continue
    }
    for (const field of SCENE_FIELDS) {
      if (!(field in override)) continue
      const value = override[field]
      if (field === 'landmark' && value === null) continue
      if (!isDrawable(field, value)) out.push({ roomId, field, reason: `${roomId}: ${undrawable(field, value)}` })
    }
  }
  return out
}
