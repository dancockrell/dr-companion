import { create } from 'zustand'
import type { AppState, SetupComponent, UiMode, GameInstance, AuthMode } from '../types'
import { bridge } from '../bridge'
import type { IntentName, BridgeServerMessage } from '../bridge/types'
import type { DemoPresetId } from '../bridge/mockBridge'
import { loadPrefs, savePrefs } from '../lib/persistence'
import { combatRanks } from '../data/skills'
import { DEFAULT_FRONTEND } from '../lib/frontends'
import {
  APP_VERSION,
  EXPECTED_BRIDGE_VERSION,
  compareVersions,
} from '../lib/versions'
import {
  loadProfiles,
  upsertProfile,
  newProfile,
  profileKey,
  copyProfileSettings,
  deleteProfile as deleteProfileEntry,
  type CharacterProfile,
} from '../lib/profiles'
import { emptyTrail, visit } from '../lib/trail'
import {
  loadPins,
  addPin,
  updatePin,
  pinFor,
  setCorpseMarker,
  clearCorpseMarker,
  PIN_ICONS,
  PIN_COLORS,
  type PinIcon,
  type PinColor,
} from '../lib/mapPins'
import { loadPins as loadQuickSwitchPins, togglePin, MAX_SLOTS } from '../lib/quickSwitch'

const prefs = loadPrefs()

const defaultSetup: SetupComponent[] = [
  {
    id: 'genie',
    label: 'Genie',
    description: 'Your game client (the window you read the game in).',
    status: 'checking',
  },
  {
    id: 'ruby',
    label: 'Ruby runtime',
    description: 'Required so Lich can run automation scripts.',
    status: 'checking',
  },
  {
    id: 'lich',
    label: 'Lich 5',
    description: 'The automation engine that talks to the game.',
    status: 'checking',
  },
  {
    id: 'bridge',
    label: 'Companion bridge',
    description: 'Connects this control panel to Lich.',
    status: 'checking',
  },
  {
    id: 'maps',
    label: 'Map data',
    description: 'Lets the Companion understand rooms and travel.',
    status: 'checking',
  },
]

/**
 * One counter for log lines and trace rows alike.
 *
 * The console interleaves both, and second-resolution timestamps cannot order
 * them: a command and its reply routinely land in the same second, and getting
 * that backwards is exactly the kind of thing that misleads someone reading a
 * trace to work out what broke.
 */
let seqCounter = 0
const nextSeq = () => ++seqCounter

let unsubBridge: (() => void) | null = null
let unsubLiveStatus: (() => void) | null = null

/** Intents that must never be blocked by game state. See docs/DOMAIN.md. */
const SAFETY_INTENTS = ['stop_all', 'pause', 'resume', 'escape']

/**
 * Whether a control offering this intent should be enabled, given what the
 * connected bridge has said it implements.
 *
 * Three states, matching `bridgeIntents`' own three states:
 * - `null` (never told, or told by a bridge too old to say) → enabled. An
 *   unknown answer is not evidence of absence; disabling on it would brick
 *   every control against every bridge that predates this field.
 * - array present, intent listed → enabled.
 * - array present, intent absent → disabled, except a safety intent, which
 *   is never gated on this (see SAFETY_INTENTS and SafetyFooter's own note
 *   on why Stop cannot depend on a signal that can go stale).
 *
 * See BRIDGE_CONTRACT.md's "Implemented-intents contract" for the wire side.
 */
export function isIntentImplemented(
  bridgeIntents: string[] | null,
  intent: string
): boolean {
  if (SAFETY_INTENTS.includes(intent)) return true
  if (bridgeIntents === null) return true
  return bridgeIntents.includes(intent)
}

function handleBridgeMessage(
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

export const useAppStore = create<AppState>((set, get) => ({
  mapHere: null,
  mapTrail: emptyTrail(),
  mapdbInstall: null,
  mapPath: null,
  mapNearest: null,
  mapZone: null,

  setupComplete: prefs.setupComplete ?? false,
  setupReopened: false,
  setupComponents: defaultSetup,
  uiMode: prefs.uiMode,
  alwaysOnTop: prefs.alwaysOnTop,
  character: null,
  characterAt: 0,
  inventory: null,
  runningScripts: [],
  scriptStates: [],
  scriptCatalog: null,
  activeFlow: null,
  quickSwitchPins: loadQuickSwitchPins(),
  settingsFiles: null,
  settingsCharacter: null,
  toggles: null,
  vars: null,
  logLines: [
    { at: new Date().toLocaleTimeString(), text: 'Companion started.', seq: nextSeq() },
  ],
  trace: [],
  traceEnabled: false,
  versions: {
    app: APP_VERSION,
    expectedBridge: EXPECTED_BRIDGE_VERSION,
    actualBridge: null,
    lich: null,
    protocol: null,
  },
  consoleOpen: prefs.consoleOpen ?? false,
  runawayReason: null,
  bridgeConnected: false,
  // Unknown until a bridge says otherwise, never assumed good.
  bridgeAuth: 'unknown' as AuthMode,
  bridgeAuthNote: '',
  // null = unknown, same reasoning as bridgeAuth above. Never "none".
  bridgeIntents: null,
  bridgeMode: prefs.bridgeMode,
  trainFocus: prefs.trainFocus,
  autoSuggestHealer: prefs.autoSuggestHealer,
  huntFavorites: prefs.huntFavorites ?? [],
  huntMode: prefs.huntMode ?? 'suggest',
  preferredHealCity: prefs.preferredHealCity ?? null,
  frontend: prefs.frontend ?? DEFAULT_FRONTEND,
  profiles: loadProfiles(),
  activeProfileKey: null,
  selectedHuntId: null,
  houseEntryMethod: prefs.houseEntryMethod ?? 'lockpick_ring',
  houseEntryMaxSearches: prefs.houseEntryMaxSearches ?? 3,
  houseEntryHide: prefs.houseEntryHide ?? true,

  setSetupComplete: (v) => {
    savePrefs({ setupComplete: v })
    set({ setupComplete: v, setupReopened: false })
  },

  // Show the setup screen on purpose. It will not skip itself this time.
  //
  // Deliberately not persisted, unlike finishing setup. Someone who opens the
  // wizard to change one component and then restarts the app wants the app,
  // not the wizard again: reopening it is a thing you do now, and finishing it
  // is a thing that stays done.
  openSetup: () => set({ setupComplete: false, setupReopened: true }),

  updateSetupComponent: (id, patch) =>
    set((state) => ({
      setupComponents: state.setupComponents.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    })),

  setUiMode: (mode: UiMode) => {
    savePrefs({ uiMode: mode })
    set({ uiMode: mode })
  },
  setAlwaysOnTop: (v) => {
    savePrefs({ alwaysOnTop: v })
    set({ alwaysOnTop: v })
  },
  setCharacter: (c) => set({ character: c }),
  setInventory: (i) => set({ inventory: i }),

  addLog: (line, level) =>
    set((state) => ({
      logLines: [
        ...state.logLines,
        { at: new Date().toLocaleTimeString(), text: line, seq: nextSeq(), level },
      ].slice(-200),
    })),

  readSettings: () => {
    set({ settingsFiles: null, settingsCharacter: null })
    bridge.requestIntent('read_settings')
  },

  checkToggles: () => {
    set({ toggles: null })
    bridge.requestIntent('check_toggles')
  },

  listVars: () => {
    set({ vars: null })
    bridge.requestIntent('list_vars')
  },

  listScripts: () => {
    bridge.requestIntent('list_scripts')
  },

  startScript: (name: string) => {
    bridge.requestIntent('start_script', { name })
  },

  installMapdb: () => {
    set({ mapdbInstall: { status: 'starting' } })
    bridge.requestIntent('install_mapdb')
  },

  setActiveFlow: (v) => set({ activeFlow: v }),

  toggleQuickSwitchPin: (pin) => {
    const { pins, refused } = togglePin(get().quickSwitchPins, pin)
    if (refused) {
      get().addLog(`Quick Switch is full (${MAX_SLOTS} slots) — unpin something first.`, 'warn')
      return
    }
    set({ quickSwitchPins: pins })
  },

  clearLog: () => set({ logLines: [], trace: [] }),

  addTrace: (row) =>
    // Cap it. A trace running all session should not become the reason the
    // app slows down while someone is trying to reproduce a bug.
    set((state) => ({
      trace: [...state.trace, { ...row, seq: nextSeq() }].slice(-400),
    })),

  setTraceEnabled: (v: boolean) => {
    set({ traceEnabled: v })
    // No casts. These are declared in IntentName now - see the note there.
    // The `as IntentName` that used to be on these two lines was the reason
    // three implemented intents were invisible to the type system and to
    // intent-drift-test for as long as the feature existed.
    bridge.requestIntent(v ? 'trace_on' : 'trace_off')
    if (v) bridge.requestIntent('trace_dump')
  },

  setConsoleOpen: (v: boolean) => {
    savePrefs({ consoleOpen: v })
    set({ consoleOpen: v })
  },

  setFrontend: (id: string) => {
    savePrefs({ frontend: id })
    set({ frontend: id })
  },

  clearRunaway: () => {
    set({ runawayReason: null })
    bridge.requestIntent('reset_runaway')
  },

  setBridgeMode: (m: 'mock' | 'live') => {
    bridge.disconnect()
    if (unsubBridge) {
      unsubBridge()
      unsubBridge = null
    }
    bridge.setMode(m)
    savePrefs({ bridgeMode: m })
    set({ bridgeMode: m, bridgeConnected: false, bridgeAuth: 'unknown', bridgeAuthNote: '', bridgeIntents: null, character: null, characterAt: 0, scriptStates: [], runningScripts: [], scriptCatalog: null, settingsFiles: null, toggles: null, vars: null })
    get().addLog(
      m === 'mock' ? 'Switched to mock bridge' : 'Switched to live Lich bridge'
    )
  },

  connectBridge: () => {
    if (unsubBridge) unsubBridge()
    unsubBridge = bridge.onMessage((msg) => handleBridgeMessage(msg, set, get))
    bridge.setMode(get().bridgeMode)

    const live = bridge.getMode() === 'live'

    if (live) {
      // Subscribed before connect, not after. A refused connection can report
      // itself almost immediately, and a listener attached afterwards misses
      // the one event that explains why nothing is happening.
      //
      // Keep the unsubscribe. Dropping it leaked a listener per connect and
      // per reconnect, which multiplied every log line.
      if (unsubLiveStatus) unsubLiveStatus()
      unsubLiveStatus = bridge.onLiveStatus((status, detail) => {
        get().addLog(`Live bridge: ${status}${detail ? ' — ' + detail : ''}`)
        if (status === 'connected') set({ bridgeConnected: true })
        if (status === 'disconnected' || status === 'error')
          set({ bridgeConnected: false })
      })
    }

    bridge.connect()

    // `bridgeConnected` means the transport is open, so only the mock can say
    // so here: it is in-process and connects synchronously. A live socket is
    // merely *connecting*, and may never arrive if Lich is not running.
    //
    // It used to be set true for both. The socket layer refuses to send on a
    // socket that is not open, so nothing was ever lost down a hole — but the
    // gate in requestIntent reads this flag, so pressing Stop during those
    // first moments got "Not connected to Lich bridge" from the transport
    // instead of this store's clear "stop scripts in Lich directly". Wrong
    // message, worst moment.
    //
    // For live, that "merely connecting" default is wrong exactly once: when
    // the transport was already open before this call - a dev-mode HMR
    // reload, or any second mount of this store - and `bridge.connect()`
    // above is then a deliberate no-op on an already-connected socket (see
    // RealBridge.connect), so the 'connected' event that would have flipped
    // this never fires again. Read the real, current status instead of
    // assuming "not yet" - the map panel showed "No bridge" against a
    // genuinely open, working socket until this was read here rather than
    // inferred. See bridge.getLiveStatus's own doc comment.
    set({ bridgeConnected: live ? bridge.getLiveStatus() === 'connected' : true })
  },

  disconnectBridge: () => {
    bridge.disconnect()
    if (unsubBridge) {
      unsubBridge()
      unsubBridge = null
    }
    if (unsubLiveStatus) {
      unsubLiveStatus()
      unsubLiveStatus = null
    }
    set({ bridgeConnected: false, character: null, characterAt: 0, scriptStates: [], runningScripts: [], scriptCatalog: null })
  },

  simulateConnect: () => {
    get().connectBridge()
  },

  requestIntent: (
    intent: IntentName | `travel:${string}`,
    extraArgs?: Record<string, unknown>
  ) => {
    const { character, addLog, bridgeConnected } = get()

    // Stop, pause and escape are never gated. `character.connected` is a flag
    // the *game* side sets, so a stale or false value used to disable the Stop
    // button at exactly the moment someone is hammering it. If the transport
    // is up, these go out.
    const isSafetyIntent = SAFETY_INTENTS.includes(intent)

    if (!bridgeConnected) {
      addLog(
        isSafetyIntent
          ? `Bridge is down — cannot send ${intent}. Stop scripts in Lich directly.`
          : 'Not connected — cannot run intent: ' + intent
      )
      return
    }
    if (!isSafetyIntent && !character?.connected) {
      addLog('Character is not connected — cannot run intent: ' + intent)
      return
    }

    // Caller-supplied args first, so a macro can carry its commands. Intents
    // that build their own below still win, since none of them take args from
    // the caller today.
    let args: Record<string, unknown> | undefined = extraArgs
    if (intent === 'start_training') {
      const { trainFocus, huntFavorites, huntMode, selectedHuntId } = get()
      args = {
        focus: trainFocus,
        favorites: huntFavorites,
        huntMode,
        selectedHuntId,
        guild: character?.guild ?? 'unknown',
        skills: character?.skills ?? [],
        skillRanks: character?.skills?.length
          ? combatRanks(character.skills)
          : character?.skillRanks ?? 50,
      }
    }
    if (intent.startsWith('travel:')) {
      args = { destination: intent.split(':')[1] || 'crossing' }
      bridge.requestIntent('travel', args)
      return
    }
    if (intent === 'go_healer' || intent === 'escape_heal') {
      args = { preferredCity: get().preferredHealCity }
    }
    if (intent === 'burgle') {
      const { houseEntryMethod, houseEntryMaxSearches, houseEntryHide } = get()
      args = {
        method: houseEntryMethod,
        maxSearches: houseEntryMaxSearches,
        hide: houseEntryHide,
        guild: character?.guild ?? 'unknown',
      }
    }
    bridge.requestIntent(intent as IntentName, args)
  },

  demoLowHealth: () => bridge.simulateLowHealth(),
  demoCombat: () => bridge.simulateCombat(),
  demoSafe: () => bridge.simulateSafe(),
  demoBrokenPattern: () => bridge.simulateBrokenPattern(),
  loadPreset: (id: string) => bridge.loadPreset(id as DemoPresetId),

  /**
   * Adopt the settings belonging to whoever the bridge is reporting.
   *
   * Called on every status where the character identity changed. Creating a
   * profile on first sight is deliberate: a new character should just work,
   * and the player should never have to declare one before playing.
   */
  syncProfile: (name: string, instance: GameInstance, guild?: string) => {
    const key = profileKey(name, instance)
    if (key === get().activeProfileKey) return

    const map = loadProfiles()
    const existing = map[key]
    const profile = existing
      ? { ...existing, guild: guild ?? existing.guild, lastSeen: Date.now() }
      : newProfile(name, instance, { guild })

    upsertProfile(profile)

    set({
      activeProfileKey: key,
      profiles: loadProfiles(),
      trainFocus: profile.trainFocus,
      huntFavorites: profile.huntFavorites,
      huntMode: profile.huntMode,
      preferredHealCity: profile.preferredHealCity,
      houseEntryMethod: profile.houseEntryMethod,
      houseEntryMaxSearches: profile.houseEntryMaxSearches,
      houseEntryHide: profile.houseEntryHide,
    })

    get().addLog(
      existing
        ? `Loaded settings for ${name} on ${instance}.`
        : `New character: ${name} on ${instance}. Started a profile.`
    )
  },

  /** Persist a change onto the active character's profile as well as the UI. */
  patchActiveProfile: (patch: Partial<CharacterProfile>) => {
    const key = get().activeProfileKey
    if (!key) return
    const map = loadProfiles()
    const current = map[key]
    if (!current) return
    const next = { ...current, ...patch, lastSeen: Date.now() }
    upsertProfile(next)
    set({ profiles: loadProfiles() })
  },

  deleteProfileByKey: (key: string) => {
    const map = loadProfiles()
    const p = map[key]
    if (!p) return
    const next = deleteProfileEntry(p.name, p.instance)
    set({ profiles: next })
    get().addLog(`Deleted the profile for ${p.name}.`)
  },

  copySettingsFrom: (key: string) => {
    const map = loadProfiles()
    const from = map[key]
    const activeKey = get().activeProfileKey
    const onto = activeKey ? map[activeKey] : undefined
    if (!from || !onto) return
    const merged = copyProfileSettings(from, onto)
    upsertProfile(merged)
    set({
      profiles: loadProfiles(),
      trainFocus: merged.trainFocus,
      huntFavorites: merged.huntFavorites,
      huntMode: merged.huntMode,
      preferredHealCity: merged.preferredHealCity,
      houseEntryMethod: merged.houseEntryMethod,
      houseEntryMaxSearches: merged.houseEntryMaxSearches,
      houseEntryHide: merged.houseEntryHide,
    })
    get().addLog(`Copied ${from.name}'s settings onto ${onto.name}.`)
  },

  setTrainFocus: (ids: string[]) => {
    savePrefs({ trainFocus: ids })
    set({ trainFocus: ids })
    get().patchActiveProfile({ trainFocus: ids })
  },
  toggleTrainFocus: (id: string) => {
    const cur = get().trainFocus
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    savePrefs({ trainFocus: next })
    set({ trainFocus: next })
    get().patchActiveProfile({ trainFocus: next })
  },
  setAutoSuggestHealer: (v: boolean) => {
    savePrefs({ autoSuggestHealer: v })
    set({ autoSuggestHealer: v })
  },
  toggleHuntFavorite: (id: string) => {
    const cur = get().huntFavorites
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    savePrefs({ huntFavorites: next })
    set({ huntFavorites: next })
    get().patchActiveProfile({ huntFavorites: next })
  },
  setHuntMode: (m) => {
    savePrefs({ huntMode: m })
    set({ huntMode: m })
    get().patchActiveProfile({ huntMode: m })
  },
  setSelectedHuntId: (id) => set({ selectedHuntId: id }),
  setPreferredHealCity: (id: string | null) => {
    savePrefs({ preferredHealCity: id })
    set({ preferredHealCity: id })
    get().patchActiveProfile({ preferredHealCity: id })
  },
  setHouseEntryMethod: (m) => {
    savePrefs({ houseEntryMethod: m })
    set({ houseEntryMethod: m })
    get().patchActiveProfile({ houseEntryMethod: m })
  },
  setHouseEntryMaxSearches: (n) => {
    savePrefs({ houseEntryMaxSearches: n })
    set({ houseEntryMaxSearches: n })
    get().patchActiveProfile({ houseEntryMaxSearches: n })
  },
  setHouseEntryHide: (v) => {
    savePrefs({ houseEntryHide: v })
    set({ houseEntryHide: v })
    get().patchActiveProfile({ houseEntryHide: v })
  },
}))

// A handle on the store while developing, so the app can be driven from the
// console without a game attached. Stripped from production builds by the
// import.meta.env.DEV guard, which Vite resolves to false and then dead-code
// eliminates, so this ships as nothing.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__store = useAppStore
}
