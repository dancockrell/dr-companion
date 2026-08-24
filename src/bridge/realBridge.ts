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

export class RealBridge {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<StatusListener>()
  private url: string
  private status: RealBridgeStatus = 'disconnected'
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
        this.setStatus('connected')
        this.send({
          type: 'subscribe',
          channels: ['status', 'inventory', 'scripts', 'log'],
        })
        this.send({ type: 'get_status' })
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as BridgeServerMessage
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
        if (this.shouldReconnect) {
          this.setStatus('disconnected', 'Connection closed — retrying in 3s')
          this.reconnectTimer = window.setTimeout(() => this.connect(), 3000)
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
}

export const realBridge = new RealBridge()
