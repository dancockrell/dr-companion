/**
 * The game's channels, in tabs, using the game's own labels.
 *
 * This is the feature Genie structurally cannot have. Lich's frontend registry
 * gives `stormfront` the `streams` capability and `genie` only `xml mono`, so
 * Lich holds the channel labels and never sends them to Genie - which is why
 * Genie users build named windows by hand out of highlight patterns.
 *
 * The difference is not cosmetic. The log tabs at the end of the row classify
 * by regular expression (`src/lib/chatChannels.ts`), which is inference: they
 * decide a line is speech because it matched something. Here the game says
 *
 *     <pushStream id='thoughts'/>...<popStream/>
 *
 * and there is nothing to get wrong. Every pattern in `dr-genie-settings` that
 * identifies a whisper, an arrival or a departure is guessing at a fact the
 * protocol already states - and departures took three attempts before landing
 * on matching the direction rather than the verb.
 *
 * See docs/ENGINE.md.
 *
 * # Only channels that have actually appeared
 *
 * No fixed tab list. A tab for a channel the character never uses is furniture,
 * and a row of empty tabs teaches people not to look at the row. A Bard who
 * never joins a group never sees a group tab.
 *
 * That also means the tabs are evidence: if `thoughts` is absent, the game has
 * not sent one, which is a different thing from the client having lost it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { type GameLine } from '../../lib/gameLink'
import { useGameLines, useGameStreams } from '../../lib/useGameLines'
import { GameLineRow } from './GameLineRow'
import type { Highlight } from '../../lib/highlights'
import { useAppStore } from '../../store/useAppStore'
import { CHANNELS, linesFor, type Channel } from '../../lib/chatChannels'
import { cn } from '../../lib/cn'

/**
 * Tabs over the companion own log, kept from the component this replaces.
 *
 * These classify the app log by pattern, which is inference - exactly the
 * thing the game channels exist to replace. They are still here for one
 * honest reason: before a live Lich supplies any channels, and in demo mode
 * where none ever arrive, they are the only grouping there is. Deleting them
 * would have traded a working demo for a tidier import list.
 *
 * Shown after the real channels, so the game own labels are read first.
 */
const LOG_PREFIX = 'log:'
const isLogTab = (t: string) => t.startsWith(LOG_PREFIX)
const logChannel = (t: string) => t.slice(LOG_PREFIX.length) as Channel

/**
 * Names the game uses, in words a player uses.
 *
 * Only for ids actually seen; anything unmapped shows its own id rather than
 * being hidden, because a channel we have no label for is still a channel and
 * dropping it would be the client deciding what matters.
 */
const LABELS: Record<string, string> = {
  thoughts: 'Thoughts',
  death: 'Deaths',
  talk: 'Speech',
  whispers: 'Whispers',
  logons: 'Arrivals',
  familiar: 'Familiar',
  group: 'Group',
  room: 'Room',
  bounty: 'Bounty',
  assess: 'Assess',
  inv: 'Inventory',
  society: 'Society',
}

export function StreamTabs({ highlights }: { highlights: Highlight[] }) {
  // Both of these subscribe, and both hand back a fresh identity when the
  // buffer changes - see useGameLines.ts. Reading the raw buffer instead is
  // the arrangement that left this component showing "no channels yet" while
  // 924 lines of labelled game text sat behind it.
  const allLines = useGameLines()
  const streams = useGameStreams()
  const logLines = useAppStore((s) => s.logLines)
  const [tab, setTab] = useState<string>(LOG_PREFIX + 'all')

  /**
   * Per-tab high-water marks, so an unread count means something.
   *
   * Against each channel's own last-seen sequence rather than a global one:
   * ignoring combat for an hour should still leave an accurate "two people
   * spoke", and a shared mark would zero everything the moment any tab was
   * opened.
   */
  const [seen, setSeen] = useState<Record<string, number>>({})

  const scroller = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)

  // A channel that has never appeared cannot be the selected tab. This happens
  // on a fresh connection, and without it the pane sits empty on a tab that
  // will never receive anything.
  useEffect(() => {
    if (!isLogTab(tab) && !streams.includes(tab)) setTab(LOG_PREFIX + 'all')
  }, [streams, tab])

  const shown: GameLine[] = useMemo(
    () => (isLogTab(tab) ? [] : allLines.filter((l) => l.stream === tab)),
    [tab, allLines]
  )

  // Mark the open tab read whenever new lines land in it.
  useEffect(() => {
    if (isLogTab(tab)) return
    const newest = shown[shown.length - 1]?.seq ?? 0
    if (newest) setSeen((s) => (s[tab] === newest ? s : { ...s, [tab]: newest }))
  }, [shown, tab])

  useEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [shown, logLines, tab])

  // From the subscribed array rather than a fresh read of the buffer. A raw
  // read here would be correct today - it happens during render, so it sees
  // current data - and would silently stop being correct the moment somebody
  // moved it into a memo or an effect. There is no reason to leave that edge
  // lying about when the subscribed copy is already in hand.
  const unreadFor = (id: string) => {
    const mark = seen[id] ?? 0
    return allLines.filter((l) => l.stream === id && l.seq > mark).length
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1 text-xs">
        {streams.map((id) => {
          const unread = unreadFor(id)
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5',
                tab === id ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink'
              )}
              title={`The game labelled these "${id}"`}
            >
              {LABELS[id] ?? id}
              {unread > 0 && tab !== id && (
                <span className="rounded bg-accent/20 px-1 tabular-nums text-accent">
                  {unread}
                </span>
              )}
            </button>
          )
        })}

        {/* Said plainly rather than left as an empty row.
          *
          * No channels can mean three different things and they need different
          * actions: not attached, attached to a frontend without the streams
          * capability, or attached and the game has simply not used one yet. */}
        {streams.length === 0 && (
          <span
            className="text-ink-faint"
            title="Channels appear as the game uses them. If none ever appear, the bridge may be identifying as a frontend without the streams capability - see docs/ENGINE.md."
          >
            no channels yet
          </span>
        )}

        {/* The companion's own log, after the game's channels and visually
            separated, because these are a different kind of thing: the app
            talking about itself rather than the game talking. */}
        <span className="mx-1 text-ink-faint">|</span>
        {CHANNELS.map((c) => {
          const key = LOG_PREFIX + c.id
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'rounded px-1.5 py-0.5',
                tab === key ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink'
              )}
              title={c.hint}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (!el) return
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {isLogTab(tab) ? (
          linesFor(logLines, logChannel(tab)).map((l) => (
            <div key={l.seq} className="text-xs leading-snug text-ink-muted">
              <span className="text-ink-faint">{l.at} </span>
              {l.text}
            </div>
          ))
        ) : (
          shown.map((l) => (
            <GameLineRow key={l.seq} line={l} highlights={highlights} />
          ))
        )}

        {!isLogTab(tab) && shown.length === 0 && (
          <p className="p-2 text-xs text-ink-faint">
            Nothing on this channel yet.
          </p>
        )}
      </div>
    </div>
  )
}
