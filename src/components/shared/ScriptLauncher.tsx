/**
 * Activity launcher — Companion-owned intents only.
 */
import { ACTIVITIES, activityToIntent } from '../../data/activities'
import { listReachable } from '../../data/travelPath'
import { describeEntryPlan, DEFAULT_HOUSE_ENTRY } from '../../data/houseEntry'
import { useAppStore } from '../../store/useAppStore'

export function ScriptLauncher({ compact = false }: { compact?: boolean }) {
  const requestIntent = useAppStore((s) => s.requestIntent)
  const character = useAppStore((s) => s.character)
  const addLog = useAppStore((s) => s.addLog)

  const list = compact
    ? ACTIVITIES.filter((a) =>
        ['train', 'heal', 'town', 'burgle', 'travel'].includes(a.id)
      )
    : ACTIVITIES.filter((a) => a.id !== 'stop')

  // Passport-aware, and instance-scoped: a Fallen character is not offered
  // Prime geography at all.
  const dests = character
    ? listReachable(character.accountTier, character.instance)
    : []

  return (
    <section className="px-4 pb-3">
      <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-1.5">
        Activities
      </h2>
      <div className="grid grid-cols-1 gap-2">
        {list.map((a) => (
          <div
            key={a.id}
            className="rounded-xl border border-border bg-surface-raised p-2.5 space-y-1.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{a.title}</div>
                {!compact && (
                  <p className="text-[11px] text-ink-faint leading-snug">
                    {a.summary}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25"
                onClick={() => {
                  if (a.id === 'burgle') {
                    describeEntryPlan(DEFAULT_HOUSE_ENTRY, character?.guild).forEach(
                      (line) => addLog(`Entry: ${line}`)
                    )
                  }
                  requestIntent(activityToIntent(a.id))
                }}
              >
                Start
              </button>
            </div>
            {a.id === 'travel' && !compact && (
              dests.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {dests.slice(0, 12).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="text-[10px] rounded-md border border-border px-2 py-0.5 text-ink-muted hover:text-ink"
                      onClick={() => requestIntent(`travel:${d.id}`)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              ) : (
                // An empty list needs a reason. The two ways to get here are
                // very different problems.
                <p className="text-[10px] text-warn leading-snug">
                  {character?.instance === 'Fallen'
                    ? 'No destinations: this is a Fallen character and only Prime routes are mapped so far. Prime directions do not work on The Fallen, so none are offered.'
                    : 'No destinations reachable. Free accounts need a province passport, from the Citizenship Office in Crossing Town Hall.'}
                </p>
              )
            )}
            {!compact && (
              <p className="text-[10px] text-ink-faint leading-snug">{a.ourPlan}</p>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-faint mt-1.5 leading-snug">
        Companion-owned activities. Game knowledge from public sources; our
        implementation. Stop is always on the footer.
      </p>
    </section>
  )
}
