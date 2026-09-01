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
  | {
      type: 'hello'
      protocol: number
      lichVersion: string
      bridgeVersion: string
      /**
       * Which gates the bridge actually has up.
       *
       * Optional, and that is the point rather than laziness: a bridge older
       * than 0.9.0 does not send it, and "we cannot tell" is a third state.
       * Collapsing it into 'token' would be the same mistake this field was
       * added to fix, one level up - a reassuring default standing in for an
       * answer nobody has.
       */
      auth?: 'token' | 'origin-only'
      /** Why the token is absent, when it is. Empty otherwise. */
      authNote?: string
      /**
       * Which intents `Intents.handle` actually implements.
       *
       * Optional for the same reason `auth` is: a bridge older than the
       * version that ships this sends nothing, and "we cannot tell" is a
       * third state, not a reason to assume every declared intent works or
       * that none do. See BRIDGE_CONTRACT.md's "Implemented-intents
       * contract" — absent means unknown and the UI must not disable
       * anything on that basis; present means exactly this set is real.
       */
      implementedIntents?: string[]
    }
  | { type: 'status'; payload: CharacterStatus }
  | { type: 'inventory'; payload: InventorySummary }
  | { type: 'scripts'; payload: ScriptState[] }
  | { type: 'log'; line: string; level?: 'info' | 'warn' | 'error' }
  | { type: 'trace'; row: TraceRow }
  | { type: 'runaway'; reason: string }
  | { type: 'intent_ack'; intent: string; ok: boolean; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'settings'; character: string; files: SettingsFile[] }
  | ({ type: 'toggles' } & ToggleStatus)
  | { type: 'vars'; character: string; entries: VarsEntry[] }
  | { type: 'map_here'; payload: MapRoom & { available: boolean } }
  | { type: 'map_path'; payload: MapPath }
  | { type: 'map_nearest'; payload: MapNearest }
  | { type: 'map_zone'; payload: MapZone }
  /**
   * A script placing a pin, the same way a player drags a preset onto a
   * room - see useAppStore.ts's handler for why icon/color are plain
   * strings here rather than PinIcon/PinColor: a script is not bound by
   * this app's own type system, so the handler is what validates them, not
   * the wire type.
   */
  | {
      type: 'map_pin'
      payload: { roomId: number; zone?: string; label: string; icon?: string; color?: string }
    }
  | { type: 'script_catalog'; payload: string[] }

/**
 * One Lich script, and whether it is actually doing anything.
 *
 * The status was in the payload from the first version and the store threw it
 * away with `.map(s => s.name)`, so a paused script and a running one read the
 * same in every place that lists them. That is the wrong two things to
 * conflate: "running: hunting" while hunting sits paused is the console
 * telling you the opposite of what is true.
 */
export interface ScriptState {
  name: string
  /** 'running' or 'paused'. A string rather than a union because it comes
   *  from Lich and an unexpected value must render, not crash. */
  status: string
}

/**
 * One dr-scripts YAML file, as the bridge found it.
 *
 * The bridge has read all of this since 0.7.0 — load order, size, how many
 * settings, every key name, and for a broken file the parse error with its
 * line and column. All of it was sent, none of it was typed, and the store had
 * no case for the message, so the whole payload fell off the end of a switch.
 * What survived was the prose log lines, which cannot be sorted, filtered or
 * pointed at.
 *
 * The parse error is the part that matters most. A YAML syntax error names a
 * line and a column, and that is the single most useful thing you can tell
 * somebody who has been editing a settings file by hand and cannot work out
 * why dr-scripts is ignoring it.
 */
export interface SettingsFile {
  path: string
  name: string
  bytes: number
  /** 'defaults' for base.yaml, 'yours' for a character file that overrides it. */
  kind: 'defaults' | 'yours' | string
  ok: boolean
  /** Top-level setting names, sorted. Present only when the file parsed. */
  keys?: string[]
  count?: number
  error?: string
  line?: number
  column?: number
}

/**
 * BRIEF, INVBRIEF and ShowRoomID, as `check_toggles` last read them from the
 * game rather than inferred from anything client-side.
 *
 * All three change what the game prints or what Lich can parse from it -
 * BRIEF and INVBRIEF shorten room and inventory text that other scripts read,
 * ShowRoomID is what Lich needs to know which room you're in at all. Nobody
 * changes them from here; this only reports what TOGGLE/FLAGS said.
 *
 * `null` means "not known," and it is not the same claim for every field.
 * `showRoomId` gets a real `false` when the game's reply is read and does not
 * say on - that branch has been trusted in production warnings since before
 * this type existed. `brief`/`invBrief` never resolve to `false`: the bridge
 * only has a verified pattern for "this is on," not for "the game told us
 * it's off," so anything short of a positive match stays `null` rather than
 * asserting an off state nobody has confirmed the wire actually distinguishes
 * from silence.
 */
export interface ToggleStatus {
  brief: boolean | null
  invBrief: boolean | null
  showRoomId: boolean | null
}

/**
 * One entry from `Lich::Common::Vars`, as `list_vars` reports it.
 *
 * `kind` matches what the bridge actually did rather than a guess at every
 * type `Vars` could hold: a String passes through as `'string'`; anything
 * else - `companion_bridge.lic`'s own comment cites Lich's `vars.lic` doing
 * the same - is rendered as `"#{value.class}: #{value.inspect}"` and marked
 * `'other'`, read-only, since a stringified inspect of an arbitrary Ruby
 * object is not something this app could safely write back.
 */
export interface VarsEntry {
  name: string
  value: string
  kind: 'string' | 'other'
}

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
  /** Commands that actually leave this room (north, go door, climb ladder).
   * Distinct from `exits`, which Lich map payloads expose as destination ids. */
  moves?: string[]
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
  /**
   * The colour the cartographer gave this room, as a hex string.
   *
   * Sixteen are in use across the game and they are a classification, not
   * decoration: this is how Genie's map is readable at a glance. Parsed since
   * the first build and discarded until now.
   */
  mapColour?: string
  /**
   * Exits, with how you take them.
   *
   * Walking east and going through a door are different acts and were drawn
   * as the same line. Crossing alone has 662 go-exits, which are doorways
   * into buildings, and 118 climbs. A map that cannot tell a street from an
   * entrance is hiding the thing you navigate by.
   */
  links?: Array<{ to: number; kind: 'walk' | 'enter' | 'climb' | 'vertical' }>
  /**
   * The zone this room leads into, when it is a door out.
   *
   * Genie's arcs only point inside their own file, so every zone was drawn as
   * an island: you could see the gate and there was nothing beyond it. The
   * link is in the cartographer's note, whose first segment is the
   * destination's map filename, resolved to a zone id at build time. 310 rooms
   * carry one.
   */
  gateway?: { zone: string; name: string }
  /** How you leave the zone from here, as the cartographer wrote the move. */
  leaves?: string[]
  /** Cartographer-authored movement commands for every visible exit. */
  moves?: string[]
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

/** The nearest room(s) carrying a tag - computed, not saved. Nothing has moved. */
export interface MapNearest {
  ok: boolean
  tag?: string
  from?: number | null
  rooms?: (MapRoom & { steps?: number | null })[]
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
  // DR's class mechanic. `check_teaching` asks the room what is on offer;
  // `listen_to` joins a class and `stop_listening` leaves one. All three cost
  // a real game command, so none of them rides the status tick.
  | 'check_teaching'
  | 'listen_to'
  | 'stop_listening'
  | 'check_toggles'
  | 'reset_runaway'
  | 'read_settings'
  | 'list_vars'
  /**
   * Send literal game commands, from a macro the player pressed.
   *
   * Deliberately an intent like any other rather than a side channel, so it
   * inherits what intents already have: the bridge refuses it when it cannot
   * run, roundtime is waited out rather than typed over, and Stop kills it.
   * args: { commands: string[] }
   */
  | 'run_macro'
  // Map queries. 'map_here'/'map_path'/'map_zone' are read-only: they answer
  // questions about geography and never move the character.
  //
  // 'map_walk' is the deliberate exception - clicking a room on the map is a
  // travel command, not a preview. args: { to: number } (a Lich room id).
  // The bridge starts Lich's own go2 script rather than us reimplementing
  // movement; progress arrives through the ordinary game stream, the same as
  // if the player had typed ;go2 <room> themselves, not a payload of its own.
  | 'map_here'
  | 'map_path'
  | 'map_walk'
  /**
   * The nearest room(s) carrying a tag - "nearest bank", "nearest 3
   * healers" - computed fresh each time, unlike a pin. args:
   * { tag: string, count?: number }. Read-only, like map_path: it answers
   * where the nearest one is, the client fires map_walk itself against
   * whichever hit it wants.
   */
  | 'map_nearest'
  | 'map_zone'
  | 'install_mapdb'
  // Raw script library access. Distinct from the curated activity intents
  // above (start_combat, burgle, travel, ...): those name a behaviour and
  // the bridge decides how to run it; these two name a literal script file.
  // 'list_scripts' asks what Lich can actually find; 'start_script' launches
  // one by name, args: { name: string }.
  | 'list_scripts'
  | 'start_script'
  // The diagnostic trace behind the Console's toggle. 'trace_on' and
  // 'trace_off' set whether the bridge records what it is doing; 'trace_dump'
  // asks for what it already holds, so switching the toggle on shows history
  // rather than starting from an empty pane.
  //
  // These were reachable only through `as IntentName` casts in useAppStore,
  // and the cast is precisely what stopped the compiler from mentioning they
  // were not in this union. So the bridge implemented three intents the type
  // system said did not exist, and `intent-drift-test.mjs` - which reads this
  // union as its declared set - could not see them either. Declared here so
  // they are compared like everything else.
  | 'trace_on'
  | 'trace_off'
  | 'trace_dump'
