/**
 * The adapter contract. This is the public API third parties implement.
 *
 * PROPOSAL — nothing imports this yet. See docs/ADAPTERS.md.
 *
 * # The intended reader
 *
 * Somebody — or somebody's AI — who wants a client for a MUD nobody here has
 * played, who will read this file and the reference adapter and nothing else.
 * Everything they need to know is stated here rather than implied by how
 * DragonRealms happens to use it.
 */
import type {
  CharacterState,
  Entity,
  EpochReason,
  Epoch,
  Gauge,
  IndicatorState,
  Item,
  Room,
  Identity,
  ActionGate,
  StreamId,
  VitalId,
} from './model.ts'
import type { GameManifest } from './manifest.ts'

/**
 * What an adapter can do.
 *
 * A capability that is not declared is **unavailable**, which is different
 * from false and different again from unknown. Same three-state discipline as
 * `IndicatorState`, and for the same reason: folding "we cannot tell" into
 * "no" is how a client confidently tells somebody the wrong thing.
 */
export type Capability =
  /** The game sends structured out-of-band state: GMCP, MSDP, or equivalent. */
  | 'structured-state'
  /** The game labels its own output channels; we are not guessing from prose. */
  | 'named-streams'
  /** Room ids are stable and suitable for mapping. */
  | 'room-graph'
  /** Entities carry stable handles, so "the third rat" is addressable. */
  | 'entity-handles'
  /**
   * The server pushes UI layout — positioned, anchored widgets.
   *
   * GemStone's `openDialog`/`dialogData` is the only known example. No GMCP
   * MUD does this. It is a capability rather than a core concept precisely
   * because a skin is entitled to ignore it.
   */
  | 'server-ui'
  /** MCCP or equivalent stream compression is in use. */
  | 'compression'
  /** MSSP server metadata is available. */
  | 'server-status'

/** One line of text on its way to a pane. */
export interface DisplayLine {
  text: string
  /**
   * The channel the game itself put this on, or `null` for the main pane.
   *
   * Never the adapter's inference when the game supplied a label. An adapter
   * for a game with no channels reports `null` throughout, which is honest.
   */
  stream: StreamId | null
  /** The game marked this emphatic — a room title, a shout. */
  emphatic?: boolean
  /** Punctuation rather than content; a skin may collapse these. */
  prompt?: boolean
}

/**
 * A normalised state change.
 *
 * # Why the last member exists
 *
 * The existing Godot bridge contract (`docs/THREE_D_REBUILD_HANDOFF.md` §4)
 * defines `PresentationEvent.kind` as a closed union — enter, leave, advance,
 * retreat, attack, hit, miss, parry, evade, block, cast, death, item-drop.
 * That list is DragonRealms combat seen from the outside, and it has exactly
 * the defect the closed vitals struct had: an adapter for a MUD with a concept
 * not on the list has nowhere to put it, and the only fix is editing core.
 *
 * So the core kinds below are the ones defensible across MUDs, and everything
 * else is an `extension` event carrying the adapter's namespace. A skin that
 * understands a namespace renders it; one that does not ignores it. Neither
 * requires a change here.
 */
export type DomainEvent =
  | { kind: 'epoch'; epoch: Epoch; reason: EpochReason }
  | { kind: 'identity'; value: Identity }
  | { kind: 'vital'; id: VitalId; value: Gauge }
  | { kind: 'indicator'; id: string; value: IndicatorState }
  | { kind: 'gate'; value: ActionGate | null }
  | { kind: 'room'; value: Room }
  | { kind: 'entity-enter'; entity: Entity }
  | { kind: 'entity-leave'; entityId: string }
  | { kind: 'item-appear'; item: Item }
  | { kind: 'item-remove'; itemId: string }
  | {
      kind: 'extension'
      /** The adapter's id, so two adapters cannot collide. */
      namespace: string
      /** Matches an `ExtensionDescriptor.key` in the manifest. */
      key: string
      data: unknown
      /**
       * The game's own words for this, so a skin with no idea what `key`
       * means can still show something true.
       *
       * Borrowed from `PresentationEvent.authoritativeText` in the Godot
       * contract, which had the right instinct: the renderer never invents
       * prose, it repeats the game's.
       */
      text?: string
    }

export interface FeedContext {
  /** Current epoch. Adapters stamp what they emit with it. */
  epoch: Epoch
  /** Injected so adapters are testable without faking the clock globally. */
  now: () => number
}

export interface AdapterOutput {
  lines: DisplayLine[]
  events: DomainEvent[]
}

/**
 * The contract.
 *
 * Implement this and the client works for your MUD. The conformance suite is
 * the definition of done — if it passes, the adapter is correct, and no
 * conversation with us is required.
 */
export interface GameAdapter {
  /** Stable, lowercase, hyphenated. Namespaces this adapter's extensions. */
  readonly id: string
  readonly displayName: string

  /**
   * The `DOMAIN_SCHEMA_VERSION` this adapter was written against.
   * Checked at registration; a mismatched major is refused, not tolerated.
   */
  readonly schemaVersion: string

  readonly capabilities: ReadonlySet<Capability>
  readonly manifest: GameManifest

  /**
   * Consume whatever arrived, in whatever sizes.
   *
   * # Three rules, all of which the conformance suite enforces
   *
   * **Chunk boundaries are arbitrary.** A tag, a telnet subnegotiation or a
   * GMCP JSON body may be split across calls. Buffer internally. Feeding one
   * stream split at any boundary must produce identical output — splitting
   * lines before parsing them is the single most common way to get this
   * wrong, and it fails only on the packet sizes you did not test.
   *
   * **Never throw.** Truncated tags, malformed JSON, invalid UTF-8, a lone
   * IAC. GMCP's own specification is loose enough that implementations differ
   * and at least one major operator has shipped payloads that break their own
   * format. An adapter that rejects bad input is a client that goes blank on
   * the evening a MUD ships a bad build.
   *
   * **Never swallow.** Every byte reaches `lines`, an event, or an extension.
   * Text the adapter does not understand goes to `lines` unchanged. A client
   * that drops what it cannot parse silently loses the one message that
   * mattered.
   */
  feed(chunk: Uint8Array, ctx: FeedContext): AdapterOutput

  /** Turn a player command into bytes, framed as this game expects. */
  encode(command: string): Uint8Array

  /**
   * Discard everything derived.
   *
   * Called on every epoch change. After this returns, no field may hold a
   * pre-reset value — the protocols require it (GMCP and MSDP both mandate a
   * full renegotiation after a copyover or reconnect), and the conformance
   * suite checks it rather than trusting it.
   */
  reset(reason: EpochReason): void

  /**
   * Current normalised state, if the adapter maintains one.
   *
   * Optional because an adapter may be purely event-emitting and let the core
   * accumulate. Both designs are legitimate; the suite tests whichever is
   * offered.
   */
  snapshot?(): { character: CharacterState; room: Room | null }
}
