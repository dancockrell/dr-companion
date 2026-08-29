/**
 * Which zone is on screen, and how to get to a different one.
 *
 * Split out of MapPanel.tsx so the popped-out window could have it too - it
 * had none of this, which meant the one map surface built to be left open
 * and watched could not follow a gateway or answer a place search at all,
 * while the small docked panel beside it could do both.
 */
import { useEffect, useState } from 'react'
import { loadZone, DEFAULT_ZONE } from './mapData'
import type { MapZone } from '../bridge/types'
import { bridge } from '../bridge'
import type { PlaceHit } from './placeSearch'

export function useZoneBrowsing(liveZone: MapZone | null) {
  const [builtZone, setBuiltZone] = useState<MapZone | null>(null)

  /**
   * A stack rather than a single id, because following gates without a way
   * back is worse than not following them: three clicks into the trade road
   * and the only route home is knowing which of 85 zones you started in.
   * Empty means "wherever the character is", which is the normal state.
   */
  const [zoneStack, setZoneStack] = useState<string[]>([])
  const browsing = zoneStack[zoneStack.length - 1] ?? null

  // Lich wins when it is connected: it knows where the character actually is
  // and carries tags the shipped cartography does not. But a map that is blank
  // until you connect is a map nobody can judge, so the built zones stand in.
  useEffect(() => {
    // Browsing wins over the live zone. Following a gate is a deliberate act
    // and the map jumping back the moment Lich sends the next room would make
    // the gates unusable.
    if (liveZone?.ok && !browsing) return
    let cancelled = false
    loadZone(browsing ?? DEFAULT_ZONE).then((z) => {
      if (!cancelled) setBuiltZone(z)
    })
    return () => {
      cancelled = true
    }
  }, [liveZone?.ok, browsing])

  const zone = browsing ? builtZone : liveZone?.ok ? liveZone : builtZone

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
      setZoneStack([])
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
    void loadZone(hit.zone).then((z) => {
      // No file for that zone means the index is ahead of the cartography.
      // Staying put is the honest answer; the route was already asked for.
      if (!z) return
      setBuiltZone(z)
      setZoneStack((st) => [...st, hit.zone])
    })
  }

  return {
    zone,
    browsing,
    zoneStack,
    /** Follow a gateway - pushes without loading, since MapCanvas already has the room data for the zone it just left the character's own zone into. */
    pushZone: (id: string) => setZoneStack((st) => [...st, id]),
    popZone: () => setZoneStack((st) => st.slice(0, -1)),
    resetZone: () => setZoneStack([]),
    goToPlace,
  }
}
