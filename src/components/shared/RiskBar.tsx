/**
 * The numbers that decide whether to risk it.
 *
 * Favors are consumed on death to reduce the penalty, so the count answers
 * "can I afford to die right now" — the question a player actually asks before
 * a hard hunt. Room occupancy matters because hunting grounds are shared and
 * "someone is already here" is a routine reason to go elsewhere.
 *
 * See docs/DOMAIN.md sections 16 and 17.
 */
import { HeartPulse, Users, Weight } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

function favorTone(n: number): { tone: string; note: string } {
  if (n <= 0)
    return {
      tone: 'text-danger',
      note: 'no cushion — a death costs full price',
    }
  if (n < 5) return { tone: 'text-warn', note: 'thin' }
  return { tone: 'text-good', note: 'covered' }
}

export function RiskBar() {
  const character = useAppStore((s) => s.character)
  if (!character) return null

  const favors = character.favors
  const others = character.roomPlayers ?? []
  const group = character.groupMembers ?? []
  const contested = others.filter((p) => !group.includes(p))
  const enc = character.encumbrance

  // Nothing useful to say if the bridge reported none of it.
  if (favors === undefined && others.length === 0 && !enc) return null

  const fav = favors === undefined ? null : favorTone(favors)

  return (
    <section className="px-4 pb-2 shrink-0">
      <div className="rounded-xl border border-border bg-surface-raised px-3 py-2 flex items-center gap-4 text-xs flex-wrap">
        {favors !== undefined && fav && (
          <span
            className="flex items-center gap-1.5"
            title="Favors are spent when you die, reducing the penalty"
          >
            <HeartPulse className={`w-3.5 h-3.5 ${fav.tone}`} />
            <span className="text-ink-muted">Favors</span>
            <span className={`font-medium ${fav.tone}`}>{favors}</span>
            <span className="text-ink-faint">{fav.note}</span>
          </span>
        )}

        {enc && (
          <span className="flex items-center gap-1.5" title="Burden reduces effective Athletics">
            <Weight className="w-3.5 h-3.5 text-ink-faint" />
            <span className="text-ink-muted">Burden</span>
            <span className="text-ink">{enc}</span>
          </span>
        )}

        {contested.length > 0 && (
          <span
            className="flex items-center gap-1.5"
            title="Other players hunting in this area"
          >
            <Users className="w-3.5 h-3.5 text-warn" />
            <span className="text-warn">
              {contested.length === 1
                ? `${contested[0]} is here`
                : `${contested.length} others here`}
            </span>
          </span>
        )}
      </div>
    </section>
  )
}
