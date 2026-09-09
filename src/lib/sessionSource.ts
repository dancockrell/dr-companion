/**
 * Where the words on screen come from: the demo, or the game. Decided once.
 *
 * # What was wrong (issues #523 and #525)
 *
 * These were two states nobody owned together. `bridgeMode: 'mock'` is the
 * demo, and it lives in the store; the game socket lives in `gameLink.ts`,
 * outside the store on purpose. Neither module mentioned the other, so the
 * pair could be set independently and the app had no opinion about the
 * combination. Measured on `origin/main` by `tools/lane-attach-probe.mjs`:
 *
 *     setBridgeMode() mentions the game socket at all: false
 *     attachGame() mentions the demo/bridge mode at all: false
 *
 * What a player got out of that, on the clean VM on 9 September 2026: the
 * demo running, a real Lich attached, the channel counters climbing off the
 * live stream, the vitals reading the live character, and across the top of
 * it all the demo banner saying "this is invented data". One indicator, and
 * it was telling them the opposite of what was happening in half the window.
 *
 * # The rule
 *
 * **Demo and game are mutually exclusive, and the one the player just asked
 * for is the one they get.** Pressing Attach, or signing in, ends the demo.
 * Pressing Start the demo ends the socket. Neither refuses, because both are
 * unambiguous requests and a refusal makes the player undo something first to
 * be allowed to ask for the thing they already asked for. Both say what they
 * ended, in the log and on the screen that changed.
 *
 * The alternative - refuse the second one and explain - was considered and
 * rejected for that reason. It is also the version that leaves a player who
 * pressed Attach still looking at invented text, which is the defect.
 *
 * # "Unrepresentable" is a claim worth being exact about
 *
 * The pair is representable in the type: `bridgeMode` and `gameSocketOpen` are
 * two independent fields and TypeScript cannot forbid a combination of two
 * booleans held in two modules. What this file does instead, in order of
 * strength:
 *
 *  1. {@link enterSession} is the only transition either side may use, and it
 *     ends the other source first. So the pair is not *reachable* through any
 *     player act. `tools/session-source-test.mjs` walks every sequence of acts
 *     up to length four and asserts the pair never occurs - by driving the
 *     transitions, not by inspecting a rendered view.
 *  2. {@link sessionSource} **throws** when handed the pair. A future change
 *     that reintroduces it fails loudly at the one place every consumer reads,
 *     rather than quietly painting a demo banner over live text. A crash is a
 *     worse day than a lie for exactly one person and a better one for
 *     everybody after them.
 *  3. `tools/session-source-test.mjs` derives the consumer set from the tree
 *     and asserts that every component deciding demo-or-game reads it from
 *     here, so a second opinion added tomorrow fails rather than merely
 *     disagreeing. Same argument `linkPhase` (#514) and `bridgePhase` (#532)
 *     make, and the reason this is a module rather than four lines in a store.
 *
 * Type-only imports, and no runtime import of the bridge or of `gameLink`.
 * Both reach `import.meta.glob` eventually, and one runtime import would put
 * this module out of reach of a plain `node` test - which is precisely how the
 * invariant came to have no test in the first place.
 */

/** The demo, the game, or neither. There is no fourth and there is no both. */
export type SessionSource = 'demo' | 'live' | 'none'

/** What the source is read from. A plain object so a test can state every cell. */
export interface SessionReading {
  /** The store's `bridgeMode`. `'mock'` is the demo; there is no separate flag. */
  bridgeMode: 'mock' | 'live'
  /**
   * Whether a game socket is open - `gameState().connected`, not the bridge.
   *
   * The bridge and the game socket are different connections to different
   * ports, and conflating them is how the empty state came to hide the control
   * that opens this one.
   */
  gameSocketOpen: boolean
}

/** Thrown when the demo and a live game socket are both on. See the header. */
export class BothSourcesError extends Error {
  constructor() {
    super(
      'The demo and a live game socket are both on. Nothing may show invented ' +
        'text beside real text: go through enterSession() so one ends the other.'
    )
    this.name = 'BothSourcesError'
  }
}

/**
 * Which source the session is reading from.
 *
 * `'live'` for an open socket, and note that it does not require a character.
 * "Attached to the game with nobody logged in yet" is a real state a player
 * reaches every time, and calling it `'none'` is what put "Nothing is
 * connected yet" over an open socket (#523).
 */
export function sessionSource(r: SessionReading): SessionSource {
  if (r.bridgeMode === 'mock') {
    if (r.gameSocketOpen) throw new BothSourcesError()
    return 'demo'
  }
  return r.gameSocketOpen ? 'live' : 'none'
}

/** What the player asked for. Both are explicit acts; neither is a default. */
export type SessionWant = 'demo' | 'live'

/**
 * What has to end before `want` can begin, and what to tell the player.
 *
 * Returns `say: null` when nothing had to end, so a caller cannot end up
 * announcing a change that did not happen - the "stale warning" defect one
 * level down. Every sentence here is the player's words: no `bridgeMode`, no
 * `mock`, no socket.
 */
export interface SessionSwitch {
  /** Leave the demo before starting the game. */
  endDemo: boolean
  /** Close the game socket before starting the demo. */
  endSocket: boolean
  /** One line naming what was ended, or null when nothing was. */
  say: string | null
}

export function enterSession(from: SessionReading, want: SessionWant): SessionSwitch {
  if (want === 'live') {
    const endDemo = from.bridgeMode === 'mock'
    return {
      endDemo,
      endSocket: false,
      say: endDemo ? 'Left the demo, because the game is the real thing and the two cannot both be on screen.' : null,
    }
  }
  const endSocket = from.gameSocketOpen
  return {
    endDemo: false,
    endSocket,
    say: endSocket
      ? 'Closed the connection to the game, because the demo cannot run beside it.'
      : null,
  }
}

/**
 * The words for a source, so no two screens describe the same state
 * differently.
 *
 * `heading` is a statement of where the words come from, not a greeting, and
 * `sentence` always says what to do next rather than only what happened - the
 * same rule the bridge chip and the sign-in screens follow.
 */
export interface SessionWords {
  heading: string
  sentence: string
}

export function sessionWords(source: SessionSource): SessionWords {
  switch (source) {
    case 'demo':
      return {
        heading: 'This is the demo.',
        sentence:
          'Every line, number and room here is invented. Sign in, or attach to a Lich that is already running, and the demo ends.',
      }
    case 'live':
      return {
        heading: 'Connected to the game.',
        sentence:
          'Real game text is arriving below. Log a character in, or type in the command line, and the rest of the window fills in.',
      }
    case 'none':
      return {
        heading: 'Nothing is connected yet.',
        sentence:
          'Sign in and the app starts Lich for you, attach to one that is already running, or start the demo to look around an invented character.',
      }
  }
}

// ---------------------------------------------------------------------------
// Which screen the window is on, and what can be pressed on it.
// ---------------------------------------------------------------------------

/**
 * The states the main area can be in, and there are six because folding any
 * two of them leaves a player somewhere with nothing to do.
 *
 * # What was wrong (issue #523)
 *
 * There were three - setup, "has a character", and everything else - and the
 * third was rendered as one screen reading "Nothing is connected yet". So a
 * player holding an open game socket, with two established connections to the
 * game port measured from outside the app at that moment, was told nothing was
 * connected and offered no way to attach. `character` came from the bridge and
 * the socket was a different connection entirely; the screen could not tell
 * them apart because it never looked at the socket.
 */
export type WorkspaceState =
  /** Setup has not been completed. */
  | 'setup'
  /** No demo, no socket, no bridge. Sign in, attach, or start the demo. */
  | 'none'
  /** The game socket is open and no character has been established yet. */
  | 'live-waiting'
  /** The bridge answered and no character has reported in yet. */
  | 'bridge-waiting'
  /** The demo is on and the invented character has not landed yet. */
  | 'demo-waiting'
  /** There is a character. The whole workspace. */
  | 'playing'

/** Everything the state is read from. */
export interface WorkspaceReading extends SessionReading {
  setupComplete: boolean
  /** The companion bridge on its own port, which is not the game socket. */
  bridgeConnected: boolean
  hasCharacter: boolean
}

/**
 * The state, in the order the questions actually have to be asked.
 *
 * Setup first because nothing else is reachable before it. `hasCharacter`
 * second because it subsumes every source - once there is a character the
 * workspace is the same workspace whichever produced it. Then the socket,
 * before the bridge, because the socket is the game and the bridge is a script
 * inside Lich: a player with both wants to be told about the one carrying
 * their game text.
 */
export function workspaceState(r: WorkspaceReading): WorkspaceState {
  if (!r.setupComplete) return 'setup'
  // Reads through `sessionSource` rather than testing `bridgeMode` here, so
  // this function inherits the throw on the impossible pair instead of
  // quietly picking one of the two to believe.
  const source = sessionSource(r)
  if (r.hasCharacter) return 'playing'
  if (source === 'demo') return 'demo-waiting'
  if (source === 'live') return 'live-waiting'
  return r.bridgeConnected ? 'bridge-waiting' : 'none'
}

/**
 * What a player can press. Ids, not labels: the component owns the controls
 * and this owns the rule that there is always at least one of them.
 */
export type WorkspaceAction =
  | 'sign-in'
  | 'start-demo'
  | 'connection-help'
  | 'attach'
  | 'bridge-command'
  | 'leave-demo'
  | 'play'

/**
 * The screen for a state: what it says, and what can be done from it.
 *
 * `actions` is never empty, and `tools/attach-states-test.mjs` asserts that
 * over the enumeration rather than over a list written out again in the test.
 * A screen with nothing to press is the defect this file exists to prevent -
 * it is what "Nothing is connected yet" was, for somebody already connected.
 */
export interface WorkspaceScreen {
  heading: string
  sentence: string
  actions: WorkspaceAction[]
}

export function workspaceScreen(state: WorkspaceState): WorkspaceScreen {
  switch (state) {
    case 'setup':
      return {
        heading: 'Set the app up first.',
        sentence: 'It needs to know where Lich is before it can reach your game.',
        actions: ['connection-help'],
      }
    case 'none':
      return { ...sessionWords('none'), actions: ['sign-in', 'attach', 'start-demo', 'connection-help'] }
    case 'live-waiting':
      return { ...sessionWords('live'), actions: ['bridge-command', 'attach', 'connection-help'] }
    case 'bridge-waiting':
      return {
        heading: 'Waiting for a character.',
        sentence:
          'The bridge is up and no character has reported in yet. Log a character in, or run the companion command in the game.',
        actions: ['bridge-command', 'start-demo', 'connection-help'],
      }
    case 'demo-waiting':
      return { ...sessionWords('demo'), actions: ['leave-demo', 'sign-in', 'connection-help'] }
    case 'playing':
      return {
        heading: 'Playing.',
        sentence: 'The workspace is on screen.',
        actions: ['play'],
      }
  }
}

/** Every state, so a test can enumerate rather than keep its own copy. */
export const WORKSPACE_STATES: WorkspaceState[] = [
  'setup',
  'none',
  'live-waiting',
  'bridge-waiting',
  'demo-waiting',
  'playing',
]
