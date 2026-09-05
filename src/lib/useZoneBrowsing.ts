/**
 * Which zone is on screen, and how to get to a different one.
 *
 * Split out of MapPanel.tsx so the popped-out window could have it too - it
 * had none of this, which meant the one map surface built to be left open
 * and watched could not follow a gateway or answer a place search at all,
 * while the small docked panel beside it could do both.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadZone, DEFAULT_ZONE } from './mapData.ts'
import type { MapZone } from '../bridge/types'
import { bridge } from '../bridge/index.ts'
import type { PlaceHit } from './placeSearch'
import { ZONE_INDEX } from './mapZoneIndex.ts'
import { createLatestRequestGate } from './recoverableLoad.ts'

export interface ZoneLoadStatus {
  id: string
  name: string
  operation: 'open' | 'browse' | 'back' | 'reset'
}

export interface ZoneLoadError extends ZoneLoadStatus {
  detail: string
}

type PendingZoneLoad = ZoneLoadStatus & {
  apply: (zone: MapZone) => void
}

function zoneName(id: string) {
  return ZONE_INDEX.find((zone) => zone.id === id)?.name ?? `Zone ${id}`
}

export function useZoneBrowsing(liveZone: MapZone | null) {
  const [builtZone, setBuiltZone] = useState<MapZone | null>(null)
  const [arrivalIds, setArrivalIds] = useState<Set<number>>(new Set())
  const requestGate = useRef(createLatestRequestGate())
  const retryLoad = useRef<PendingZoneLoad | null>(null)
  const [zoneLoading, setZoneLoading] = useState<ZoneLoadStatus | null>(null)
  const [zoneLoadError, setZoneLoadError] = useState<ZoneLoadError | null>(null)

  /**
   * A stack rather than a single id, because following gates without a way
   * back is worse than not following them: three clicks into the trade road
   * and the only route home is knowing which of 85 zones you started in.
   * Empty means "wherever the character is", which is the normal state.
   */
  const [zoneStack, setZoneStack] = useState<string[]>([])
  const browsing = zoneStack[zoneStack.length - 1] ?? null

  /**
   * Every zone transition comes through this gate. The old map remains in
   * builtZone until the requested chunk has actually arrived, and only the
   * newest request is allowed to commit. A failure records the exact action
   * so Retry can repeat Back or Reset rather than merely reloading whatever
   * happens to be visible.
   */
  const beginZoneLoad = useCallback(
    (id: string, operation: ZoneLoadStatus['operation'], apply: (zone: MapZone) => void) => {
      const status: ZoneLoadStatus = { id, name: zoneName(id), operation }
      const request = requestGate.current.next()
      retryLoad.current = null
      setZoneLoadError(null)
      setZoneLoading(status)

      void (async () => {
        try {
          const loaded = await loadZone(id)
          if (!loaded) throw new Error('That map is not included in this build.')
          if (!requestGate.current.isCurrent(request)) return

          apply(loaded)
          retryLoad.current = null
          setZoneLoadError(null)
          setZoneLoading(null)
        } catch (error) {
          if (!requestGate.current.isCurrent(request)) return
          retryLoad.current = { ...status, apply }
          setZoneLoading(null)
          setZoneLoadError({
            ...status,
            detail: error instanceof Error ? error.message : 'The map data could not be read.',
          })
        }
      })()

      return request
    },
    []
  )

  const retryZone = useCallback(() => {
    const failed = retryLoad.current
    if (failed) beginZoneLoad(failed.id, failed.operation, failed.apply)
  }, [beginZoneLoad])

  // Explicit Browse/Back/Reset requests are not owned by the fallback-load
  // effect below, so they need their own unmount invalidation.
  useEffect(
    () => () => {
      requestGate.current.invalidate()
    },
    []
  )

  function cancelPendingLoad() {
    requestGate.current.invalidate()
    retryLoad.current = null
    setZoneLoading(null)
    setZoneLoadError(null)
  }

  // Lich wins when it is connected: it knows where the character actually is
  // and carries tags the shipped cartography does not. But a map that is blank
  // until you connect is a map nobody can judge, so the built zones stand in.
  useEffect(() => {
    // Browsing wins over the live zone. Following a gate is a deliberate act
    // and the map jumping back the moment Lich sends the next room would make
    // the gates unusable.
    if (liveZone?.ok && !browsing) {
      // The live zone is rendered directly, so no state transition is needed
      // here. Revoke any fallback request and hide its stale retry state in
      // the returned values below.
      requestGate.current.invalidate()
      retryLoad.current = null
      return
    }

    const wanted = browsing ?? DEFAULT_ZONE
    if (builtZone?.ok && builtZone.zone === wanted) return

    const gate = requestGate.current
    const request = beginZoneLoad(wanted, browsing ? 'browse' : 'open', setBuiltZone)
    return () => {
      // Do not cancel a newer explicit browse merely because this older
      // effect is cleaning up after that browse changed the visible zone.
      if (gate.isCurrent(request)) gate.invalidate()
    }
  }, [beginZoneLoad, browsing, builtZone?.ok, builtZone?.zone, liveZone?.ok])

  const zone = browsing ? builtZone : liveZone?.ok ? liveZone : builtZone

  /**
   * Draw a shipped zone only after its file has arrived. Gate clicks used to
   * push the destination first, briefly pairing the new zone id with the old
   * zone's rooms. The map could blank or show the wrong geography under the
   * new title while the chunk loaded.
   *
   * This is also the escape hatch for maps which are intentionally reached by
   * teleport, event entry, or special command and therefore have no ordinary
   * gateway in the cartographer graph.
   */
  function browseZone(id: string, arrivals: number[] = []) {
    if (!id || id === zone?.zone) return

    if (id === liveZone?.zone) {
      cancelPendingLoad()
      setArrivalIds(new Set(arrivals))
      setZoneStack([])
      return
    }

    beginZoneLoad(id, 'browse', (z) => {
      setBuiltZone(z)
      setArrivalIds(new Set(arrivals.filter((roomId) => z.rooms?.some((room) => room.id === roomId))))
      setZoneStack((st) => [...st, id])
    })
  }

  function popZone() {
    const target = zoneStack[zoneStack.length - 2]
    if (!target) {
      resetZone()
      return
    }

    beginZoneLoad(target, 'back', (z) => {
      setBuiltZone(z)
      setArrivalIds(new Set())
      setZoneStack((st) => st.slice(0, -1))
    })
  }

  function resetZone() {
    if (liveZone?.ok) {
      cancelPendingLoad()
      setArrivalIds(new Set())
      setZoneStack([])
      return
    }

    beginZoneLoad(DEFAULT_ZONE, 'reset', (z) => {
      setBuiltZone(z)
      setArrivalIds(new Set())
      setZoneStack([])
    })
  }

  /**
   * Going where the search says the place is.
   *
   * Two things happen and neither of them is walking there. The zone changes
   * so you can see the answer, and a route is asked for so you can decide
   * about it. That is the same contract clicking a room already has, and a
   * search box that moved the character on Enter would be a very different
   * tool from a map.
   *
   * A hit in the character's own zone empties the stack rather than pushing
   * onto it. Pushing would leave a "back" that goes back to where you are
   * already standing, which is a button that appears to do nothing.
   */
  function goToPlace(hit: PlaceHit) {
    // The route first. It does not care which zone is drawn and it is the
    // part with a round trip to Lich in it, so it goes out before anything
    // here waits on a file read.
    bridge.requestIntent('map_path', { to: hit.room })

    if (hit.zone === zone?.zone) return

    if (hit.zone === liveZone?.zone) {
      resetZone()
      return
    }

    /*
     * Loaded before it is pushed, which is the opposite of how the gateways do
     * it and is the fix for something you can watch happen.
     *
     * Pushing first leaves `browsing` naming a zone `builtZone` has not caught
     * up with, and for the length of the fetch `zone` is null: the caller
     * falls through to its "nothing asked for yet" state and the title, the
     * map and the search box all blink out together. Loading first means the
     * push and the map arrive in the same render.
     */
    browseZone(hit.zone)
  }

  return {
    zone,
    browsing,
    zoneStack,
    arrivalIds,
    zoneLoading: liveZone?.ok && !browsing ? null : zoneLoading,
    zoneLoadError: liveZone?.ok && !browsing ? null : zoneLoadError,
    retryZone,
    pushZone: browseZone,
    popZone,
    resetZone,
    goToPlace,
  }
}
