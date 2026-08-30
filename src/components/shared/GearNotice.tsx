/**
 * What you are wearing is costing you something, and the game will not say so.
 *
 * The observed case, verbatim:
 *
 *   The armor on your head makes playing your cocobolo txistu more difficult.
 *
 * That line appears once, when you play, buried in a window that is also
 * carrying arrivals and room descriptions. There is no message when the helm
 * comes off. Nothing on the character sheet mentions it, PLAY USAGE does not,
 * and no wiki page carries it. A new Bard in the helm they started with trains
 * slower than they should, indefinitely, and never finds out why.
 *
 * This is the clearest thing this app is for. Everything else here a player
 * could get by reading a window they already have open. This is a cross-check
 * between two facts that are never on screen together - what is held and what
 * is worn - and the output is a sentence they would not otherwise get.
 *
 * ## Why it is quiet
 *
 * Not in SituationBanner, which is for health, combat and death. This is not
 * urgent. It is a small permanent tax, true for hours at a time, and putting it
 * where the bleeding warnings go would teach people to skim that strip - which
 * costs more than this saves. It sits under the vitals, where it is found by
 * someone looking at their character rather than shouted at someone fighting.
 *
 * ## Why it says nothing when it knows nothing
 *
 * Absent and empty are different. A bridge older than this feature sends no
 * worn list at all, and an empty list means a character wearing nothing. If
 * those were treated alike this panel would silently certify "no problem" for
 * every player on an older bridge, which is the failure mode this project keeps
 * finding: a check that cannot fire reads exactly like a check that passed.
 * `gearConflicts` returns nothing without a list, and nothing is rendered - no
 * all-clear, because none has been earned.
 */
import { AlertTriangle } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { gearConflicts, conflictSubjects } from '../../data/gearConflicts'

export function GearNotice() {
  const character = useAppStore((s) => s.character)
  const inventory = useAppStore((s) => s.inventory)

  const hands = character?.hands
  const worn = inventory?.worn

  const conflicts = gearConflicts(hands, worn)
  if (!conflicts.length || !hands || !worn) return null

  return (
    <div className="mt-1.5 space-y-1">
      {conflicts.map((c) => {
        const { held, worn: wornItem } = conflictSubjects(c, hands, worn)
        return (
          <div
            key={c.id}
            className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-2 py-1.5"
            // The game's own words, so anyone doubting the warning can check it
            // against what they saw rather than against our paraphrase of it.
            title={`${c.evidence}\n\nSeen ${c.seen}.`}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
            <div className="min-w-0 text-xs leading-snug">
              {/* Names, not categories. "Something on your head is slowing your
                  playing" is a worse sentence than naming both items, and both
                  names are already in the payload. */}
              <div className="text-ink">
                {wornItem ? <span className="text-warn">{wornItem}</span> : 'What is on your head'}
                {' is holding back '}
                {held ? <span className="text-warn">{held}</span> : 'what you are holding'}.
              </div>
              <div className="text-ink-muted">{c.cost}</div>
              <div className="text-ink-faint">{c.fix}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
