/**
 * The only two ways to change what the app is reading: start the demo, or
 * connect to the game.
 *
 * `src/lib/sessionSource.ts` holds the rule and can be reasoned about from a
 * plain `node` test. This is the half that has to touch the store and the
 * socket, and it exists so the rule is obeyed in **one** place rather than at
 * every button.
 *
 * Before this, "start the demo" was `setBridgeMode('mock'); connectBridge()`
 * typed out at three call sites, and "attach" was `attachGame(port)` at three
 * more - six places, none of which knew about the other three. That is how the
 * demo came to run beside a live socket with the demo banner over both (#525).
 * `tools/session-source-test.mjs` asserts that nothing outside this file calls
 * `attachGame` or `setBridgeMode('mock')` directly, so a seventh call site
 * fails rather than quietly reopening the hole.
 */
import {
  attachGame,
  clearGame,
  detachGame,
  gameLines,
  gameState,
  linkPhase,
  LICH_STARTUP_WAIT_MS,
} from '../lib/gameLink.ts'
import { enterSession, type SessionReading } from '../lib/sessionSource.ts'
import type { AppState } from '../types'

type StoreGet = () => AppState

/** What the rule is read from, at the moment it is asked. */
function reading(get: StoreGet): SessionReading {
  return { bridgeMode: get().bridgeMode, gameSocketOpen: linkPhase(gameState()) !== 'idle' }
}

/**
 * Start the demo, ending a game connection first if there is one.
 *
 * The socket is closed before the mode changes, so there is no instant at
 * which both are on - which is what makes the pair unreachable rather than
 * merely discouraged. `enterSession` decides; this performs.
 */
export async function startDemo(get: StoreGet): Promise<void> {
  const plan = enterSession(reading(get), 'demo')
  if (plan.endSocket) {
    await detachGame()
    get().addLog(plan.say ?? '')
  }
  /*
   * And the real game text goes, whether or not a socket was open.
   *
   * Not folded into the branch above, and that is the whole correction. The
   * line buffer survives a detach by design, so a player who pressed Detach
   * and then Start the demo had no socket to close and kept the previous
   * session's room descriptions in the game pane - with the demo banner's
   * "this is invented data" across the top of them. Same lie as #525, with
   * stale text where the live text used to be.
   *
   * Found by `tools/attach-states-shots.mjs`, which photographs the demo and
   * asserts the room description from the previous state is gone. It was not
   * findable by reading this file: a detach that leaves a buffer behind is
   * exactly what a detach should do, and the defect is in what the *demo*
   * then puts on top of it.
   *
   * `gameLines()` rather than the socket, because the buffer is the thing that
   * has to be empty and the socket is only the commonest reason it is not.
   */
  if (gameLines().length > 0) {
    clearGame()
    get().addLog('Cleared the game scrollback: the demo cannot be shown beside real game text.')
  }
  get().setBridgeMode('mock')
  get().connectBridge()
}

/**
 * Connect to the game, ending the demo first if it is running.
 *
 * `setBridgeMode('live')` clears the invented character in the same act, so
 * nothing of the demo survives into the session. It runs before `attachGame`
 * for the same reason the detach above runs first.
 *
 * Every argument `attachGame` takes, passed through: sign-in needs the long
 * wait while a freshly started Lich binds its port, and the connection bar
 * needs neither.
 */
export async function connectToGame(
  get: StoreGet,
  port: number,
  host?: string,
  waitMs?: number
): Promise<void> {
  const plan = enterSession(reading(get), 'live')
  if (plan.endDemo) {
    get().addLog(plan.say ?? '')
    get().setBridgeMode('live')
    get().connectBridge()
  }
  await attachGame(port, host, waitMs)
}

export { LICH_STARTUP_WAIT_MS }
