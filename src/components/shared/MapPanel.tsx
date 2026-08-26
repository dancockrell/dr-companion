/**
 * The map, inline in the panel.
 *
 * Drawn from Lich's own room graph, which carries the layout the community's
 * cartographers built: `genie_pos` gives each room an x/y/z, `wayto` gives the
 * links, and it is all keyed to Lich room ids. So this is their map work,
 * reached through data Lich already holds on the player's machine — not a copy
 * of anyone's files, and not a second geography of our own free to disagree
 * with the one `#goto` actually uses.
 *
 * The drawing lives in MapCanvas, shared with the popped-out window, so the
 * glance and the watch cannot drift into two different maps.
 *
 * Not a travel control. Clicking a room asks for a route and shows it; it does
 * not walk anywhere. Moving stays a decision made with the route in view.
 */
import { useEffect, useMemo, useState } from 'react'
import { loadZone, DEFAULT_ZONE } from '../../lib/mapData'
import type { MapZone } from '../../bridge/types'
import {
  Map as MapIcon,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  PanelRightClose,
} from 'lucide-react'
import { describeTrail } from '../../lib/trail'
import { useAppStore } from '../../store/useAppStore'
import { bridge } from '../../bridge'
import type { IntentName } from '../../bridge/types'
import { isTauri, invokeTauri } from '../../lib/tauri'
import { MapCanvas, MapLegend } from './MapCanvas'
import { PlaceSearch } from './PlaceSearch'
import type { PlaceHit } from '../../lib/placeSearch'

/**
 * @param plane Fill the height given rather than a fixed box. Set when the map
 *   has a column of its own, where the point is that it is big enough to watch
 *   and a fixed height would waste the space it was given.
 */
export function MapPanel({ plane = false }: { plane?: boolean }) {
  const liveZone = useAppStore((s) => s.mapZone)
  const [builtZone, setBuiltZone] = useState<MapZone | null>(null)

  /**
   * Which zone is on screen, and how you got here.
   *
   * A stack rather than a single id, because following gates without a way
   * back is worse than not following them: three clicks into the trade road
   * and the only route home is knowing which of 85 zones you started in.
   * Empty means "wherever the character is", which is the normal state.
   */
  const [zoneStack, setZoneStack] = useState<string[]>([])
  const browsing = zoneStack[zoneStack.length - 1] ?? null

  // Lich wins when it is connected: it knows where the character actually is
  // and carries tags the shipped cartography does not. But a map that is blank
  // until you connect is a map nobody can judge, and the demo is where most
  // people meet this first, so the built zones stand in.
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
  const path = useAppStore((s) => s.mapPath)
  const connected = useAppStore((s) => s.bridgeConnected)
  const hereId = useAppStore((s) => s.mapHere?.id ?? null)

  const [level, setLevel] = useState<number | null>(null)
  const [tall, setTall] = useState(false)
  const [poppedOut, setPoppedOut] = useState(false)

  // Asked, not remembered. The map window is a separate webview with its own
  // state, so this panel cannot know from its own memory whether a window it
  // opened is still there or the user closed it by hand.
  useEffect(() => {
    if (!isTauri()) return
    void invokeTauri('map_window_open')
      .then((open) => setPoppedOut(open === true))
      .catch(() => setPoppedOut(false))
  }, [])

  useEffect(() => {
    if (connected) bridge.requestIntent('map_zone' as IntentName)
  }, [connected, hereId])

  const levels = useMemo(() => {
    if (!zone?.rooms) return []
    return [...new Set(zone.rooms.map((r) => r.z ?? 0))].sort((a, b) => a - b)
  }, [zone])

  const trail = useAppStore((s) => s.mapTrail)

  const onRoute = useMemo(
    () => new Set((path?.ok ? (path.rooms ?? []) : []).map((r) => r.id)),
    [path]
  )

  async function popOut() {
    try {
      await invokeTauri('open_map_window')
      setPoppedOut(true)
    } catch {
      // Leave the inline map showing rather than hiding it behind a window
      // that never opened.
      setPoppedOut(false)
    }
  }

  async function popBack() {
    try {
      await invokeTauri('close_map_window')
    } finally {
      // In the `finally`, so a close that errored still returns the inline map
      // rather than leaving the panel pointing at a window that is not there.
      setPoppedOut(false)
    }
  }

  const refresh = () => bridge.requestIntent('map_zone' as IntentName)

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
   * onto it. Pushing would leave a "← Back" that goes back to where you are
   * already standing, which is a button that appears to do nothing.
   */
  function goToPlace(hit: PlaceHit) {
    // The route first. It does not care which zone is drawn and it is the part
    // with a round trip to Lich in it, so it goes out before anything here
    // waits on a file read.
    bridge.requestIntent('map_path' as IntentName, { to: hit.room })

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
     * up with, and for the length of the fetch `zone` is null: the panel falls
     * through to its "nothing asked for yet" state and the title, the map and
     * the search box all blink out together. Picking "Bathhouse, Throne City"
     * from Crossing showed the header reading MAP with an empty panel under
     * it. Loading first means the push and the map arrive in the same render.
     */
    void loadZone(hit.zone).then((z) => {
      // No file for that zone means the index is ahead of the cartography.
      // Staying put is the honest answer; the route was already asked for.
      if (!z) return
      setBuiltZone(z)
      setZoneStack((st) => [...st, hit.zone])
    })
  }

  if (!connected) {
    return (
      <Shell plane={plane}>
        <p className="text-xs text-ink-faint leading-relaxed">
          No bridge. In Mock this shows a small invented town; on Live Lich it
          shows the zone you are standing in.
        </p>
      </Shell>
    )
  }

  // The map is in its own window. Say where it went and offer it back, rather
  // than leaving a mystery gap under the location line.
  if (poppedOut) {
    return (
      <Shell
        plane={plane}
        title="Map"
        right={
          <button
            type="button"
            className="flex items-center gap-1 text-xs rounded border border-border px-2 py-0.5 text-ink-muted hover:text-ink"
            onClick={popBack}
          >
            <PanelRightClose className="w-3 h-3" />
            Bring it back
          </button>
        }
      >
        <p className="text-xs text-ink-faint leading-relaxed">
          Open in its own window, where it is big enough to watch.
        </p>
      </Shell>
    )
  }

  // "No map" and "an empty map" are different answers, and must not look alike.
  if (!zone) {
    return (
      <Shell plane={plane} onRefresh={refresh} onPopOut={isTauri() ? popOut : undefined}>
        <p className="text-xs text-ink-faint leading-relaxed">
          Nothing asked for yet. Press refresh, or move a room and it will
          arrive on its own.
        </p>
      </Shell>
    )
  }

  if (!zone.ok) {
    return (
      <Shell plane={plane} onRefresh={refresh} onPopOut={isTauri() ? popOut : undefined}>
        <p className="text-xs text-warn leading-relaxed">
          {zone.reason ?? 'Lich has no map for where you are.'}
        </p>
      </Shell>
    )
  }

  const z = level ?? levels[0] ?? 0

  return (
    <Shell
      plane={plane}
      title={zone.name ?? `Zone ${zone.zone}`}
      onRefresh={refresh}
      onPopOut={isTauri() ? popOut : undefined}
      right={
        <div className="flex items-center gap-2">
          {levels.length > 1 && (
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-ink-faint" />
              {levels.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`text-xs rounded px-1.5 py-0.5 border ${
                    z === lv
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-ink-faint'
                  }`}
                  onClick={() => setLevel(lv)}
                >
                  {lv}
                </button>
              ))}
            </div>
          )}
          {/* Only meaningful in the stack. In a plane the height comes from
              the column and the divider, so a grow/shrink toggle would be a
              second control fighting the first. */}
          {!plane && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title={tall ? 'Shrink the map' : 'Give the map more room'}
              onClick={() => setTall((v) => !v)}
            >
              {tall ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      }
    >
      {/* Above the map rather than beside the title, because the answer it
          gives is a place on the map and the two want to be read together.
          It costs one row and gives back the thing the map could not do. */}
      <PlaceSearch here={zone.zone} onPick={goToPlace} />

      {/* A real height, not a max. `fit` scales the zone into whatever box it
          is given, and a max-height box collapses to the content's own size —
          which for a small zone is a stamp in the corner.
          In plane mode the height comes from the column instead. */}
      <div
        className={`overflow-hidden rounded bg-surface ${
          plane ? 'flex-1 min-h-0' : ''
        }`}
        style={plane ? undefined : { height: tall ? 320 : 168 }}
      >
        <MapCanvas
          zone={zone}
          level={z}
          onRoute={onRoute}
          fit
          onPick={(id) => bridge.requestIntent('map_path' as IntentName, { to: id })}
          onZone={(id) => setZoneStack((st) => [...st, id])}
          trail={trail}
        />
      </div>

      {/* The way back.
       *
       * Only present while browsing, because it is the only state it means
       * anything in. Two buttons rather than one: back is a step, and "where I
       * am" is the thing you actually want after wandering four zones out and
       * realising the character has moved. */}
      {browsing && (
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setZoneStack((st) => st.slice(0, -1))}
            className="rounded border border-border px-2 py-0.5 text-ink-muted hover:text-ink"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => setZoneStack([])}
            className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent"
          >
            Where I am
          </button>
          <span className="truncate text-ink-faint">
            {zone?.name ?? 'Loading'}
            {zoneStack.length > 1 ? ` — ${zoneStack.length} gates out` : ''}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <MapLegend
          kinds={[...new Set((zone?.rooms ?? []).flatMap((r) => r.tags ?? []))]}
        />
        {/* What the trail says, in words.
         *
         * The stroke on the chart answers "where" and this answers "what is
         * happening", which is the question you actually have when you look
         * back at a window a script has been driving for an hour. It sits
         * beside the room count because that is the line the eye already goes
         * to for the state of the map rather than the state of the game. */}
        <span className="text-xs text-ink-faint shrink-0 truncate" title={describeTrail(trail)}>
          {trail.recent.length > 0
            ? describeTrail(trail)
            : `${zone.rooms?.length ?? 0} rooms${zone.truncated ? ` of ${zone.total}, capped` : ''}`}
        </span>
      </div>

      {path?.ok && (
        <p className="text-xs text-good leading-snug">
          {path.steps} rooms to{' '}
          {path.rooms?.[path.rooms.length - 1]?.title ?? path.to}
        </p>
      )}
      {path && !path.ok && (
        <p className="text-xs text-warn leading-snug">{path.reason}</p>
      )}
    </Shell>
  )
}

function Shell({
  children,
  title,
  onRefresh,
  onPopOut,
  right,
  plane = false,
}: {
  children: React.ReactNode
  title?: string
  onRefresh?: () => void
  onPopOut?: () => void
  right?: React.ReactNode
  plane?: boolean
}) {
  /**
   * Who this map is of.
   *
   * It sits here because the portrait box gave up its name line to make room
   * for the doll, and a name nowhere in the window is a real problem the
   * moment two characters are logged in: every panel looks the same and
   * nothing says which one you are driving.
   *
   * Read from the store rather than passed down, because every branch of this
   * panel goes through Shell and threading it through five call sites to say
   * the same thing five times is how one of them ends up missing it.
   */
  const who = useAppStore((s) => s.character)?.name

  return (
    <section
      className={`flex flex-col gap-1.5 p-2 ${
        // In a plane the section owns the column, so it becomes the flex
        // container the map body stretches inside. Otherwise it sizes to its
        // own content like any other panel.
        plane ? 'flex flex-col h-full min-h-0' : ''
      }`}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-faint uppercase tracking-wider min-w-0">
          <MapIcon className="w-3.5 h-3.5 shrink-0" />
          {/* Zone first, and it keeps the room. The shrink factors are the
              whole point: both truncate, but the name gives up width ten times
              faster, so "Abandoned Mine and Lairocott Brach" stays readable
              while a long name loses its tail. The map is of a place. */}
          <span className="min-w-0 shrink truncate">{title ?? 'Map'}</span>
          {who && (
            <>
              <span className="shrink-0" aria-hidden="true">
                ·
              </span>
              {/* Left in its own case. The zone is a heading and shouts; a
                  character's name is a name, and DAN THE BOLD reads like the
                  app is addressing him. */}
              <span className="min-w-0 shrink-[10] truncate normal-case tracking-normal text-ink-muted">
                {who}
              </span>
            </>
          )}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {right}
          {onPopOut && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Open the map in its own window"
              onClick={onPopOut}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Ask Lich for this zone again"
              onClick={onRefresh}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>
      {children}
    </section>
  )
}
