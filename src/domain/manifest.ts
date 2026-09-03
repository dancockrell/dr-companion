/**
 * The manifest: how a skin renders a game it has never heard of.
 *
 * PROPOSAL — nothing imports this yet. See docs/ADAPTERS.md.
 *
 * # What this is for
 *
 * The domain model says *what* is true. The manifest says *how to show it* —
 * which gauges exist, what to call them, which channels the game has, which
 * windows to offer. It is data, not code, so a skin can render a MUD nobody
 * wrote the skin for.
 *
 * This is also what makes windows agnostic. A window is
 * `{ id, label, sources }`, not a `MindstateBoard` component that only one
 * game can fill.
 *
 * # Why declaring ids matters
 *
 * `CharacterState.vitals` is an open map. On its own that reintroduces the
 * problem a closed struct was solving: a panel reads `vitals.get('stance')`,
 * gets `undefined` forever, and cannot tell that from "not measured yet".
 *
 * The manifest closes it. Declared-but-absent means *not yet*. Undeclared
 * means *a bug*, and the conformance suite fails an adapter that emits an id
 * it never declared. The openness is in the type; the discipline is in data.
 */
import type { VitalId, StreamId } from './model.ts'

/**
 * A gauge this game can report.
 *
 * `role` is a semantic hint, not a colour. A skin decides that red means
 * danger; the adapter only says which gauge is the one you die without. An
 * adapter that named colours would be making presentation decisions, which is
 * the skin's job and the reason this field is not `colour`.
 */
export interface VitalDescriptor {
  id: VitalId
  /** What players of this game call it. */
  label: string
  /** Short form for tight layouts. Falls back to `label`. */
  shortLabel?: string
  role: 'life' | 'energy' | 'stamina' | 'focus' | 'progress' | 'other'
  /**
   * Whether running low is dangerous. Drives whether a skin may alarm on it.
   * A progress bar filling up is not an emergency; a life gauge emptying is.
   */
  depletionIsHarmful: boolean
  /** Ordering hint within a panel. Lower sorts first. */
  order?: number
}

/**
 * A channel the game separates its own output into.
 *
 * `id` is the game's own label wherever the game supplies one. That is the
 * whole point: a game that tells us "this was a thought" is handing us
 * something no pattern-match recovers, and re-deriving it from prose is how
 * clients get whispers wrong.
 */
export interface StreamDescriptor {
  id: StreamId
  label: string
  /** Hidden by default until the player asks for it. */
  defaultHidden?: boolean
  /**
   * Whether text on this channel also belongs in the main pane.
   * Some games route a copy, some move it outright.
   */
  echoToMain?: boolean
}

/**
 * A pane a skin may offer, described generically.
 *
 * The absence of a `type` field is the design. A `type: 'mindstate'` would put
 * one game's vocabulary into the thing that is supposed to be free of it, and
 * the skin would then need a component per game concept. A window is a place
 * that shows some sources; what makes it a mindstate board is which sources
 * the adapter points it at.
 */
export interface WindowDescriptor {
  id: string
  label: string
  /** Stream ids whose text lands here. */
  sources: StreamId[]
  /**
   * Extension keys this window renders, if any. Resolved against
   * `ExtensionDescriptor`.
   */
  extensions?: string[]
  /** A hint, not an instruction. The player's layout wins. */
  preferredPlacement?: 'main' | 'side' | 'dock' | 'overlay'
}

/**
 * A command the game understands, for skins that want buttons.
 *
 * Movement is the case that matters: a skin cannot render an exit button
 * without knowing the game's word for "go north", and hardcoding compass
 * points excludes every MUD with named exits.
 */
export interface CommandDescriptor {
  id: string
  label: string
  /** Literal text sent to the game. May contain `{arg}` placeholders. */
  template: string
  category?: 'movement' | 'inspection' | 'inventory' | 'communication' | 'other'
}

/**
 * How to render one piece of adapter-specific state.
 *
 * This is the escape hatch that keeps core small without making adapters
 * second-class. A DragonRealms mindstate ladder, a GemStone wound table, an
 * Aardwolf quest timer — none belong in the domain model, and all of them are
 * the reason somebody uses a client instead of a telnet window.
 *
 * `render` names a *generic shape*, not a game concept. A skin implements the
 * handful of shapes once and gets every game's extensions for free. A shape a
 * skin does not implement degrades to `text`, which is why every extension
 * must also supply something printable.
 */
export interface ExtensionDescriptor {
  /** Key within `WorldState.extensions[adapterId]`. */
  key: string
  label: string
  render:
    | 'text'
    | 'gauge'
    | 'gauge-list'
    | 'key-value'
    | 'table'
    | 'badge-list'
    | 'timer'
  /** One-line explanation a skin may show in a tooltip. */
  help?: string
}

/**
 * Everything a skin needs to render this game.
 *
 * Serialisable on purpose: it crosses to the Godot viewer and could cross to a
 * third-party skin over a socket. Nothing in here may be a function.
 */
export interface GameManifest {
  vitals: VitalDescriptor[]
  streams: StreamDescriptor[]
  windows: WindowDescriptor[]
  commands: CommandDescriptor[]
  extensions: ExtensionDescriptor[]
}
