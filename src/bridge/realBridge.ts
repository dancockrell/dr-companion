/**
 * Real WebSocket client for the Lich companion_bridge script.
 * Connects to ws://127.0.0.1:7415/companion by default.
 * Falls back cleanly when Lich is not running.
 */

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

export class RealBridge {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<StatusListener>()
  private url: string
  private status: RealBridgeStatus = 'disconnected'
  private reconnectAttempts = 0
  private lastGameTime: number | null = null
  private lastGameTimeAt = 0
  private staleTimer: number | null = null
  private reconnectTimer: number | null = null
  private shouldReconnect = false

  constructor(url = DEFAULT_URL) {
    this.url = url
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
    if (this.ws && (this.status === 'connected' || this.status === 'connecting')) {
      return
    }
    this.shouldReconnect = true
    this.setStatus('connecting')
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectAttempts = 0
        this.setStatus('connected')
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
          this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
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
    this.staleTimer = window.setInterval(() => {
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
