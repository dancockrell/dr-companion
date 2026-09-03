/**
 * Compiles this app's own live room state into the `WorldSnapshot` shape
 * `src-tauri/src/presentation_bridge.rs` and the Godot viewer's
 * `world_manifest_loader.gd`/`bridge_client.gd` already agree on (see
 * `docs/THREE_D_REBUILD_HANDOFF.md` section 4), and publishes it to Rust
 * whenever the room actually changes.
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
import type { CharacterStatus, CombatRange } from '../types/index.ts'
import type { MapRoom, MapZone, MapZoneRoom } from '../bridge/types.ts'
import { fromRoom } from './room.ts'
import type { RoomCard } from './cards.ts'
import { combatantFor, indexCombatants } from './combat.ts'
import { invokeTauri } from './tauri.ts'

/** Matches the Godot-side manifest compiler's own convention
 * (`tools/build-primitive-world-manifest.mjs`'s `mapUnitToMetres`) so a
 * live snapshot's cells land at the same scale as the offline-compiled
 * manifest Codex's content is built against - two independently-computed
 * coordinate systems for the same rooms would be exactly the kind of drift
 * this whole bridge exists to prevent. */
const MAP_UNIT_TO_METRES = 0.25
const LEVEL_HEIGHT_METRES = 5

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface WorldExit {
  move: string
  direction: string
  targetRoomId: number | null
  targetCellId: string | null
}

export interface WorldCell {
  id: string
  title: string
  position: Vec3
  exits: WorldExit[]
}

export interface EntitySnapshot {
  id: string
  roomId: string
  name: string
  noun: string
  /** Already-decided by `fromRoom()` - Godot receives the classification,
   * it never infers hostility from a name or icon. */
  deck: 'hostile' | 'allied' | 'people'
  status: string
  count: number
  /**
   * Bestiary lore, sourced from Elanthipedia (`elanthipedia.play.net` -
   * see `bestiary.ts`'s own doc comment and `docs/KNOWLEDGE.md`'s note that
   * the domain "is their domain and their bill," i.e. genuinely play.net-
   * hosted data, not this app's own guess). `fromRoom()` already looks this
   * up for the existing radar's hover cards; carried through here so
   * Godot's own inspector content (an entity card, a tooltip - Codex's to
   * build, not this file's) has the same source-backed facts to show
   * instead of a bare name with nothing behind it. Absent, never
   * fabricated, when the bestiary has no entry or the match was too
   * ambiguous to trust - `loreApproximate` marks the one case where a
   * lookup succeeded but on weaker evidence ("some troll" matched by noun
   * alone, not an exact name), so a confident-looking stat block doesn't
   * overstate what's actually known.
   */
  lore?: RoomCard['lore']
  loreApproximate?: boolean
  /**
   * Tactical detail, when Lich's creature tracker has any for this entity.
   * Absent - not null-filled - when nothing matched, so "no tactical data"
   * and "assessed as having no statuses" stay different facts.
   */
  tactical?: TacticalSnapshot
}

/**
 * What the game itself already knows about one combatant's position and
 * state. Every field here is carried through verbatim from `RoomCombatant`
 * (`src/types/index.ts`), which Lich's own creature tracker fills - nothing
 * in this file parses combat text, infers an outcome, or decides who is
 * winning.
 *
 * # Why this is the agnostic half of combat
 *
 * It carries no attack, no hit or miss, no damage, no spell and no weapon.
 * A Barbarian swinging a bastard sword and a Moon Mage casting produce the
 * same shape here: bodies, at ranges, in states, facing targets. That makes
 * it renderable without anyone having written a parser for a single combat
 * message - which is the parser this project has deliberately not guessed
 * at - and it stays correct for guilds, weapons and creatures nobody has
 * tested against.
 *
 * # Two schedules, and why staleness travels with the data
 *
 * `dead`, `hostile`, `disengaged` and `statuses` come from `<crtrStatus>`,
 * which the game pushes on every room refresh - effectively live. Everything
 * else comes from `assess`, which is a *pull*: it is null until a player or
 * script has actually run one, and it ages from the moment it lands.
 * `enrichedAgeSeconds` (null = never assessed) is how old that knowledge is,
 * and it is carried rather than dropped precisely so the viewer can show
 * confidence decaying instead of presenting a minute-old position as live
 * fact. `types/index.ts` says it plainly: "Treat range/target/balance as
 * potentially stale past a few dozen seconds, not as a live feed."
 */
export interface TacticalSnapshot {
  /** DR's own three assess buckets. Null when never assessed. */
  range: CombatRange | null
  /**
   * Positional phrase exactly as `assess` worded it. Deliberately NOT
   * normalised into an angle or a facing enum here: this file would be
   * inventing geometry the game never stated.
   *
   * The five phrases `mockBridge.ts` currently produces, measured rather
   * than recalled: "in front of you", "beside you", "flanking you",
   * "across the room", "hidden nearby". That is what the demo fixture
   * contains, NOT a set anyone has confirmed the live game is limited to -
   * a real `assess` may well word things this list does not have. The
   * viewer should place a token from a phrase it recognises and fall back
   * to a neutral position - never a guessed one - for any it does not.
   */
  relation: string | null
  /** Who this is engaging: "you", a player's name, or another creature. */
  target: string | null
  balance: string | null
  /** Below "solidly balanced" - a softer target, if balance is known at all. */
  offBalance: boolean
  /** Broken off combat: present in the room, not fighting. Distinct from
   * range simply being unknown. */
  disengaged: boolean
  dead: boolean
  /** crtrStatus flags, e.g. "stunned", "prone", "hidden". Live. */
  statuses: string[]
  /** Assess-only afflictions crtrStatus does not carry, e.g. "cursed". */
  conditions: string[]
  /** Seconds since the last assess enriched this entry; null = never
   * assessed, which is not the same as "assessed and found current". */
  enrichedAgeSeconds: number | null
}

export interface GroundItemSnapshot {
  id: string
  roomId: string
  name: string
}

export interface WorldSnapshot {
  protocol: 1
  sequence: number
  worldId: string
  currentRoomId: string
  cells: WorldCell[]
  activeRoom: { id: string; title: string }
  entities: EntitySnapshot[]
  groundItems: GroundItemSnapshot[]
  /** The character's own combat state. Null before any status has been
   * parsed - absent knowledge, not a healthy character. */
  player: PlayerSnapshot | null
}

/** Flags that mean the character cannot act at all.
 *
 * Narrow on purpose. `prone` is NOT here: prone is dangerous (most of your
 * defence is gone and standing costs roundtime) but you can still act, and
 * collapsing "vulnerable" into "helpless" would overstate what the game
 * said. `dead`/`dying` are their own presentation problem, not a combat
 * window. Renderers that want a different set have `situation` verbatim. */
const CANNOT_ACT_FLAGS = ['stunned', 'webbed', 'immobilized'] as const

/**
 * The character's own state during a fight.
 *
 * # Why this is the half that matters
 *
 * A competent player is mostly *not* hit - attacks miss, or land lightly,
 * round after round. The damage arrives in the rare windows where the
 * character cannot act: stunned, webbed, immobilized, with hostiles already
 * at melee range. That is when a fight is lost. UberCombat, twenty years of
 * community bug reports deep, gates nearly every action on exactly those
 * three states, which is the same conclusion from the other direction.
 *
 * So this is not a nice-to-have beside an attack feed. Attack events are the
 * *low* information signal - many of them, most meaning "nothing happened."
 * These flags are the high one, they are rare, and they already arrive
 * parsed. Nothing here needs a combat-text parser.
 *
 * # What it must not claim
 *
 * Every `SituationFlag` is an icon that is either lit or not, with no
 * magnitude and no duration behind it (`types/index.ts` says so where the
 * flag union is declared). There is no "3 seconds of stun left" anywhere in
 * this game's output, so nothing may render a stun countdown. `roundtime` is
 * the one honest clock here, and it comes from `XMLData.roundtime_end`.
 */
export interface PlayerSnapshot {
  /** Every lit flag, verbatim, so a renderer is never limited to this
   * file's reading of them. */
  situation: string[]
  /** True when a flag in `CANNOT_ACT_FLAGS` is lit. Computed here rather
   * than in the viewer so two renderers cannot drift on what "helpless"
   * means; `situation` is carried alongside so either can disagree. */
  cannotAct: boolean
  /** Seconds left of roundtime, or null when unknown. The only real clock
   * in this snapshot - no other state here has a duration. */
  roundtime: number | null
  /** Health as a 0-1 fraction, or null when `healthMax` is missing or zero
   * (absent, not "full"). */
  health: number | null
}

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
  sequence: number
}): WorldSnapshot | null {
  const { zone, here, character, sequence } = params

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

  const groundItems: GroundItemSnapshot[] = (character?.roomItems ?? []).map((name, i) => ({
    id: `${currentCellId}:item:${i}`,
    roomId: currentCellId,
    name,
  }))

  // Null rather than a default-shaped block: before any status has been
  // parsed there is no character state to report, and a `player` reading
  // "no flags lit, full health" would be a claim this file cannot support.
  // Same absent-means-unknown contract `injuries` uses in types/index.ts.
  const maxHealth = character?.vitals?.healthMax ?? 0
  const player: PlayerSnapshot | null = character
    ? {
        situation: character.situation ?? [],
        cannotAct: cannotAct(character.situation),
        roundtime: character.roundtime ?? null,
        health: maxHealth > 0 ? character.vitals.health / maxHealth : null,
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

let lastPublishedRoomId: string | null = null
let sequence = 0

/**
 * The one gate between "the room state updated" and "Godot gets a new
 * snapshot." Pure and exported on its own so it can be tested directly,
 * without needing to mock `invokeTauri` - which, being a plain function
 * export off an ES module, cannot be monkey-patched in a test anyway (the
 * module namespace object is frozen).
 *
 * Not every store update means the room changed - vitals, roundtime and
 * dozens of other fields update far more often than the character moves -
 * and a snapshot's real purpose is telling Godot *where the character is*,
 * not mirroring every field change. `force` exists for a reconnect/attach,
 * where the room may be unchanged but Godot still needs a fresh snapshot
 * (a new connection, or one recovering from a dropped event).
 */
export function shouldPublish(nextRoomId: string, lastRoomId: string | null, force: boolean): boolean {
  return force || nextRoomId !== lastRoomId
}

/**
 * True on the exact tick the game bridge transitions from disconnected to
 * connected - a real reconnect, not merely "is connected" (which would also
 * be true on every unrelated re-render) or "was connected" (true forever
 * after the first connect). Used to force a fresh snapshot publish past
 * `shouldPublish`'s room-changed gate, since entities/ground items can
 * change during a dropped connection without the room itself changing.
 */
export function justReconnected(connected: boolean, wasConnected: boolean): boolean {
  return connected && !wasConnected
}

/** The wire shape `presentation_bridge.rs::handle_intent` emits as a
 * `presentation:intent` Tauri event. `kind` is the discriminator; every other
 * field is per-kind and optional here because this arrives as untyped JSON
 * off a socket, not as a value this app built. */
export interface PresentationIntentEvent {
  kind?: string
  fromRoomId?: string
  exitMove?: string
  entityId?: string
  itemId?: string
  roomId?: string
}

/** What an intent should turn into, if anything. */
export interface IntentGameCommand {
  command: string
  label: string
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
 * Publishes a freshly-compiled snapshot to Rust, gated by `shouldPublish`.
 *
 * Silently no-ops in the browser (`invokeTauri` already does) and when
 * `compileWorldSnapshot` returns `null` - there is nothing dishonest to
 * publish in either case, so this never throws over a state the rest of the
 * app already treats as ordinary (not yet connected, zone still loading).
 */
export async function publishWorldSnapshotIfChanged(
  params: { zone: MapZone | null; here: MapRoom | null; character: CharacterStatus | null },
  force = false
): Promise<void> {
  const snapshot = compileWorldSnapshot({ ...params, sequence: sequence + 1 })
  if (!snapshot) return
  if (!shouldPublish(snapshot.currentRoomId, lastPublishedRoomId, force)) return

  sequence += 1
  lastPublishedRoomId = snapshot.currentRoomId
  await invokeTauri('publish_world_snapshot', { snapshot: { ...snapshot, sequence } })
}

/** Test-only: lets `tools/presentation-bridge-test.mjs` (and, if it's ever
 * needed, a future reconnect flow) reset the change-detection state without
 * reaching into module-private variables. */
export function resetPresentationBridgePublishState(): void {
  lastPublishedRoomId = null
  sequence = 0
}

/** What a Godot client needs to connect: the port it should dial, and where
 * its token lives. Same shape as `pythonTasks.ts`'s `ScriptApiInfo` - the
 * Rust command was written mirroring `script_api_info` for exactly this use
 * (a settings panel confirming the socket is up, or pointing a non-Godot
 * client at it by hand) and had no caller until now. */
export type PresentationBridgeInfo = {
  /** `null` before `presentation_bridge::start` has bound the listener. */
  port: number | null
  tokenPath: string
}

export async function presentationBridgeInfo(): Promise<PresentationBridgeInfo> {
  const raw = (await invokeTauri('presentation_bridge_info')) as
    | { port?: number | null; tokenPath?: string }
    | undefined
  return { port: raw?.port ?? null, tokenPath: raw?.tokenPath ?? '' }
}
