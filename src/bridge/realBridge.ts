/**
 * Real WebSocket client for the Lich companion_bridge script.
 * Connects to ws://127.0.0.1:7415/companion by default.
 * Falls back cleanly when Lich is not running.
 */

import { invokeTauri } from '../lib/tauri.ts'
import type { BridgeClientMessage, BridgeServerMessage } from './types'

/**
 * What the live bridge is doing.
 *
 * `reconnecting` and `gave-up` were added for issue #479 and are the two that
 * used to be folded into `disconnected` with the real answer in a free-text
 * `detail` string that nothing parsed. They ask opposite things of the player -
 * wait, versus go and start the bridge - so a UI showing one badge for both
 * tells half its readers the wrong thing, and there was no way to show two.
 *
 * `disconnected` is now only the honest idle case: never connected, or
 * deliberately disconnected.
 */
export type RealBridgeStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'gave-up'
  | 'error'

type Listener = (msg: BridgeServerMessage) => void
type StatusListener = (status: RealBridgeStatus, detail?: string) => void

const DEFAULT_URL = 'ws://127.0.0.1:7415/companion'

const BASE_RECONNECT_MS = 1000
const MAX_RECONNECT_MS = 30_000

/**
 * How many times a dropped bridge re-dials before it stops and says so.
 *
 * Bounded as of issue #479; it retried forever before, capped at thirty
 * seconds. Forever sounds generous and is not: a bridge that is genuinely gone
 * and one that is fifteen seconds into a Lich restart produced the identical
 * permanent spinner, there was no state in which the app could say it had
 * stopped, and a spinner that never resolves is one people learn to ignore.
 *
 * Eight on the doubling schedule below is about two minutes of real elapsed
 * time (1+2+4+8+16+30+30+30 seconds of waiting), which covers a Lich restart
 * and a network blip and does not cover a bridge script that was never
 * started. Reconnect is one click away from the settings sheet either way.
 */
export const MAX_RECONNECT_ATTEMPTS = 8

/**
 * How long the game clock may stand still before we call the game hung.
 *
 * An open socket says nothing about whether the game is alive. Community
 * tooling detects this by checking whether the in-game clock advanced, and we
 * do the same with the `gameTime` field on every status payload.
 * See docs/DOMAIN.md section 13.
 */
const STALE_AFTER_MS = 90_000

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

  constructor(url = DEFAULT_URL) {
    this.url = url
  }

  getStatus() {
    return this.status
  }

  /**
   * How many re-dials have been made, and the bound they are counted against.
   *
   * Structured, because the attempt count used to exist only inside the
   * free-text `detail` string passed to status listeners, where the store
   * logged it and nothing could render it. A number nobody can read is the
   * same absence as no number: see the SafetyFooter's own note about a signal
   * moving from one place nobody looks to another.
   */
  getAttempt() {
    return this.reconnectAttempts
  }

  getMaxAttempts() {
    return MAX_RECONNECT_ATTEMPTS
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

    // A deliberate connect after a give-up gets a fresh budget.
    //
    // Without this the counter is still at the bound, so the one retry a
    // person asked for would open a socket, and the first close would give up
    // again immediately with no backoff and no second attempt — a button that
    // appears to do nothing. The bound is there to stop an *automatic* run
    // going on forever, not to make the app refuse to try again when asked.
    if (this.status === 'gave-up') this.reconnectAttempts = 0

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
        if (!this.shouldReconnect) {
          this.setStatus('disconnected')
          return
        }
        // The bound, checked before the next attempt is scheduled rather than
        // inside the timer, so the state the UI sees changes at the moment the
        // decision is made and not one backoff later.
        //
        // `shouldReconnect` is cleared here as well as the status being set:
        // without it a later `connect()` from anywhere - the settings sheet,
        // another window's mount effect - would restart an unbounded run under
        // a status that says it gave up.
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          this.shouldReconnect = false
          this.setStatus(
            'gave-up',
            `Gave up after ${this.reconnectAttempts} attempts — the Lich companion bridge is not answering on ${this.url}. Start it in Lich, then reconnect from Setup.`
          )
          return
        }
        // Exponential backoff, capped. Retrying every 3s forever floods the
        // console and hammers a port that is usually just not there yet.
        const delay = Math.min(
          MAX_RECONNECT_MS,
          BASE_RECONNECT_MS * 2 ** this.reconnectAttempts
        )
        this.reconnectAttempts += 1
        this.setStatus(
          'reconnecting',
          `Connection closed — retrying in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS})`
        )
        this.reconnectTimer = setTimeout(() => this.connect(), delay)
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

  /** Record the bridge clock so we can tell a live game from a live socket. */
  private noteGameTime(t?: number) {
    if (typeof t !== 'number') return
    if (t !== this.lastGameTime) {
      this.lastGameTime = t
      this.lastGameTimeAt = Date.now()
    }
  }

  private startStaleWatch() {
    this.stopStaleWatch()
    this.lastGameTimeAt = Date.now()
    this.staleTimer = setInterval(() => {
      if (this.status !== 'connected') return
      if (this.lastGameTime === null) return
      const since = Date.now() - this.lastGameTimeAt
      if (since > STALE_AFTER_MS) {
        this.setStatus(
          'error',
          `Bridge is connected but the game clock has not moved for ${Math.round(
            since / 1000
          )}s. The game may have hung or disconnected.`
        )
      }
    }, 15_000)
  }

  private stopStaleWatch() {
    if (this.staleTimer) {
      clearInterval(this.staleTimer)
      this.staleTimer = null
    }
    this.lastGameTime = null
  }
}

export const realBridge = new RealBridge()
