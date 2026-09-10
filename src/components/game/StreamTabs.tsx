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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, Info } from 'lucide-react'
import {
  setShowGaggedLines,
  useGameLines,
  useGameTabs,
  useShowGaggedLines,
  type DisplayLine,
} from '../../lib/useGameLines.ts'
import { usePlayerConfig } from '../../lib/playerConfig.ts'
import { GameLineRow } from './GameLineRow.tsx'
import type { Highlight } from '../../lib/highlights'
import { useAppStore } from '../../store/useAppStore.ts'
import { CHANNELS, linesFor, type Channel } from '../../lib/chatChannels.ts'
import { STREAM_LABELS } from '../../lib/streamLabels.ts'
import { MAIN_STREAM } from '../../lib/gameLink.ts'
import { useOffClasses } from '../../lib/offClasses.ts'
import { cn } from '../../lib/cn.ts'

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
 * Moved to `lib/streamLabels.ts` so a test can import it without a JSX
 * loader - it collides with the companion's own tab labels and something has
 * to be able to check that the row still says which is which. See that file.
 */
const LABELS = STREAM_LABELS

export function StreamTabs({ highlights, heading, query = '' }: { highlights: Highlight[]; heading?: ReactNode; query?: string }) {
  const offClasses = useOffClasses()
  // Both of these subscribe, and both hand back a fresh identity when the
  // buffer changes - see useGameLines.ts. Reading the raw buffer instead is
  // the arrangement that left this component showing "no channels yet" while
  // 924 lines of labelled game text sat behind it.
  // Substitutes and gags are already applied here - the hook is the one place
  // that happens, and the buffer behind it is untouched. See lib/lineRules.ts.
  const allLines = useGameLines()
  // Every tab, main window first - not `useGameStreams()`, which is the game's
  // *named* channels and therefore excludes the main window. Building the row
  // out of that list is what made live game text undisplayable (#525).
  const streams = useGameTabs()
  const showGagged = useShowGaggedLines()
  const gagCount = usePlayerConfig().gags.filter((g) => g.enabled).length
  const logLines = useAppStore((s) => s.logLines)
  const [tab, setTab] = useState<string>(LOG_PREFIX + 'all')
  /*
   * Whether the player has picked a tab themselves.
   *
   * Without this the pane opens on the companion's own log and stays there
   * while the game talks, which is what a player on the clean VM saw: the
   * channel counters climbing, and this app's log lines in the pane (#525).
   * Following the game is right *until* somebody chooses otherwise, and then
   * it must stop, or a tab cannot be read for longer than one line arrives in.
   */
  const [chosen, setChosen] = useState(false)
  const pick = (id: string) => {
    setChosen(true)
    setTab(id)
  }

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
  /*
   * The same fact as `atBottom`, in state, because a ref cannot draw anything.
   *
   * `atBottom` is a ref on purpose - it is read inside the scroll handler and
   * inside the effect that sticks the view to the bottom, and putting a render
   * on every scroll event of a live game feed would be its own defect. But
   * scrolling up to re-read something and then having the game move on is
   * exactly when a player needs a way back, and a button cannot appear from a
   * ref. So the ref stays the hot path and this mirrors it, written only when
   * the answer actually changes rather than on every scroll event.
   */
  const [pinnedToLatest, setPinnedToLatest] = useState(true)

  // A channel that has never appeared cannot be the selected tab. This happens
  // on a fresh connection, and without it the pane sits empty on a tab that
  // will never receive anything.
  useEffect(() => {
    if (!isLogTab(tab) && !streams.includes(tab)) setTab(LOG_PREFIX + 'all')
  }, [streams, tab])

  /*
   * The game gets the pane the moment it says anything, unless the player has
   * chosen a tab.
   *
   * This is the display half of "no path shows invented lines beside real
   * ones". The other half is that the demo and a game socket can no longer
   * both be on (`src/lib/sessionSource.ts`); this is what puts the real text
   * in front of somebody once it starts arriving.
   */
  useEffect(() => {
    if (chosen) return
    if (streams.includes(MAIN_STREAM)) setTab(MAIN_STREAM)
  }, [chosen, streams])

  const shown: DisplayLine[] = useMemo(
    () => (isLogTab(tab) ? [] : allLines.filter((l) => l.stream === tab)),
    [tab, allLines]
  )
  const needle = query.trim().toLocaleLowerCase()
  const searchResults = useMemo(
    () => needle ? allLines.filter((line) => line.text.toLocaleLowerCase().includes(needle)) : [],
    [allLines, needle]
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

  // Changing tab is not scrolling up. Without this, switching to a channel
  // while scrolled back leaves the jump control on screen over a view that is
  // already at its newest line.
  useEffect(() => {
    atBottom.current = true
    setPinnedToLatest(true)
  }, [tab])

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
      {/* Scrolls sideways rather than wrapping, same reasoning as MacroBar:
        * a channel row that wraps to a second line at a narrow width reads
        * as broken chrome (tabs half on one line, half on the next) rather
        * than as a tab bar with more in it than fits. No visible scrollbar -
        * the row is shorter than one would be - reachable by wheel or drag,
        * same as any tab strip. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border px-2 py-1 text-xs',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {heading && (
          <div className="mr-1 flex shrink-0 items-center gap-1.5 border-r border-border pr-2 font-semibold text-ink-muted">
            {heading}
          </div>
        )}
        {/* Whose channels these are, said out loud, but only once there are
          * two sets in the row to tell apart.
          *
          * The two vocabularies overlap and nothing stopped them: the game's
          * `talk` stream renders through LABELS as "Speech", and the
          * companion's own log has a tab labelled "Speech" too. With both
          * present the row read
          *
          *     Speech  Thoughts  |  All  Speech  Combat  Game  Companion
          *
          * - two tabs, the same word, different content, four pixels and one
          * thin pipe apart. Each button's `title` did say which was which,
          * and a hover is not an answer to a question asked by glancing.
          *
          * Captioning the groups rather than renaming a tab, because neither
          * name is wrong. The game's labels are the game's and not ours to
          * change, and "Speech" is the right word for the companion's speech
          * tab. What was missing was any account of which side of the pipe a
          * tab came from, and that is a property of the row.
          *
          * It also fixes the next collision without anyone noticing there was
          * one. `room` -> "Room" and `inv` -> "Inventory" are already close to
          * other names here; one word added to either list would have been the
          * same bug again. Scoped groups make an overlap harmless instead of
          * making it forbidden. */}
        {streams.length > 0 && <span className="text-ink-faint">game:</span>}
        {streams.map((id) => {
          const unread = unreadFor(id)
          return (
            <button
              key={id}
              type="button"
              onClick={() => pick(id)}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5',
                tab === id ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink'
              )}
              title={
                id === MAIN_STREAM
                  ? 'Everything the game printed that it did not put in a channel: rooms, movement, combat, and the reply to anything you type.'
                  : `The game labelled these "${id}"`
              }
            >
              {id === MAIN_STREAM ? 'Main' : (LABELS[id] ?? id)}
              {unread > 0 && tab !== id && (
                <span className="rounded bg-accent/20 px-1 tabular-nums text-accent">
                  {unread}
                </span>
              )}
            </button>
          )
        })}

        {/* An icon and a tooltip rather than a sentence in the row - said
          * plainly once, in the title, not typeset permanently beside the
          * tabs. No channels can mean three different things and they need
          * different actions: not attached, attached to a frontend without
          * the streams capability, or attached and the game has simply not
          * used one yet - all still in the tooltip, just not on the row. */}
        {streams.length === 0 && (
          <span
            title="No game channels yet. They appear as the game uses them. If none ever appear, check that the bridge is up to date."
            aria-label="No game channels yet"
          >
            <Info className="h-3 w-3 shrink-0 text-ink-faint" />
          </span>
        )}

        {/* The companion's own log, after the game's channels and visually
            separated, because these are a different kind of thing: the app
            talking about itself rather than the game talking. */}
        <span className="mx-1 text-ink-faint">|</span>
        {/* Paired with the "game:" caption above. Only when there is a game
          * set to be distinguished from - alone in the row these tabs are
          * unambiguous, and a caption would be a word charged for nothing in
          * a column that is already short of width. */}
        {streams.length > 0 && <span className="text-ink-faint">this app:</span>}
        {CHANNELS.map((c) => {
          const key = LOG_PREFIX + c.id
          return (
            <button
              key={key}
              type="button"
              onClick={() => pick(key)}
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

        {/* Only when the player has a gag switched on. A switch for a feature
          * nobody is using is furniture, and this row is already short of
          * width - but a gag is the one rule in this client that can make a
          * line vanish, so the moment there is one there has to be a way back
          * that is not "go and edit the config". The lines were never gone;
          * this is what says so. */}
        {gagCount > 0 && (
          <button
            type="button"
            onClick={() => setShowGaggedLines(!showGagged)}
            data-testid="show-gagged-toggle"
            className={cn(
              'ml-auto shrink-0 rounded px-1.5 py-0.5',
              showGagged ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink'
            )}
            title={`${gagCount} gag${gagCount === 1 ? '' : 's'} on. A hidden line is still in the buffer; this puts it back on screen.`}
          >
            {showGagged ? 'Hiding off' : 'Show hidden'}
          </button>
        )}
      </div>

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current
          if (!el) return
          const at = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          atBottom.current = at
          // Only when it changes. `setState` with the same value is cheap and
          // not free, and this fires on every wheel notch of a live feed.
          setPinnedToLatest((was) => (was === at ? was : at))
        }}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {needle ? (
          searchResults.map((l) => (
            <GameLineRow key={l.seq} line={l} highlights={highlights} offClasses={offClasses} showStream showTime />
          ))
        ) : isLogTab(tab) ? (
          linesFor(logLines, logChannel(tab)).map((l) => (
            <div key={l.seq} className="text-xs leading-snug text-ink-muted">
              <span className="text-ink-faint">{l.at} </span>
              {l.text}
            </div>
          ))
        ) : (
          shown.map((l) =>
            /* A line only reaches here gagged when "Show hidden" is on, and
             * then it has to look different from a line that was never
             * hidden - otherwise the switch appears to do nothing and the
             * player cannot tell which rule to go and change. */
            l.gagged ? (
              <div key={l.seq} className="opacity-50" data-testid={`gagged-line-${l.seq}`}>
                <GameLineRow line={l} highlights={highlights} offClasses={offClasses} showTime />
              </div>
            ) : (
              <GameLineRow key={l.seq} line={l} highlights={highlights} offClasses={offClasses} showTime />
            )
          )
        )}

        {needle && searchResults.length === 0 && (
          <p className="p-2 text-xs text-ink-faint">Nothing in game scrollback matches “{query.trim()}”.</p>
        )}

        {!needle && !isLogTab(tab) && shown.length === 0 && (
          <p className="p-2 text-xs text-ink-faint">
            Nothing on this channel yet.
          </p>
        )}
        {/* The way back down.
          *
          * Only while scrolled up, because a control that is always there is
          * furniture: at the bottom it would do nothing, and a button that
          * does nothing teaches people not to read the bar it sits in. It
          * covers no text - it floats over the bottom right of the scroll box
          * and disappears the moment it has done its job. */}
        {!pinnedToLatest && (
          <button
            type="button"
            onClick={() => {
              const el = scroller.current
              if (!el) return
              el.scrollTop = el.scrollHeight
              atBottom.current = true
              setPinnedToLatest(true)
            }}
            className="sticky bottom-1 left-full z-10 -mt-7 mr-1 flex w-max items-center gap-1 rounded-full border border-accent/50 bg-surface-overlay px-2 py-1 text-xs text-accent shadow-lg"
            aria-label="Jump to the latest line"
            title="You have scrolled up. New lines are still arriving; this goes back to the newest one."
          >
            <ArrowDownToLine className="h-3 w-3" aria-hidden />
            Latest
          </button>
        )}
      </div>
    </div>
  )
}
