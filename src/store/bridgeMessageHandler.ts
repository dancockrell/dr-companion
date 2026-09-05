import { bridge } from '../bridge/index.ts'
import type { BridgeServerMessage } from '../bridge/types'
import type { AppState, AuthMode } from '../types'
import { APP_VERSION, EXPECTED_BRIDGE_VERSION, compareVersions } from '../lib/versions.ts'
import { visit } from '../lib/trail.ts'
import {
  addPin,
  clearCorpseMarker,
  loadPins,
  pinFor,
  PIN_COLORS,
  PIN_ICONS,
  setCorpseMarker,
  updatePin,
  type PinColor,
  type PinIcon,
} from '../lib/mapPins.ts'
export function handleBridgeMessage(
  msg: BridgeServerMessage,
  set: (
    partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)
  ) => void,
  get: () => AppState
) {
  switch (msg.type) {
    case 'hello': {
      set({
        versions: {
          app: APP_VERSION,
          expectedBridge: EXPECTED_BRIDGE_VERSION,
          actualBridge: msg.bridgeVersion,
          lich: msg.lichVersion,
          protocol: msg.protocol,
        },
      })
      get().addLog(
        `Bridge v${msg.bridgeVersion} on Lich ${msg.lichVersion}, protocol ${msg.protocol}`
      )

      /**
       * Which gates the bridge has up, in three states rather than two.
       *
       * A missing field is `unknown`, not `token`. A bridge older than 0.9.0
       * sends nothing, and defaulting that to "fine" would be the exact
       * mistake this field exists to fix: a reassuring value standing in for
       * an answer nobody has.
       *
       * Said in the log rather than only stored, because the bridge already
       * carried this and the app not reading it meant the signal had simply
       * moved from one place nobody looks to another.
       */
      const auth: AuthMode =
        msg.auth === 'token' || msg.auth === 'origin-only' ? msg.auth : 'unknown'
      set({ bridgeAuth: auth, bridgeAuthNote: msg.authNote ?? '' })

      // Same three-state shape as auth, immediately above: absent means
      // unknown, never "none implemented" - see isIntentImplemented.
      set({
        bridgeIntents: Array.isArray(msg.implementedIntents)
          ? msg.implementedIntents
          : null,
      })

      if (auth === 'origin-only') {
        get().addLog(
          `Bridge is running WITHOUT a connection token${
            msg.authNote ? ` (${msg.authNote})` : ''
          }. Web pages are still blocked; other programs on this machine are not.`
        )
      } else if (auth === 'unknown') {
        get().addLog(
          `Bridge v${msg.bridgeVersion} does not report whether it requires a token. Update it to be sure.`
        )
      }
      // Version mismatch is the largest time sink in this ecosystem's support.
      // Say it now and loudly, rather than letting someone spend a week
      // filing reports against a script that was fixed two releases ago.
      const v = compareVersions(get().versions)
      if (v.message) get().addLog(v.message)
      break
    }
    case 'status': {
      // Stamped on arrival. `roundtime` is a count of seconds measured when
      // the bridge built the payload, so without knowing when that was the
      // only honest thing to render is a frozen number, which is the one thing
      // a countdown must not be. See AppState.characterAt.
      // Ask the map where it thinks we are, whenever the game says we moved.
      //
      // `MapPanel` has compared these two room ids since it was written -
      // `DRRoom`'s, which arrives on every status tick, against `map_here`'s,
      // which is a separate query - to catch the map database and the game
      // disagreeing about where the character is standing. **Nothing has ever
      // sent that query.** So `mapHere` was permanently null, the comparison
      // was permanently false, and a correctness check with its own issue
      // number sat there unable to fire for its whole life. Found by GUI
      // features 1 while classifying intents nobody calls.
      //
      // On a room change rather than every tick: the answer only changes when
      // the room does, and a query per tick on a busy status stream is a lot
      // of traffic to establish something that did not move.
      //
      // Through `bridge` rather than the store's own `requestIntent`, which
      // logs failures for the player. This is a background integrity check;
      // an older bridge that does not implement it should be quiet, not
      // announce itself in the log every time the character walks.
      const previousRoom = get().character?.location.roomId ?? null
      const nextRoom = msg.payload.location?.roomId ?? null
      // Caught here, not in a separate death-watching effect somewhere in the
      // map code: this is the one place both the old and the new situation
      // flags are ever in hand at once, and death is exactly a transition -
      // "dead" arriving on a status that already carried it (a second tick
      // while still dead) must not drop a fresh marker over one the player
      // may have already walked away from once revived elsewhere.
      const wasDead = get().character?.situation.includes('dead') ?? false
      const isDead = msg.payload.situation.includes('dead')

      // Stamped on arrival. `roundtime` is a count of seconds measured when
      // the bridge built the payload, so without knowing when that was the
      // only honest thing to render is a frozen number, which is the one thing
      // a countdown must not be. See AppState.characterAt.
      set({ character: msg.payload, characterAt: Date.now() })
      // Adopt this character's own settings the moment we learn who they are.
      const p = msg.payload
      if (p.name) get().syncProfile(p.name, p.instance, p.guild)

      if (nextRoom !== null && nextRoom !== previousRoom) {
        bridge.requestIntent('map_here')
      }

      if (p.name) {
        const hereId = get().mapHere?.id
        if (!wasDead && isDead && hereId != null) {
          // The corpse marker itself, not a claim about where the player
          // "should" go - the map already knows how to walk to any pin.
          setCorpseMarker(p.name, p.instance, hereId, get().mapZone?.zone ?? '')
          get().addLog('You have died. A marker was dropped so you can walk back to your body.', 'warn')
        } else if (wasDead && !isDead) {
          // Revival can happen anywhere (a healer's spell, a shrine) - only
          // clear the marker once the character is actually standing where
          // it points, so a marker for a corpse not yet recovered survives a
          // revive that happened somewhere else entirely.
          const corpse = loadPins(p.name, p.instance).find((pin) => pin.system)
          if (corpse && hereId === corpse.roomId) {
            clearCorpseMarker(p.name, p.instance)
            get().addLog('Corpse marker cleared - welcome back.')
          }
        }
      }
      break
    }
    case 'inventory':
      set({ inventory: msg.payload })
      break
    case 'scripts':
      // Keep the status this time. Dropping it made a paused script
      // indistinguishable from a working one everywhere it was listed, which
      // is exactly backwards for somebody checking on an unattended run.
      set({
        scriptStates: msg.payload,
        runningScripts: msg.payload.map((s) => s.name),
      })
      break
    case 'script_catalog':
      set({ scriptCatalog: msg.payload })
      break
    case 'log':
      get().addLog(msg.line, msg.level)
      break
    case 'settings':
      // The bridge already knew all of this and the switch had no case for it,
      // so the payload arrived and fell off the end. See SettingsFile.
      set({ settingsFiles: msg.files, settingsCharacter: msg.character })
      break
    case 'toggles':
      // Same shape of gap as 'settings' above: check_toggles has read BRIEF,
      // INVBRIEF and ShowRoomID and logged them since before this case
      // existed, with no field for a screen to read instead of the log pane.
      set({ toggles: { brief: msg.brief, invBrief: msg.invBrief, showRoomId: msg.showRoomId } })
      break
    case 'vars':
      // Third of the same shape: list_vars has broadcast Lich::Common::Vars
      // for this character since before this case existed. VarsPanel.tsx
      // reads `vars` for its list.
      set({ vars: msg.entries })
      break
    case 'trace':
      get().addTrace(msg.row)
      break
    case 'runaway':
      // The bridge stopped itself for looping. Put it where it cannot be
      // missed: this is the case where the character has been doing something
      // pointless and visible, which is exactly what should not run unwatched.
      set({ runawayReason: msg.reason })
      get().addLog(`Stopped itself: ${msg.reason}`, 'error')
      break
    case 'intent_ack':
      // install_mapdb's ack means "started", never "done" — the bridge
      // returns before the fetch completes on purpose (BRIDGE_CONTRACT.md),
      // so its own state is tracked separately from the generic log line
      // below rather than folded into it.
      if (msg.intent === 'install_mapdb') {
        set({
          mapdbInstall: msg.ok
            ? { status: 'started', detail: msg.detail }
            : { status: 'failed', detail: msg.detail ?? 'refused with no reason given' },
        })
      }
      if (!msg.ok)
        get().addLog(`Intent failed: ${msg.intent} — ${msg.detail ?? ''}`, 'error')
      break
    case 'error':
      get().addLog(`Bridge error: ${msg.message}`, 'error')
      break

    // Geography, answered by Lich's own map rather than by a list we ship.
    case 'map_here': {
      const here = msg.payload.available ? msg.payload : null
      // The trail is extended here rather than in the map panel, because the
      // panel unmounts whenever the map is popped out into its own window and
      // a trail that forgets itself on a layout change is worse than none.
      set({ mapHere: here, mapTrail: visit(get().mapTrail, here?.id) })
      break
    }
    case 'map_path':
      set({ mapPath: msg.payload })
      if (!msg.payload.ok) get().addLog(`Map: ${msg.payload.reason ?? 'no route'}`)
      break
    case 'map_nearest':
      set({ mapNearest: msg.payload })
      if (!msg.payload.ok) get().addLog(`Map: ${msg.payload.reason ?? 'nothing nearby'}`)
      break
    case 'map_zone':
      set({ mapZone: msg.payload })
      if (!msg.payload.ok) get().addLog(`Map: ${msg.payload.reason ?? 'no zone'}`)
      break

    /**
     * "Placed by the player or by scripts" - the player's half is
     * PinEditor/QuickTravel's drag-and-drop; this is the script half. A
     * running Lich task can drop a pin the same way it can send a chat line
     * or run an intent, without a person ever opening the map. Same storage,
     * same addPin/updatePin mapPins.ts already exposes to the UI - a script
     * is just another caller, not a second pin system.
     *
     * icon and color arrive as free strings from outside the app's own type
     * system (a script, possibly hand-edited), so both are checked against
     * the real PIN_ICONS/PIN_COLORS lists rather than cast - an unrecognised
     * icon silently becomes "no icon" and an unrecognised colour falls back
     * to blue, rather than either one reaching PIN_ICON_COMPONENT as a key
     * it does not have.
     */
    case 'map_pin': {
      const character = get().character
      const { roomId, zone, label } = msg.payload
      if (!character?.name || !Number.isFinite(roomId) || !label) break
      const icon: PinIcon | undefined = (PIN_ICONS as readonly string[]).includes(
        msg.payload.icon ?? ''
      )
        ? (msg.payload.icon as PinIcon)
        : undefined
      const color: PinColor = (PIN_COLORS as readonly string[]).includes(msg.payload.color ?? '')
        ? (msg.payload.color as PinColor)
        : 'blue'
      const pins = loadPins(character.name, character.instance)
      const already = pinFor(pins, roomId)
      if (already) {
        updatePin(character.name, character.instance, already.id, { label, color, icon })
      } else {
        addPin(character.name, character.instance, { roomId, zone: zone ?? '', label, color, icon })
      }
      get().addLog(`Pinned "${label}" (room ${roomId}) - placed by a script.`)
      break
    }
  }
}
