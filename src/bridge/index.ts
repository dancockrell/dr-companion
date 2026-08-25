/**
 * Bridge facade — mock for UI development, real WebSocket when Lich is up.
 */

import { mockBridge } from './mockBridge'
import { realBridge } from './realBridge'
import type { BridgeClientMessage, BridgeServerMessage, IntentName } from './types'
import type { DemoPresetId } from './mockBridge'

export type BridgeMode = 'mock' | 'live'

type Listener = (msg: BridgeServerMessage) => void

let mode: BridgeMode = 'mock'
const listeners = new Set<Listener>()
let unsubMock: (() => void) | null = null
let unsubReal: (() => void) | null = null

function fanout(msg: BridgeServerMessage) {
  listeners.forEach((fn) => fn(msg))
}

function attach() {
  detach()
  if (mode === 'mock') {
    unsubMock = mockBridge.onMessage(fanout)
  } else {
    unsubReal = realBridge.onMessage(fanout)
  }
}

function detach() {
  if (unsubMock) {
    unsubMock()
    unsubMock = null
  }
  if (unsubReal) {
    unsubReal()
    unsubReal = null
  }
}

export const bridge = {
  getMode(): BridgeMode {
    return mode
  },

  setMode(m: BridgeMode) {
    if (m === mode) return
    this.disconnect()
    mode = m
    attach()
  },

  connect() {
    attach()
    if (mode === 'mock') mockBridge.connect()
    else realBridge.connect()
  },

  disconnect() {
    if (mode === 'mock') mockBridge.disconnect()
    else realBridge.disconnect()
  },

  onMessage(fn: Listener) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  send(msg: BridgeClientMessage) {
    if (mode === 'mock') mockBridge.send(msg)
    else realBridge.send(msg)
  },

  requestIntent(intent: IntentName, args?: Record<string, unknown>) {
    this.send({ type: 'intent', intent, args })
  },

  // Mock-only helpers
  loadPreset(id: DemoPresetId) {
    if (mode === 'mock') mockBridge.loadPreset(id)
  },
  simulateLowHealth() {
    if (mode === 'mock') mockBridge.simulateLowHealth()
  },
  simulateCombat() {
    if (mode === 'mock') mockBridge.simulateCombat()
  },
  simulateSafe() {
    if (mode === 'mock') mockBridge.simulateSafe()
  },
  simulateBrokenPattern() {
    if (mode === 'mock') mockBridge.simulateBrokenPattern()
  },

  onLiveStatus(fn: (status: string, detail?: string) => void) {
    return realBridge.onStatus(fn)
  },

  setLiveUrl(url: string) {
    realBridge.setUrl(url)
  },
}

export type { DemoPresetId }
export { DEMO_PRESET_LIST } from './mockBridge'
