/**
 * Compiles this app's own live room state into the `WorldSnapshot` shape
 * `src-tauri/src/presentation_bridge.rs` and the Godot viewer's
 * `world_manifest_loader.gd`/`bridge_client.gd` already agree on (see
 * `docs/THREE_D_REBUILD_HANDOFF.md` section 4), and publishes it to Rust
 * whenever any viewer-relevant live fact or zone topology changes.
 *
 * This file is the one place that turns "what this app already knows" into
 * "what Godot is told." It never talks to Godot directly - only to Rust, via
 * `publish_world_snapshot` - and it never invents topology: room ids,
 * titles, positions and exits all come straight from `MapZone`/`MapZoneRoom`
 * (`src/bridge/types.ts`), the same normalized shape whether it came from a
 * live Lich zone or the offline fallback (`mapData.ts`'s own doc comment:
 * "When Lich is connected its own zone data wins... it is authoritative
 * about where the character actually is"). Godot's placeholder-primitive
 * scene slots get filled from a separately-compiled art manifest
 * (`tools/build-primitive-world-manifest.mjs`); this file only carries the
 * topology and live occupants, matching the brief's split of "compile
 * existing authoritative room IDs, room graph, legal exits... into
 * versioned deterministic manifests" (offline) from "publish confirmed
 * state" (this file, live).
 *
 * # Rooms as teleportation nodes
 *
 * A `WorldCell` carries a position (for Godot's camera and layout) and a
 * closed set of real exits - nothing about how the space between two rooms
 * looks or how far apart they are implies anything about how *movement*
 * between them works. Movement is a graph edge, not a physical traversal:
 * walking through an exit takes the character from one room-node directly
 * to the node it names, in one step, exactly the way the MUD underneath it
 * already works (`go` and compass moves resolve to a destination room, not
 * a simulated walk through 3D space). Godot is free to *animate* that edge
 * as a smooth camera move or a stylized teleport effect; nothing about the
 * data model requires or implies continuous physical space between two
 * connected cells, and no code here computes one.
 *
 * # Entities are tethered to their room, not given independent coordinates
 *
 * `EntitySnapshot` carries a `roomId`, never an `x`/`y`/`z` of its own. A
 * creature or player is *in* a room the same way this app's existing
 * `fromRoom()` (`src/lib/room.ts`) already models it for the radar - never
 * "at some point near a room." Godot positions an entity's miniature by
 * looking up its room's cell position and offsetting within that cell for
 * legibility (several occupants of one room need to not overlap); that
 * offset is a presentation choice Godot's content owns, not a fact this
 * file asserts about where in the room someone metaphysically stands.
 *
 * `tools/build-node-tethered-world-projection.mjs` arrives at the same
 * model independently, one layer over: it compiles the *offline* world
 * manifest into a static node/transition graph for content authoring
 * ("Live actors are tethered to their reported room node. Local positions
 * are renderer slots only" - its own generatedFrom.actorTruth, word-for-
 * word the same claim this file makes about live entities). That file is
 * build-time and static; this one is runtime and live. Two layers of the
 * same architecture, not two competing ones - if the two ever describe the
 * tethering model differently, that is drift worth fixing, not a sign
 * either one is wrong.
 */
import type { CharacterStatus, InventorySummary } from '../types/index.ts'
import type { MapRoom, MapZone, MapZoneRoom } from '../bridge/types.ts'
import { appearanceFor, playerAppearanceFor } from './appearance.ts'
import { fromRoom } from './room.ts'
import { combatantFor, indexCombatants } from './combat.ts'
import {
  boardLayoutFor,
  classifyTether,
  tetherAnchorFor,
} from './isometric-board-layout.mjs'
import { invokeTauri } from './tauri.ts'
import type {
  Vec3,
  WorldExit,
  WorldCell,
  EntitySnapshot,
  TacticalSnapshot,
  GroundItemSnapshot,
  WorldSnapshot,
  PlayerSnapshot,
  PresentationIntentEvent,
  IntentGameCommand,
} from './presentationTypes.ts'

/** Matches the Godot-side manifest compiler's own convention
 * (`tools/build-primitive-world-manifest.mjs`'s `mapUnitToMetres`) so a
 * live snapshot's cells land at the same scale as the offline-compiled
 * manifest Codex's content is built against - two independently-computed
 * coordinate systems for the same rooms would be exactly the kind of drift
 * this whole bridge exists to prevent. */
const MAP_UNIT_TO_METRES = 0.25
const LEVEL_HEIGHT_METRES = 5

/** Flags that mean the character cannot act at all.
 *
 * Narrow on purpose. `prone` is NOT here: prone is dangerous (most of your
 * defence is gone and standing costs roundtime) but you can still act, and
 * collapsing "vulnerable" into "helpless" would overstate what the game
 * said. `dead`/`dying` are their own presentation problem, not a combat
 * window. Renderers that want a different set have `situation` verbatim. */
const CANNOT_ACT_FLAGS = ['stunned', 'webbed', 'immobilized'] as const


/**
 * Pure: does this situation list mean the character cannot act? Exported and
 * tested directly, beside `shouldPublish`/`justReconnected`/
 * `gameCommandForIntent` - the other pure decisions this bridge makes.
 */
export function cannotAct(situation: readonly string[] | undefined): boolean {
  if (!situation) return false
  return situation.some((flag) =>
    (CANNOT_ACT_FLAGS as readonly string[]).includes(flag)
  )
}

function cellId(zoneId: string, roomId: number): string {
  return `${zoneId}-${roomId}`
}

/** Pairs a room's `moves[]` with its `links[]` by index - the same pairing
 * `mapData.ts`'s `toZoneRoom` builds them with (`moves` appends zone-leaving
 * `leaves` after the linked exits, so `moves.length` can exceed
 * `links.length`; anything past `links.length` is a real exit that leaves
 * the loaded zone, not an invented one - see `WorldExit`'s own null
 * `targetCellId` for how that's represented, the same convention the
 * Godot-side mock fixture already uses for exits pointing outside its
 * loaded subset). */
function exitsFor(zoneId: string, room: MapZoneRoom): WorldExit[] {
  const moves = room.moves ?? []
  const links = room.links ?? []
  return moves
    .map((move) => move.trim())
    .filter(Boolean)
    .map((move, i) => {
      const link = links[i]
      return {
        move,
        direction: link ? link.kind : 'leave-zone',
        targetRoomId: link ? link.to : null,
        targetCellId: link ? cellId(zoneId, link.to) : null,
        tetherKind: classifyTether(move, link?.kind ?? 'leave-zone'),
        boardAnchor: tetherAnchorFor(move),
      }
    })
}

function worldPosition(room: MapZoneRoom): Vec3 {
  return {
    x: (room.x ?? 0) * MAP_UNIT_TO_METRES,
    y: (room.z ?? 0) * LEVEL_HEIGHT_METRES,
    z: -(room.y ?? 0) * MAP_UNIT_TO_METRES,
  }
}

/**
 * Pure compiler: today's `MapZone`/current room/character status in, a
 * `WorldSnapshot` out - or `null` when there isn't enough confirmed state to
 * publish one honestly (see each guard's own comment). Never throws, never
 * fills a gap with a guess.
 */
export function compileWorldSnapshot(params: {
  zone: MapZone | null
  here: MapRoom | null
  character: CharacterStatus | null
  /**
   * Optional because appearance is enrichment: what the character is wearing
   * comes from `InventorySummary.worn`, which is a separate store field and a
   * separate bridge call, and a snapshot published before the first inventory
   * scan is still a complete snapshot. Absent means "not asked yet", which is
   * why `worn` itself is optional inside it - see its own doc comment.
   */
  inventory?: InventorySummary | null
  sequence: number
}): WorldSnapshot | null {
  const { zone, here, character, inventory, sequence } = params

  // No zone, no zone id, or the zone itself reported failure: there is
  // nothing true to publish. A snapshot with an empty cells array would
  // read to Godot as "a real zone with zero rooms," which is not the same
  // fact as "no zone data is available yet."
  if (!zone || !zone.ok || !zone.zone) return null
  const zoneId = zone.zone
  const hereId = here?.id ?? zone.here ?? null
  if (hereId == null) return null

  const rooms = (zone.rooms ?? []).filter((r): r is MapZoneRoom & { id: number } => r.id != null)
  const cells: WorldCell[] = rooms.map((room) => ({
    id: cellId(zoneId, room.id),
    title: room.title ?? '',
    position: worldPosition(room),
    board: boardLayoutFor({}),
    exits: exitsFor(zoneId, room),
  }))

  const currentCellId = cellId(zoneId, hereId)
  const currentCell = cells.find((c) => c.id === currentCellId)
  // The character's own current room has to be a real cell in this exact
  // snapshot's own cell list - the same invariant
  // `presentation_bridge.rs::validate_walk` checks server-side (a snapshot
  // whose current room isn't among its own cells is refused there too).
  // Publishing one client-side that already violates it would just move the
  // inevitable rejection one step later.
  if (!currentCell) return null

  // The same noun-matched correlation the 2D battle panel already uses
  // (`combat.ts`), deliberately reused rather than reimplemented: a second
  // copy of "which tracked combatant is this card" would be free to drift
  // from the one players already see in BattleColumn, and its documented
  // ambiguity (two identical hostiles cannot be told apart by noun alone)
  // would then differ between the two views of the same room. Built once
  // per compile, then claimed per card, exactly as that panel does it.
  const combatants = indexCombatants(character?.roomCombatants)

  const entities: EntitySnapshot[] = fromRoom(character).map((card) => {
    const tracked = combatantFor(card, combatants)
    // Resolved from the entity's own noun, which for a creature names neither
    // a weapon nor a piece of armour, so this is absent nearly always - and
    // that is the intended answer rather than a shortfall. Guessing a mesh
    // for an unrecognised noun is the substitution the asset registry's
    // `forbiddenSubstitutions` rule forbids.
    const appearance = appearanceFor('weapon', card.noun) ?? appearanceFor('armor', card.noun)
    return {
      id: card.id,
      roomId: currentCellId,
      name: card.name,
      noun: card.noun,
      deck: card.deck,
      status: card.status,
      count: card.count,
      // Elanthipedia-sourced (play.net) bestiary lore, when fromRoom() found
      // any - see EntitySnapshot's own doc comment.
      ...(card.lore ? { lore: card.lore } : {}),
      ...(card.loreApproximate ? { loreApproximate: card.loreApproximate } : {}),
      ...(appearance ? { appearance } : {}),
      // Carried through field for field, never reshaped or defaulted - see
      // TacticalSnapshot's doc comment for why staleness travels with it.
      ...(tracked
        ? {
            tactical: {
              range: tracked.range,
              relation: tracked.relation,
              target: tracked.target,
              balance: tracked.balance,
              offBalance: tracked.offBalance,
              disengaged: tracked.disengaged,
              dead: tracked.dead,
              statuses: tracked.statuses ?? [],
              conditions: tracked.conditions ?? [],
              enrichedAgeSeconds: tracked.enrichedAgeSeconds,
            } satisfies TacticalSnapshot,
          }
        : {}),
    }
  })

  const groundItems: GroundItemSnapshot[] = (character?.roomItems ?? []).map((name, i) => {
    const appearance = appearanceFor('weapon', name) ?? appearanceFor('armor', name)
    return {
      id: `${currentCellId}:item:${i}`,
      roomId: currentCellId,
      name,
      ...(appearance ? { appearance } : {}),
    }
  })

  // Null rather than a default-shaped block: before any status has been
  // parsed there is no character state to report, and a `player` reading
  // "no flags lit, full health" would be a claim this file cannot support.
  // Same absent-means-unknown contract `injuries` uses in types/index.ts.
  const maxHealth = character?.vitals?.healthMax ?? 0
  const playerAppearance = character
    ? playerAppearanceFor(character.hands, inventory?.worn)
    : null
  const player: PlayerSnapshot | null = character
    ? {
        situation: character.situation ?? [],
        cannotAct: cannotAct(character.situation),
        roundtime: character.roundtime ?? null,
        health: maxHealth > 0
          ? Math.max(0, Math.min(1, character.vitals.health / maxHealth))
          : null,
        // `?? null`, never `|| null`: 0 is meaningful in both of these.
        // Balance 0 is 'completely' off your feet - the worst rung of the
        // ladder, not a missing reading - and position 0 is an even
        // contest. Coercing either to null would report the most dangerous
        // moment in a fight, and the moment it is dead even, as "unknown".
        balance: character.balance ?? null,
        position: character.position ?? null,
        // `hands` is the wielded-item field - it is not called `wield`
        // anywhere in this codebase, which is worth saying because the
        // obvious grep for one misses it. Absent when neither hand nor any
        // worn piece resolved to a class.
        ...(playerAppearance ? { appearance: playerAppearance } : {}),
      }
    : null

  return {
    protocol: 1,
    sequence,
    worldId: zoneId,
    currentRoomId: currentCellId,
    cells,
    activeRoom: { id: currentCellId, title: currentCell.title },
    entities,
    groundItems,
    player,
  }
}

let lastPublishedProjectionKey: string | null = null
let lastPublishedZone: MapZone | null = null
let sequence = 0
let publishQueue: Promise<void> = Promise.resolve()

/**
 * The one gate between "viewer-relevant state updated" and "Godot gets a new
 * snapshot." Pure and exported on its own so it can be tested directly,
 * without needing to mock `invokeTauri` - which, being a plain function
 * export off an ES module, cannot be monkey-patched in a test anyway (the
 * module namespace object is frozen).
 *
 * The signature contains exactly the live facts Godot projects, not the full
 * zone topology. This matters now that the snapshot carries health,
 * roundtime, action locks, occupants, ground items, and assessed creature
 * state: gating only on room id froze every one of those facts until the
 * player moved. Topology changes are detected separately by the zone object
 * identity in `publishWorldSnapshotIfChanged`, avoiding a megabyte-scale
 * stringify on every status tick.
 */
export function shouldPublish(nextProjectionKey: string, lastProjectionKey: string | null, force: boolean): boolean {
  return force || nextProjectionKey !== lastProjectionKey
}

/** Stable signature for every live field the current Godot projection reads.
 * Cell topology is deliberately excluded and tracked by zone object identity
 * at the publication boundary; `sequence` is excluded because it changes only
 * as a consequence of publishing and must never trigger publication itself. */
export function projectionKey(snapshot: WorldSnapshot): string {
  return JSON.stringify({
    worldId: snapshot.worldId,
    currentRoomId: snapshot.currentRoomId,
    activeRoom: snapshot.activeRoom,
    entities: snapshot.entities,
    groundItems: snapshot.groundItems,
    player: snapshot.player,
  })
}

/**
 * True on the exact tick the game bridge transitions from disconnected to
 * connected - a real reconnect, not merely "is connected" (which would also
 * be true on every unrelated re-render) or "was connected" (true forever
 * after the first connect). Used to force a fresh snapshot publish past
 * `shouldPublish`'s semantic-change gate, since state can change during a
 * dropped connection and then settle back to the last published signature.
 */
export function justReconnected(connected: boolean, wasConnected: boolean): boolean {
  return connected && !wasConnected
}


/**
 * Pure: decides what game command an incoming intent becomes, or `null` for
 * none. Lives here beside `shouldPublish` and `justReconnected` - the other
 * two pure decisions this bridge makes - so it can be tested without a Tauri
 * event loop or a socket. `presentationIntents.ts` is the wiring that calls
 * it; see that file's doc comment for why sending a command here is safe.
 *
 * Only `walk` produces a command. The other three intents are read-only
 * presentation concerns Godot has already handled or that belong in a
 * wrapper panel (`focus-room` never even needs this app - Rust's own comment
 * notes Godot already has every cell position once it has a snapshot), so
 * they resolve to `null` rather than being quietly treated as walks. The
 * decision keys on `kind` alone, never on which fields happen to be present.
 */
export function gameCommandForIntent(
  event: PresentationIntentEvent
): IntentGameCommand | null {
  if (event.kind !== 'walk') return null

  const move = (event.exitMove ?? '').trim()
  // An empty exit would be refused by validateGameActionCommand a moment
  // later anyway, but as a *failure notice* in the player's face. A walk
  // intent with no move in it is a bug upstream, not something the player
  // did, so it is dropped here instead of being reported to them.
  if (!move) return null

  return { command: move, label: `Viewer walk “${move}”` }
}

/**
 * Publishes a freshly-compiled snapshot to Rust when any projected fact or
 * zone topology changes, gated by `shouldPublish`.
 *
 * Silently no-ops in the browser (`invokeTauri` already does) and when
 * `compileWorldSnapshot` returns `null` - there is nothing dishonest to
 * publish in either case, so this never throws over a state the rest of the
 * app already treats as ordinary (not yet connected, zone still loading).
 */
export async function publishWorldSnapshotIfChanged(
  params: {
    zone: MapZone | null
    here: MapRoom | null
    character: CharacterStatus | null
    inventory?: InventorySummary | null
  },
  force = false
): Promise<void> {
  const snapshot = compileWorldSnapshot({ ...params, sequence: sequence + 1 })
  if (!snapshot) return
  const nextProjectionKey = projectionKey(snapshot)
  const nextZone = params.zone
  // Store updates can outpace a native invocation. Serialize publications so
  // sequences stay strictly increasing and an older snapshot cannot finish
  // after a newer one. Recover the queue before the next item so one rejected
  // native call remains retryable instead of poisoning every future publish.
  publishQueue = publishQueue.catch(() => undefined).then(async () => {
    const zoneChanged = nextZone !== lastPublishedZone
    if (!zoneChanged && !shouldPublish(nextProjectionKey, lastPublishedProjectionKey, force)) return
    const nextSequence = sequence + 1
    await invokeTauri('publish_world_snapshot', { snapshot: { ...snapshot, sequence: nextSequence } })
    // A failed native call throws. Only advance the deduplication state after
    // the bridge accepted the publish, so the next update can retry honestly.
    sequence = nextSequence
    lastPublishedProjectionKey = nextProjectionKey
    lastPublishedZone = nextZone
  })
  await publishQueue
}

/** Test-only: lets `tools/presentation-bridge-test.mjs` (and, if it's ever
 * needed, a future reconnect flow) reset the change-detection state without
 * reaching into module-private variables. */
export function resetPresentationBridgePublishState(): void {
  lastPublishedProjectionKey = null
  lastPublishedZone = null
  sequence = 0
  publishQueue = Promise.resolve()
}
