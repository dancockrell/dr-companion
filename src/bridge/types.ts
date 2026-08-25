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
  | { type: 'runaway'; reason: string }
  | { type: 'intent_ack'; intent: string; ok: boolean; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'map_here'; payload: MapRoom & { available: boolean } }
  | { type: 'map_tags'; payload: string[] }
  | { type: 'map_nearest'; payload: MapNearest }
  | { type: 'map_path'; payload: MapPath }
  | { type: 'map_zone'; payload: MapZone }

/**
 * A room, as Lich knows it.
 *
 * Two id systems, and both are carried on purpose. `id` is Lich's room number,
 * the one `#goto` takes. `uid` is the game's own room id, the number a player
 * sees with ShowRoomID on. They are different numbers for the same room, and
 * quoting one when you mean the other is a documented way to lose an afternoon
 * in a help channel — so neither is dropped and neither goes unlabelled.
 */
export interface MapRoom {
  id: number | null
  uid: number | null
  title: string | null
  location: string | null
  climate?: string | null
  terrain?: string | null
  tags?: string[]
  exits?: string[]
}

export interface MapNearest extends MapRoom {
  ok: boolean
  tag?: string
  steps?: number | null
  reason?: string
}

/**
 * One zone, laid out so it can be drawn.
 *
 * Coordinates come from Lich's `genie_pos` — the layout community
 * cartographers built for Genie's automapper, which Lich stores per room
 * against its own room ids. They are zone-local, so two zones must not share
 * a canvas.
 */
export interface MapZoneRoom {
  id: number | null
  uid: number | null
  title: string | null
  x: number | null
  y: number | null
  z: number | null
  tags?: string[]
  /** Lich room ids reachable from here. */
  to?: number[]
}

export interface MapZone {
  ok: boolean
  zone?: string
  name?: string | null
  /** Lich room id the character is standing in. */
  here?: number | null
  total?: number
  /** True when rooms were capped. Reported, never silent. */
  truncated?: boolean
  rooms?: MapZoneRoom[]
  reason?: string
}

/** A route, returned rather than walked. Nothing has moved. */
export interface MapPath {
  ok: boolean
  from?: number | null
  to?: number
  steps?: number
  rooms?: MapRoom[]
  reason?: string
}

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
  | 'reset_runaway'
  | 'read_settings'
  // Map queries. All read-only: they answer questions about geography and
  // never move the character. 'map_path' returns a route rather than walking
  // it, so deciding to go stays a separate decision.
  | 'map_here'
  | 'map_tags'
  | 'map_nearest'
  | 'map_path'
  | 'map_zone'

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
