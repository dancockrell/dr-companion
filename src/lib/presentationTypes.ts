/**
 * The shapes `presentationBridge.ts` compiles and the Rust/Godot side
 * consumes.
 *
 * Split out of that file so a caller that only needs to name a snapshot does
 * not pull in the compiler, the publish queue and `invokeTauri` with it.
 * These are declarations only: every decision about what goes in them stays
 * in `presentationBridge.ts`, and the doc comments travelled with the types
 * because they are the contract, not commentary on the code that fills them.
 */
import type { CombatRange } from '../types/index.ts'
import type { RoomCard } from './cards.ts'
import type { BoardAnchor, BoardLayout, TetherKind } from './isometric-board-layout.mjs'

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
  tetherKind: TetherKind
  /** Local edge socket for directional exits. Null means that the graph
   * provides no honest compass-side placement for this tether. */
  boardAnchor: BoardAnchor | null
}

export interface WorldCell {
  id: string
  title: string
  position: Vec3
  /** Presentation-only footprint and rig sockets; never movement truth. */
  board: BoardLayout
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
  /**
   * Your own footing: an index into DR's twelve-step balance ladder, or null
   * when unknown. Not converted to a word here - `types/index.ts` documents
   * the ladder, and a second copy of it in this file would be free to drift
   * from Lich's.
   */
  balance: number | null
  /**
   * Who is winning, as DR's own signed scale: -9 (opponent overwhelming you)
   * through 0 (no advantage) to +9 (overwhelming your opponent). Null when
   * no combat round has reported it yet.
   *
   * This is the closest thing the game gives to "how is the fight going",
   * and unlike `assess` it arrives every round without anyone spending a
   * command on it. It needs no combat-text parser: Lich reads DR's own
   * bracketed status line and the bridge forwards the number.
   */
  position: number | null
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

/**
 * Whether the Godot world viewer can be started, and whether it is up.
 *
 * `runningKnown` is false when the process list could not be read at all -
 * never collapse that into `running: false`, because "no viewer" and "could
 * not look" send a person to two different places. Same three-state contract
 * as the Rust side and as `lich.rs` before it.
 */
export type ViewerStatus = {
  installed: boolean
  /** Where the executable is, so a person can confirm which build they are
   * about to run. Null when none was found. */
  path: string | null
  running: boolean
  runningKnown: boolean
}
