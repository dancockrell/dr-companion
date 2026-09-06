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
import { readJSON, writeJSON } from './storage.ts'
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

export function loadSceneOverrides(): SceneOverrides {
  if (cached) return cached
  const value = readJSON<SceneOverrides>(SCENE_STORAGE_KEY, {})
  cached = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
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

export function saveSceneOverrides(value: SceneOverrides): void {
  writeJSON(SCENE_STORAGE_KEY, value)
  cached = value
  announce()
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
  if (!isDrawable(field, value)) {
    return {
      ok: false,
      reason: `${JSON.stringify(value)} is not a ${field} this build can draw. The viewer's registry (${registry.source}) admits: ${optionsFor(field).join(', ') || '(none)'}.`,
    }
  }
  const all = loadSceneOverrides()
  const next: SceneOverride = { ...(all[roomId] ?? {}) }
  ;(next as Record<string, unknown>)[field] = value
  all[roomId] = next
  saveSceneOverrides(all)
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
  const all = loadSceneOverrides()
  const room = all[roomId]
  if (!room) return
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
 * `provenance` says what the file is rather than being read on import: a reader
 * who finds one on disk knows it is somebody's hand corrections and not a
 * generated table. Same field, same reason, as `AppearanceExport`.
 */
export interface SceneExport {
  version: 1
  provenance: 'player'
  overrides: SceneOverrides
}

export function exportSceneOverrides(overrides: SceneOverrides = loadSceneOverrides()): SceneExport {
  return { version: 1, provenance: 'player', overrides: sorted(overrides) }
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
    for (const field of ['ground', 'block', 'landmark', 'art', 'primitives'] as const) {
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
   * dropped in silence. */
  undrawable: number
  /** Rooms in the file that were already identical here. */
  unchanged: number
}

export function importSceneOverrides(
  file: unknown,
  mine: SceneOverrides = loadSceneOverrides()
): { result: SceneImportResult; merged: SceneOverrides } {
  const result: SceneImportResult = { added: 0, conflicts: [], undrawable: 0, unchanged: 0 }
  const merged: SceneOverrides = structuredClone(mine)
  const incoming =
    file && typeof file === 'object' && !Array.isArray(file) && typeof (file as SceneExport).overrides === 'object'
      ? ((file as SceneExport).overrides ?? {})
      : {}

  for (const roomId of Object.keys(incoming).sort()) {
    const theirs = incoming[roomId]
    if (!theirs || typeof theirs !== 'object') continue
    for (const field of ['ground', 'block', 'landmark', 'art', 'primitives'] as const) {
      if (!(field in theirs)) continue
      const value = theirs[field]
      if (!isDrawable(field, value)) {
        result.undrawable += 1
        continue
      }
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
  return { result, merged: sorted(merged) }
}
