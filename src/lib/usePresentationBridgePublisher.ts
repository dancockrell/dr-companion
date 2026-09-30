/**
 * Wires `presentationBridge.ts`'s compiler into the running app.
 *
 * `compileWorldSnapshot`/`publishWorldSnapshotIfChanged` existed for a
 * whole PR (#269) with nothing in the app actually calling them - a real
 * compiler with no caller is exactly as inert as no compiler at all. This
 * hook is that caller: it watches the same store fields `BattleColumn`
 * already reads for the existing 2D battle map (`mapZone`, `mapHere`,
 * `character` - see `BattleColumn.tsx`'s own `useAppStore` calls), and
 * republishes on every change. `publishWorldSnapshotIfChanged` keeps that
 * cheap by comparing only viewer-relevant live facts and zone identity.
 * Vitals, roundtime, occupants, ground items, and assessed creature state are
 * viewer facts now, so they must not be discarded merely because the room id
 * stayed the same; unrelated store updates still deduplicate.
 *
 * Call this once, unconditionally, near the app root - React's own rule
 * (hooks can't be called conditionally) rather than a preference, since
 * `App.tsx` renders three different windows (main app, popped-out map,
 * popped-out panel) from one component and only the main window should
 * ever publish. `enabled` is how that's expressed instead: pass
 * `v.kind === 'app'` rather than skipping the call. A popped-out window
 * calling this with `enabled: false` still runs the hook (satisfying the
 * rule) but its effect below no-ops, so it never races the main window's
 * sequence numbers or publishes from whatever partial store state a
 * separate webview happens to have.
 *
 * # Reconnect
 *
 * `docs/NO-3D.md` requires "on launch, reconnect, dropped
 * event, or renderer crash, request a new snapshot." A *new Godot
 * connection* already gets this for free - `presentation_bridge.rs`'s
 * `handle_client` sends whatever snapshot it's holding immediately on auth,
 * without this hook's involvement. What it does not cover is the *game*
 * connection recovering while an already-connected Godot client is still
 * attached: if the Lich bridge drops and reattaches while the character
 * happens to still be in the same room, `shouldPublish`'s room-changed gate
 * sees no room change and correctly stays quiet - correct for the ordinary
 * case (nothing to tell Godot), wrong for this one, because entities and
 * ground items could easily have changed during the gap and Godot would
 * have no way to know. `bridgeConnected` flipping false -> true is that
 * signal, tracked here and forces the next publish regardless of whether the
 * projected facts happen to match the last successful publish.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useAppStore } from '../store/useAppStore.ts'
import { justReconnected, publishWorldSnapshotIfChanged } from './presentationBridge.ts'
import { normalizeIndicatorEvents, type IndicatorEventCursor } from './presentationEvents.ts'
import { publishPresentationEvent } from './viewerClient.ts'
import { presentationSourceForState } from './presentationSource.ts'
import { subscribeGame, streamCharacterState } from './gameLink.ts'
import { sceneOverridesRevision, subscribeSceneOverrides } from './sceneOverrides.ts'

export function usePresentationBridgePublisher(enabled: boolean): void {
  const stream = useSyncExternalStore(subscribeGame, streamCharacterState, streamCharacterState)
  const liveRoom = stream.roomPresentation?.value ?? null
  const zone = useAppStore((s) => s.mapZone)
  const here = useAppStore((s) => s.mapHere)
  const character = useAppStore((s) => s.character)
  const characterAt = useAppStore((s) => s.characterAt)
  // Appearance's worn half comes from here (see `appearance.ts`); the hands
  // half is already on `character`. Subscribed rather than read once, because
  // an inventory scan lands well after the first snapshot and the viewer
  // would otherwise draw an undressed figure until the next room change.
  const inventory = useAppStore((s) => s.inventory)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const bridgeStaleSince = useAppStore((s) => s.bridgeStaleSince)
  const bridgeSourceGeneration = useAppStore((s) => s.bridgeSourceGeneration)
  const characterSourceGeneration = useAppStore((s) => s.characterSourceGeneration)

  // Starts false rather than undefined so a session that mounts already
  // connected is not itself mistaken for a reconnect - there is no prior
  // "disconnected" moment to recover from at first mount, `enabled`/the
  // room-changed publish on the first real snapshot already covers that.
  const wasConnected = useRef(false)
  const indicatorCursor = useRef<IndicatorEventCursor | null>(null)
  const publishQueue = useRef<Promise<void>>(Promise.resolve())
  const publisherEnabled = useRef(false)
  useEffect(() => {
    publisherEnabled.current = enabled
    return () => { publisherEnabled.current = false }
  }, [enabled])

  // A scene-editor edit changes no store field the publisher watches - same
  // zone, same room, same character - so without this the player would change
  // a room's ground kind and watch the viewer not change until they happened
  // to walk out and back. Forced rather than compared, because the projection
  // key is built from the live facts and an override moves none of them.
  const sceneRevision = useSyncExternalStore(
    subscribeSceneOverrides,
    sceneOverridesRevision,
    sceneOverridesRevision
  )
  const publishedRevision = useRef(sceneRevision)

  useEffect(() => {
    if (!enabled) return
    const sceneEdited = publishedRevision.current !== sceneRevision
    publishedRevision.current = sceneRevision
    const force = justReconnected(bridgeConnected, wasConnected.current) || sceneEdited
    wasConnected.current = bridgeConnected
    const source = presentationSourceForState({ mode: bridgeMode, connected: bridgeConnected, hasCharacter: character !== null, staleSince: bridgeStaleSince, bridgeGeneration: bridgeSourceGeneration, characterGeneration: characterSourceGeneration })
    const roomId = zone?.ok && zone.zone && here && zone.rooms?.some((room) => room.id === here.id)
      ? `${zone.zone}-${here.id}` : ''
    const normalized = normalizeIndicatorEvents(indicatorCursor.current, {
      roomId, generation: bridgeSourceGeneration,
      ready: source.kind === 'live' && source.connected && String(character?.location?.roomId ?? '') === String(here?.id ?? ''),
      indicators: stream.indicators,
    })
    indicatorCursor.current = normalized.cursor
    // Snapshot precedes events, so native validation knows their confirmed room.
    // Independent of the AI host; a disabled AI must never mute game facts.
    const stillCurrent = () => {
      if (!publisherEnabled.current) return false
      const latest = useAppStore.getState()
      const latestSource = presentationSourceForState({ mode: latest.bridgeMode, connected: latest.bridgeConnected,
        hasCharacter: latest.character !== null, staleSince: latest.bridgeStaleSince,
        bridgeGeneration: latest.bridgeSourceGeneration, characterGeneration: latest.characterSourceGeneration })
      return latest.bridgeMode === bridgeMode && latest.bridgeSourceGeneration === bridgeSourceGeneration &&
        latest.characterSourceGeneration === characterSourceGeneration && latestSource.connected === source.connected &&
        latest.mapZone?.zone === zone?.zone && latest.mapHere?.id === here?.id &&
        String(latest.character?.location?.roomId ?? '') === String(character?.location?.roomId ?? '')
    }
    publishQueue.current = publishQueue.current.catch(() => {}).then(async () => {
      if (!stillCurrent()) return
      const published = await publishWorldSnapshotIfChanged({ zone, here, character, characterAt, inventory, liveRoom, source }, force, stillCurrent)
      if (!published) return
      for (const event of normalized.events) {
        if (!stillCurrent()) return
        await publishPresentationEvent(event)
      }
    }).catch((error) => console.warn('presentation publication failed', error))
  }, [enabled, zone, here, character, characterAt, inventory, liveRoom, bridgeConnected, bridgeMode, bridgeStaleSince, bridgeSourceGeneration, characterSourceGeneration, sceneRevision, stream.indicators])
}
