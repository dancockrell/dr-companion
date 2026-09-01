/**
 * Type a name, get the place.
 *
 * The map already draws all 3,174 cartographer labels, which is what Genie
 * does, and finding the Bathhouse in Crossing's 1,060 rooms by reading them is
 * the part players work around with a second monitor and a wiki tab. The data
 * to answer it directly has been sitting in the zone files the whole time.
 *
 * Aliases are shown when they are what matched. A player who types "TGN" and
 * is handed "Town Green" needs to see the connection or the answer looks like
 * a different place, and 1,201 of the labelled rooms carry one.
 *
 * The results sit in the flow rather than floating over the map. An absolutely
 * positioned list is the usual shape and it is clipped here: the dashboard
 * wraps this panel in `overflow-hidden`, so a list longer than the space below
 * the box loses its last rows with nothing to say it did. In flow the map
 * gives up 160px while a search is actually open and takes it straight back.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import { searchPlaces, type Place, type PlaceHit } from '../../lib/placeSearch'
import { loadPlaces } from '../../lib/placeIndex'
import { ZONE_INDEX } from '../../lib/mapZoneIndex'

export function PlaceSearch({
  here,
  onPick,
  onZone,
}: {
  /** The zone on screen, so a hit you are already looking at says so. */
  here?: string | null
  onPick: (hit: PlaceHit) => void
  /** Browse any shipped map, including special zones with no ordinary gate. */
  onZone?: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [retry, setRetry] = useState(0)
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Loaded on focus, not on the first keystroke. Reaching for the box is the
  // earliest honest signal that a search is coming, and it buys the fetch the
  // time it takes to type two characters, which is the whole wait.
  const wanted = focused || query.length > 0
  useEffect(() => {
    if (!wanted || places !== null) return
    let cancelled = false
    setLoadState('loading')
    void loadPlaces().then(
      (p) => {
        if (cancelled) return
        setPlaces(p)
        setLoadState('ready')
      },
      () => {
        if (!cancelled) setLoadState('error')
      }
    )
    return () => {
      cancelled = true
    }
  }, [wanted, places, retry])

  const hits = useMemo(() => (places ? searchPlaces(query, places) : []), [query, places])

  // Below two characters searchPlaces returns nothing by design, so the panel
  // would be an empty box sitting open over the map for the whole first
  // keystroke. Closed is the truthful state there.
  const open = focused && query.trim().length >= 2
  const hereIsShipped = ZONE_INDEX.some((zone) => zone.id === here)

  // Arrowing past the bottom of a scrolling list has to bring the row with it,
  // or the keyboard path silently stops matching what is on screen.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function pick(hit: PlaceHit) {
    onPick(hit)
    // Cleared, not left standing. The list is answering a question that has
    // been answered, and the map behind it is now the thing worth looking at.
    setQuery('')
    setActive(0)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return
      // Without this the caret jumps to either end of the query on every press
      // and the arrows are fighting the text field instead of driving a list.
      e.preventDefault()
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
      return
    }

    if (e.key === 'Enter') {
      const hit = hits[active]
      if (hit) {
        e.preventDefault()
        pick(hit)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      // Two steps. The first clears the search, the second gives the keyboard
      // back, so a box opened by accident is never a reason to reach for the
      // mouse.
      if (query) {
        setQuery('')
        setActive(0)
      } else {
        inputRef.current?.blur()
      }
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 rounded border border-border bg-surface px-2 focus-within:border-accent/60">
        <Search className="h-3 w-3 shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // The best answer is the one the ranking put first, and after a
            // new keystroke that is a different row than the one the arrows
            // were on.
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Find a place: bath, bank, TGN"
          spellCheck={false}
          autoComplete="off"
          aria-label="Find a place by name"
          // The docked map can be very narrow. The zone picker used to be
          // shrink-0, which left this perfectly real input at exactly 0px:
          // present to assistive technology, impossible to click. Both
          // controls now keep a small usable floor and share whatever remains.
          className="min-w-12 flex-[2_1_8rem] bg-transparent py-1 text-xs text-ink outline-none placeholder:text-ink-faint"
        />
        {query && (
          <button
            type="button"
            // Held down rather than clicked would blur the input first and
            // close the list out from under the pointer.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('')
              setActive(0)
              inputRef.current?.focus()
            }}
            title="Clear the search" aria-label="Clear the search"
            className="shrink-0 rounded p-0.5 text-ink-faint hover:text-ink"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {onZone && (
          <>
            <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <select
              value={here ?? ''}
              onChange={(e) => onZone(e.target.value)}
              aria-label="Browse any map zone"
              title="Browse any map zone"
              className="min-w-12 max-w-40 flex-[1_1_7rem] bg-surface py-1 text-xs text-ink-muted outline-none"
            >
              {!here && <option value="">All zones</option>}
              {here && !hereIsShipped && <option value={here}>Current zone</option>}
              {ZONE_INDEX.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {open && (
        // Bounded and scrolling. Twelve hits at full height would take most of
        // a short panel, and the ranking means the answer is almost always in
        // the first three.
        <div
          className="max-h-40 shrink-0 overflow-auto rounded border border-border bg-surface-raised"
          onMouseDown={(e) => e.preventDefault()}
        >
          {loadState === 'loading' && (
            <p className="px-2 py-1 text-xs text-ink-faint" role="status">
              Reading the map…
            </p>
          )}

          {loadState === 'error' && (
            <div
              className="flex items-center justify-between gap-2 px-2 py-1 text-xs"
              role="alert"
            >
              <span className="text-warn">Couldn’t load map data.</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setLoadState('idle')
                  setRetry((value) => value + 1)
                  inputRef.current?.focus()
                }}
                className="flex shrink-0 items-center gap-1 rounded border border-warn/40 px-2 py-0.5 text-warn hover:bg-warn/10"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}

          {loadState === 'ready' && places !== null && hits.length === 0 && (
            <p className="px-2 py-1 text-xs text-ink-faint">
              Nothing by that name, across {places.length.toLocaleString()} places.
            </p>
          )}

          <ul>
            {hits.map((hit, i) => (
              <li key={`${hit.zone}:${hit.room}:${hit.matched}`}>
                <button
                  ref={i === active ? activeRef : undefined}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(hit)}
                  className={`flex w-full items-baseline gap-1.5 px-2 py-1 text-left text-xs ${
                    i === active ? 'bg-accent/15 text-ink' : 'text-ink-muted'
                  }`}
                >
                  <span className="truncate">{hit.label}</span>

                  {/* Only when it differs. Printing "Town Green as Town Green"
                      on every primary hit is noise on the rows that are
                      already obvious. */}
                  {hit.matched !== hit.label && (
                    <span className="shrink-0 text-ink-faint">as {hit.matched}</span>
                  )}

                  {/* The zone, in the accent when it is the one already drawn.
                      "Which of the 85 zones" and "can I see it from here" are
                      different questions and both get asked. */}
                  <span
                    className={`ml-auto shrink-0 truncate ${
                      hit.zone === here ? 'text-accent' : 'text-ink-faint'
                    }`}
                  >
                    {hit.zoneName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
