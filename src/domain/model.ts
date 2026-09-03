/**
 * The game-agnostic domain model.
 *
 * PROPOSAL — nothing imports this yet. See docs/ADAPTERS.md.
 *
 * # The one rule
 *
 * **No symbol in this file may name a game or a game's vocabulary.** No
 * `mindstate`, no `guild`, no `roundtime`, no `wound`, no `stance`. Every one
 * of those feels universal from inside one MUD and is not. If you are unsure
 * whether something belongs here, it does not — it goes in an adapter and
 * surfaces through `extensions`.
 *
 * The doc comments below state **semantics**, not DragonRealms' usage of them,
 * because the intended reader is somebody writing an adapter for a MUD nobody
 * here has played.
 */

/** Ids are opaque strings chosen by the adapter and declared in its manifest. */
export type VitalId = string
export type StreamId = string
export type EntityId = string
export type ItemId = string
export type RoomId = string

/**
 * A value, with where it came from and when it arrived.
 *
 * Carried over unchanged from `src/types/stream.ts`, where it earned its keep,
 * and generalised. The provenance is *inside* the wrapper rather than beside
 * it, and that is the design: two sources can report the same fact — a
 * structured-data channel and a text parse both know your health — and a
 * reader that cannot tell which it holds is how two sources silently overwrite
 * each other. A sibling field answering "where did this come from" is dropped
 * by the first `{...spread}` anybody writes. A wrapper cannot be dropped
 * without the value going with it.
 *
 * `at` exists because "older, but the game said it directly" versus "newer,
 * but inferred from text" is a real choice, and it cannot be made without a
 * timestamp.
 */
export interface Sourced<T> {
  value: T
  /**
   * How this was obtained.
   *
   * - `structured` — the game stated it out of band (GMCP, MSDP, a tagged
   *   stream). Authoritative.
   * - `parsed` — derived from display text by the adapter. Best effort.
   * - `inferred` — deduced from other state rather than observed. Weakest.
   */
  from: 'structured' | 'parsed' | 'inferred'
  /** `Date.now()` at arrival. */
  at: number
  /** The epoch this was observed in. See `Epoch`. */
  epoch: number
}

/**
 * A quantity with an optional ceiling.
 *
 * `max` is `null` rather than absent when the game reports a current value and
 * no maximum — a common case, and distinct from "we have not been told the
 * maximum yet", which is the whole gauge being absent from the map.
 */
export interface Gauge {
  current: number
  max: number | null
}

/**
 * Three states, never two.
 *
 * `unknown` means the game mentioned this flag and said nothing definite about
 * it — observed in real Simutronics traffic as `visible=''`. That is a
 * different fact from the flag being absent from the map entirely, which means
 * the game has never mentioned it. Collapsing either into `false` asserts
 * something about the character that nobody has been told.
 */
export type IndicatorState = 'on' | 'off' | 'unknown'

/**
 * A generation counter for everything derived from the link.
 *
 * # Why this is a first-class concept and not a convention
 *
 * Both the GMCP and MSDP specifications require it. Each states that on a
 * server copyover or a client reconnect all previously exchanged data is lost
 * and the option must be renegotiated from scratch. So "discard everything on
 * reconnect" is not our house caution; it is what the protocols say clients
 * must do.
 *
 * It increments on connect, on disconnect, and on any server-initiated
 * renegotiation. A consumer holding a `Sourced<T>` from an older epoch is
 * holding something the protocol has already declared void, and must render it
 * as absent rather than as a value.
 *
 * For a panel showing combat state, an obviously missing number is safe and a
 * plausible stale one is not. This is the type that makes that difference
 * checkable rather than remembered.
 */
export type Epoch = number

/** Why state was invalidated. Adapters may log it; consumers may explain it. */
export type EpochReason =
  | 'connected'
  | 'disconnected'
  | 'renegotiated'
  | 'character-changed'

/** Whatever the game considers the player's identity. */
export interface Identity {
  /** The name the game addresses the character by. */
  name: string
  /**
   * A secondary label the game displays with the name — a title, a rank, a
   * guild line. Free text, never parsed by core.
   */
  title: string | null
}

/**
 * One thing present in a room, other than the player.
 *
 * `handle` is the stable reference the game itself gives, where it gives one —
 * GemStone's `exist` attribute, a GMCP entity id, an LP object id. Its
 * presence is what lets a client say "attack the third rat" rather than
 * guessing from prose, and its absence is common enough that it must be
 * nullable rather than faked.
 */
export interface Entity {
  id: EntityId
  handle: string | null
  /** The game's own words for this thing. Never synthesised. */
  name: string
  /**
   * A short noun suitable for use in a command, where the game supplies or
   * implies one. `null` when it does not — a client should then use `name`
   * verbatim rather than slicing a guess out of it.
   */
  noun: string | null
}

export interface Item {
  id: ItemId
  handle: string | null
  name: string
  noun: string | null
}

/** An exit as the game describes it. */
export interface Exit {
  /** The command that takes it. The only field a client may act on. */
  command: string
  /** A label for display, when the game distinguishes it from the command. */
  label: string | null
  /** The room this leads to, when the game says. Usually it does not. */
  to: RoomId | null
}

/**
 * The current room.
 *
 * `id` is nullable and that is deliberate. Stable room identity is one of the
 * least standardised things across MUDs: GMCP MUDs commonly send a room vnum,
 * Simutronics does not send one a client can rely on, and many MUDs have no
 * concept at all. A model that requires an id forces every adapter without one
 * to invent it, and an invented id that collides is worse than no id.
 *
 * Everything built on top of room identity — mapping, cartography, the 3D
 * world manifest — is an extension, not core. Core holds the id and nothing
 * else about the graph.
 */
export interface Room {
  id: RoomId | null
  title: string | null
  description: string | null
  exits: Exit[]
  entities: Entity[]
  items: Item[]
}

/**
 * A gate on when the player may next act.
 *
 * Most MUDs have one in some form — a cooldown, a lag counter, a balance or
 * equilibrium, Simutronics' roundtime. They differ in vocabulary and in
 * whether the server announces them, but the *shape* is the same: you may not
 * act until a moment, and a client that knows it can grey a button instead of
 * letting the player type into a wall.
 *
 * Named for the shape rather than any game's word for it. `label` carries the
 * game's own term so a skin can show it without core knowing what it means.
 */
export interface ActionGate {
  /** `Date.now()`-comparable moment the gate lifts. */
  until: number
  label: string | null
}

/**
 * Everything core knows about the player right now.
 *
 * Note what is *not* here: no wounds, no mindstate, no encumbrance, no
 * stance, no experience, no guild. Every one of those is real in some MUDs,
 * absent in others, and shaped differently in the two Simutronics games alone
 * — GemStone models wounds and scars per body part with severity ranks where
 * DragonRealms does something else, and most MUDs have a single number.
 * They live in adapter extensions, described by manifest descriptors.
 */
export interface CharacterState {
  identity: Sourced<Identity> | null
  /**
   * Keyed by `VitalId`. Which ids can appear is declared in the manifest.
   *
   * An open map rather than a struct with named fields, because a struct
   * hardcodes one game's bars and cannot express another's. The manifest is
   * what stops the map being a free-for-all: an id the manifest declares but
   * the map lacks means "not measured yet"; an id the manifest does not
   * declare is a bug the conformance suite catches.
   */
  vitals: ReadonlyMap<VitalId, Sourced<Gauge>>
  indicators: ReadonlyMap<string, Sourced<IndicatorState>>
  gate: Sourced<ActionGate> | null
}

/** The whole normalised picture, at one epoch. */
export interface WorldState {
  epoch: Epoch
  character: CharacterState
  room: Sourced<Room> | null
  /**
   * Adapter-specific state, namespaced by adapter id.
   *
   * Core never reads inside this. A skin renders it only via the
   * `ExtensionDescriptor` entries in the manifest, which is what keeps the
   * skin free of game logic while still being able to show a mindstate bar.
   */
  extensions: Readonly<Record<string, unknown>>
}
