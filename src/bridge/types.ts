/**
 * DR Companion ↔ Lich Bridge Contract
 *
 * The Companion never talks to the game server directly.
 * A small Lich Ruby script exposes a local WebSocket (and optional REST)
 * that streams status and accepts high-level intents.
 *
 * Default endpoint: ws://127.0.0.1:7415/companion
 * (port configurable; always localhost-only)
 */

import type { CharacterStatus, InventorySummary, TraceRow } from '../types'

/** Messages Lich → Companion */
export type BridgeServerMessage =
  | { type: 'hello'; protocol: number; lichVersion: string; bridgeVersion: string }
  | { type: 'status'; payload: CharacterStatus }
  | { type: 'inventory'; payload: InventorySummary }
  | { type: 'scripts'; payload: { name: string; status: string }[] }
  | { type: 'log'; line: string; level?: 'info' | 'warn' | 'error' }
  | { type: 'trace'; row: TraceRow }
  | { type: 'intent_ack'; intent: string; ok: boolean; detail?: string }
  | { type: 'error'; message: string }

/** Messages Companion → Lich */
export type BridgeClientMessage =
  | { type: 'ping' }
  | { type: 'subscribe'; channels: ('status' | 'inventory' | 'scripts' | 'log')[] }
  | { type: 'intent'; intent: IntentName; args?: Record<string, unknown> }
  | { type: 'get_status' }
  | { type: 'get_inventory' }

/**
 * High-level intents the UI may request.
 * Lich scripts are responsible for capability-aware execution.
 */
export type IntentName =
  | 'stop_all'
  | 'pause'
  | 'resume'
  | 'start_combat'
  | 'burgle'
  | 'travel'
  | 'escape_heal'
  | 'go_healer'
  | 'town_run'
  | 'start_training'
  | 'loot'
  | 'buffs'
  | 'escape'
  | 'stow_all'
  | 'check_health'
  | 'check_toggles'

export interface BridgeConnectionState {
  connected: boolean
  lastError: string | null
  protocol: number | null
  lichVersion: string | null
}

/** Snapshot used by the mock bridge and future real client */
export interface BridgeSnapshot {
  character: CharacterStatus
  inventory: InventorySummary
  scripts: string[]
}
