import { useEffect, useMemo, useRef, useState } from 'react'
import { CHANNELS, linesFor, unreadCounts, type Channel } from '../../lib/chatChannels'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

/**
 * The game text, in tabs.
 *
 * One scrolling log is the reason nobody reads the log: a guild announcement,
 * a map error and forty lines of combat spam go past looking identical, and
 * the one line you were waiting for is gone. Tabs mean speech is still there
 * after the fight.
 *
 * Two behaviours carry most of the value and both are about not losing your
 * place. Scroll position sticks to the bottom only while you are already at
 * the bottom, so reading back through a fight is not yanked away by the next
 * swing. And unread counts are per tab against their own high-water mark, so
 * ignoring combat for an hour still leaves an accurate "three people spoke".
 */
export function ChatTabs({ height }: { height?: number }) {
  const logLines = useAppStore((s) => s.logLines)
  const [tab, setTab] = useState<Channel>('all')
  const [seen, setSeen] = useState<Partial<Record<Channel, number>>>({})

  const scroller = useRef<HTMLDivElement | null>(null)
  const stuckToBottom = useRef(true)

  const lines = useMemo(() => linesFor(logLines, tab), [logLines, tab])
  const unread = useMemo(() => unreadCounts(logLines, seen), [logLines, seen])

  // Reading the current tab marks it read. Deliberately on every render of new
  // lines rather than on click: if you are looking at Speech, speech is read.
  useEffect(() => {
    const top = logLines.length ? logLines[logLines.length - 1].seq : 0
    setSeen((s) => (s[tab] === top ? s : { ...s, [tab]: top }))
  }, [logLines, tab])

  useEffect(() => {
    const el = scroller.current
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-0.5 border-b border-border">
        {CHANNELS.map((c) => {
          const n = unread[c.id]
          const active = tab === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setTab(c.id)}
              title={c.hint}
              className={cn(
                'flex items-center gap-1 rounded-t border-b-2 px-2 py-1 text-xs transition-colors',
                active
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink-muted'
              )}
            >
              {c.label}
              {/* Only shown when there is something unread and you are not
                  looking at it. A permanent zero is noise. */}
              {!active && n > 0 && (
                <span className="rounded bg-accent/20 px-1 text-xs text-accent">{n}</span>
              )}
            </button>
          )
        })}
      </div>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-y-auto px-1 py-1"
        style={height ? { height } : undefined}
      >
        {lines.length === 0 ? (
          <p className="px-1 py-2 text-xs text-ink-faint">
            {tab === 'all' ? 'Nothing yet.' : `Nothing in ${tab} yet.`}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {lines.map((l) => (
              <li key={l.seq} className="flex gap-2 text-xs leading-snug">
                <span className="shrink-0 tabular-nums text-ink-faint">{l.at}</span>
                <span className="min-w-0 break-words text-ink-muted">{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
