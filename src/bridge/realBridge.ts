/**
 * Real WebSocket client for the Lich companion_bridge script.
 * Connects to ws://127.0.0.1:7415/companion by default.
 * Falls back cleanly when Lich is not running.
 */

// Extension explicit, matching `gameLink.ts`. Node's ESM resolver will not
// infer `.ts`, so while this said '../lib/tauri' the module could not be
// imported by any test at all — which is the mechanical reason the transport
// sat unexercised. Vite resolves either form; the test runner resolves only
// this one.
import { invokeTauri } from '../lib/tauri.ts'
import type { BridgeClientMessage, BridgeServerMessage } from './types'

export type RealBridgeStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

type Listener = (msg: BridgeServerMessage) => void
type StatusListener = (status: RealBridgeStatus, detail?: string) => void

const DEFAULT_URL = 'ws://127.0.0.1:7415/companion'

const BASE_RECONNECT_MS = 1000
const MAX_RECONNECT_MS = 30_000

/**
 * How long the game clock may stand still before we call the game hung.
 *
 * An open socket says nothing about whether the game is alive. Community
 * tooling detects this by checking whether the in-game clock advanced, and we
 * do the same with the `gameTime` field on every status payload.
 * See docs/DOMAIN.md section 13.
 */
const STALE_AFTER_MS = 90_000

/** How often the stale watch re-checks. Well under STALE_AFTER_MS. */
const STALE_TICK_MS = 15_000

export class RealBridge {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<StatusListener>()
  private url: string
  private status: RealBridgeStatus = 'disconnected'
  private reconnectAttempts = 0

  /**
   * A connect is in flight but has no socket yet.
   *
   * Set synchronously in `connect()`, cleared when the token read settles.
   * Exists because `this.ws` cannot answer "are we already connecting" during
   * the async gap before `openSocket()` runs - see `connect()`.
   */
  private connectPending = false
  private lastGameTime: number | null = null
  private lastGameTimeAt = 0
  /**
   * Whether the clock is currently judged stopped.
   *
   * Separate from `status`, and that separation is the fix. The first version
   * recorded staleness *only* by calling `setStatus('error')`, which made the
   * judgement and the report the same variable — so there was nowhere to hold
   * "we said stale, and the clock has since moved" and nothing ever said
   * otherwise. Two further things followed from it:
   *
   *   - the watch's own guard was `status !== 'connected'`, so the moment it
   *     fired it disqualified itself from ever running the check again;
   *   - the only path back to 'connected' was a socket close and a fresh
   *     `onopen`, i.e. the panel stayed accusing until the link dropped.
   *
   * A quiet game — standing in a bank, reading, idle overnight — is the
   * ordinary case that trips this, and it recovers by definition. Reporting a
   * recoverable condition irrecoverably is the same defect as stale data, just
   * pointing the other way: the panel says something false about the link and
   * keeps saying it.
   */
  private stale = false
  // `ReturnType<typeof setTimeout>` rather than `number`, because the timers
  // below are the bare globals, not `window.setTimeout`. They used to be
  // window-scoped, which meant this class could only be constructed inside a
  // DOM — so the one piece of the app that cannot be wrong, the transport to
  // Lich, was also the one piece that could not be tested outside a browser.
  // It went unexercised for exactly that long.
  /** The bridge token for this attempt, read before the socket opens. */
  private token = ''

  private staleTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = false

  /** How long the clock may stand still before this instance calls it stale. */
  private staleAfterMs: number
  /** How often the stale watch re-evaluates. */
  private staleTickMs: number

  /**
   * The two timings are injectable purely so the stale watch can be tested.
   *
   * The defaults are the shipping values and nothing in the app passes
   * anything else. Without this seam the only way to exercise a 90-second
   * stall is to wait ninety seconds, which means in practice it is never
   * exercised — and this class's own history is that the untestable part is
   * the part that carried the bug. The latch fixed alongside this had been
   * live for exactly as long as it had been unreachable by a test.
   */
  constructor(
    url = DEFAULT_URL,
    opts: { staleAfterMs?: number; staleTickMs?: number } = {}
  ) {
    this.url = url
    this.staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS
    this.staleTickMs = opts.staleTickMs ?? STALE_TICK_MS
  }

  getStatus() {
    return this.status
  }

  setUrl(url: string) {
    this.url = url
  }

  onMessage(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onStatus(fn: StatusListener) {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  connect() {
    // Guarded on a flag set synchronously, not on `this.ws`.
    //
    // `this.ws` is assigned inside `openSocket()`, which only runs after the
    // token read below resolves. So between entering this method and that
    // callback firing, `this.ws` is still null while the status is already
    // 'connecting' - and the old guard, which required `this.ws` to be
    // truthy, let a second caller straight through that window. Two token
    // reads, two sockets, two subscriptions.
    //
    // Reachable because `connectBridge()` is called from five places: App's
    // mount effect, the settings sheet twice, and both pop-out windows. Seen
    // in a screenshot as two "Live bridge: connecting" lines stamped the same
    // second.
    if (this.connectPending || this.status === 'connected') return

    this.connectPending = true
    this.shouldReconnect = true
    this.setStatus('connecting')

    // The token is fetched BEFORE the socket opens, and this ordering is the
    // whole of it.
    //
    // The first version read it inside `onopen`, which is asynchronous - so
    // `subscribe` and `get_status` went out synchronously first, the bridge
    // read `subscribe` as the first frame, and refused the connection. The
    // client reconnected forever and reported "is Lich running?", which is a
    // true-sounding message about entirely the wrong thing.
    //
    // Read per attempt rather than cached: the bridge writes a fresh token
    // each time it starts, so a cached one is exactly wrong in the case that
    // matters - reconnecting after Lich restarted.
    void this.readToken()
      .then((token) => {
        if (!this.shouldReconnect) return
        this.token = token
        this.openSocket()
      })
      .finally(() => {
        // Cleared in `finally`, not on the success path. A token read that
        // throws would otherwise leave this latched true forever and every
        // later connect would return silently - a worse bug than the double
        // connect it replaces, and one that looks like the bridge simply
        // never trying.
        this.connectPending = false
      })
  }

  /**
   * Ask Tauri for the token beside the bridge script.
   *
   * Never throws. No Tauri (a browser) or no token file are both ordinary,
   * and in either case the empty string is sent as nothing and the bridge
   * decides - which keeps that decision in the one place with all the facts.
   */
  private async readToken(): Promise<string> {
    try {
      return ((await invokeTauri('read_bridge_token')) as string) ?? ''
    } catch {
      return ''
    }
  }

  private openSocket() {
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectAttempts = 0
        this.setStatus('connected')

        // The token, first, and synchronously, so nothing can overtake it.
        //
        // The bridge writes a fresh one beside its own script on startup and
        // drops any connection whose first frame is not this. That is the half
        // of the boundary that stops a hostile local process - the Origin
        // check stops web pages, and anything that can open a socket can
        // simply omit an Origin header.
        if (this.token) {
          this.send({ type: 'auth', token: this.token } as unknown as BridgeClientMessage)
        }

        this.send({
          type: 'subscribe',
          channels: ['status', 'inventory', 'scripts', 'log'],
        })
        this.send({ type: 'get_status' })
        this.startStaleWatch()
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as BridgeServerMessage
          if (msg.type === 'status') this.noteGameTime(msg.payload.gameTime)
          this.listeners.forEach((fn) => fn(msg))
        } catch {
          this.listeners.forEach((fn) =>
            fn({ type: 'error', message: 'Invalid JSON from bridge' })
          )
        }
      }

      ws.onerror = () => {
        this.setStatus('error', 'WebSocket error — is Lich companion_bridge running?')
      }

      ws.onclose = () => {
        this.ws = null
        this.stopStaleWatch()
        if (this.shouldReconnect) {
          // Exponential backoff, capped. Retrying every 3s forever floods the
          // console and hammers a port that is usually just not there yet.
          const delay = Math.min(
            MAX_RECONNECT_MS,
            BASE_RECONNECT_MS * 2 ** this.reconnectAttempts
          )
          this.reconnectAttempts += 1
          this.setStatus(
            'disconnected',
            `Connection closed — retrying in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`
          )
          this.reconnectTimer = setTimeout(() => this.connect(), delay)
        } else {
          this.setStatus('disconnected')
        }
      }
    } catch (e) {
      this.setStatus(
        'error',
        e instanceof Error ? e.message : 'Failed to open WebSocket'
      )
    }
  }

  disconnect() {
    this.shouldReconnect = false
    this.reconnectAttempts = 0
    this.stopStaleWatch()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  send(msg: BridgeClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.listeners.forEach((fn) =>
        fn({ type: 'error', message: 'Not connected to Lich bridge' })
      )
      return
    }
    this.ws.send(JSON.stringify(msg))
  }

  private setStatus(s: RealBridgeStatus, detail?: string) {
    this.status = s
    this.statusListeners.forEach((fn) => fn(s, detail))
  }

  /**
   * Record the bridge clock so we can tell a live game from a live socket.
   *
   * This is also the *only* place staleness is lifted, and it has to be: the
   * clock moving is the single piece of evidence that the game is alive again,
   * and it arrives here. Clearing it on a timer, or on any message at all,
   * would clear it for a bridge that is still talking about a game that is
   * still hung — which is the exact condition this whole mechanism exists to
   * distinguish from a healthy quiet one.
   */
  private noteGameTime(t?: number) {
    if (typeof t !== 'number') return
    if (t !== this.lastGameTime) {
      this.lastGameTime = t
      this.lastGameTimeAt = Date.now()
      if (this.stale) {
        this.stale = false
        // Only meaningful while the socket is still up. If the link dropped in
        // the meantime, `onclose` owns the status and saying 'connected' here
        // would overwrite a truthful disconnect with a stale recovery.
        if (this.isOpen()) {
          this.setStatus('connected', 'Game clock moving again.')
        }
      }
    }
  }

  /** Whether the socket is actually open, independent of what we last reported. */
  private isOpen() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  private startStaleWatch() {
    this.stopStaleWatch()
    this.lastGameTimeAt = Date.now()
    this.staleTimer = setInterval(() => {
      // Gated on the socket, not on `this.status`. Gating on the status was
      // the latch: `setStatus('error')` below made the next tick return here,
      // so the check could fire exactly once and then never re-evaluate.
      if (!this.isOpen()) return
      if (this.lastGameTime === null) return
      const since = Date.now() - this.lastGameTimeAt
      if (since > this.staleAfterMs) {
        // Announced once per stall rather than every 15s. A repeat carries no
        // new fact — the clock is still stopped, which is what was already
        // said — and it would retrigger every status listener, including the
        // ones that surface a toast.
        if (!this.stale) {
          this.stale = true
          this.setStatus(
            'error',
            `Bridge is connected but the game clock has not moved for ${Math.round(
              since / 1000
            )}s. The game may have hung or disconnected.`
          )
        }
      }
    }, this.staleTickMs)
  }

  private stopStaleWatch() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer)
      this.staleTimer = null
    }
    this.lastGameTime = null
    // Reset with the watch. A reconnect starts a new judgement from no
    // evidence; carrying `stale` across would let a fresh, healthy socket
    // inherit the previous session's verdict and suppress the first real
    // stall report on the new one.
    this.stale = false
  }
}

export const realBridge = new RealBridge()
