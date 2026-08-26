import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'
import { RoundtimeMeter } from './RoundtimeMeter'
import type { SituationFlag } from '../../types'

/**
 * What is currently true about you, ranked by how much it matters.
 *
 * The flags were on screen already, as a row of undifferentiated amber pills
 * in the header that said `low health`, `in combat`, `prone` in whatever order
 * the bridge happened to build the array. Everything looked equally urgent,
 * which is the same as nothing looking urgent, and the ordering was an
 * implementation detail of a Ruby method.
 *
 * Three things changed. The bridge now reads the whole indicator hash instead
 * of five names out of it, so poisoned, diseased, hidden, invisible, kneeling,
 * sitting and joined arrive at all. The board sorts by seriousness rather than
 * by arrival. And where the game gives a real number, the number is shown.
 *
 * **On magnitude, honestly.** Almost none of this has any. The Simutronics
 * indicator stream is a set of booleans: the icon is lit or it is not, and
 * there is no "how stunned" behind it. Two things carry a real clock and only
 * two: roundtime, in seconds, and active spells, in minutes. Everything else
 * gets a word, because inventing a severity for a boolean would be making the
 * panel say something the game never said. That is the failure this app exists
 * to avoid.
 *
 * **Why the chips are coloured.** Three bands, and each answers a different
 * question, which is why they must not look alike:
 *
 *   - **danger** — something is hurting you right now, or you are down. It
 *     will get worse on its own if you do nothing.
 *   - **warn** — you cannot act, cannot defend, or cannot move. It costs you
 *     the fight but it passes.
 *   - **good** — a state you went out of your way to get, and would want to
 *     know had broken. Hidden is the one that matters: nothing else on screen
 *     tells you when your hiding drops.
 *
 * A state you chose reading in the same colour as one killing you was the
 * original fault, so the good band exists to break exactly that.
 */

type Band = 'danger' | 'warn' | 'good'

/**
 * Seriousness order, with why each one sits where it does. Lower rank is read
 * first, because the top of this list is what you act on.
 *
 * `immobilized` and `bags_full` are in the type and no bridge version has ever
 * sent them. They are ranked anyway rather than deleted, so that the day
 * something does emit them they render in the right place instead of falling
 * to the bottom as an unknown.
 */
const RANK: Array<{ flag: SituationFlag; band: Band; label: string; why: string }> = [
  { flag: 'dead', band: 'danger', label: 'Dead', why: 'you are dead' },
  { flag: 'dying', band: 'danger', label: 'Dying', why: 'you are bleeding out' },
  { flag: 'bleeding', band: 'danger', label: 'Bleeding', why: 'losing health with no action from anyone' },
  { flag: 'low_health', band: 'danger', label: 'Low health', why: 'under 35 percent' },
  { flag: 'poisoned', band: 'danger', label: 'Poisoned', why: 'will keep costing health until it is treated' },
  { flag: 'diseased', band: 'danger', label: 'Diseased', why: 'will keep costing health until it is treated' },
  { flag: 'stunned', band: 'warn', label: 'Stunned', why: 'you cannot act at all' },
  { flag: 'webbed', band: 'warn', label: 'Webbed', why: 'you cannot move' },
  { flag: 'immobilized', band: 'warn', label: 'Immobilised', why: 'you cannot move' },
  { flag: 'prone', band: 'warn', label: 'Prone', why: 'on the ground, most of your defence gone, standing costs roundtime' },
  { flag: 'kneeling', band: 'warn', label: 'Kneeling', why: 'defence reduced until you stand' },
  { flag: 'sitting', band: 'warn', label: 'Sitting', why: 'defence reduced until you stand' },
  { flag: 'in_combat', band: 'warn', label: 'In combat', why: 'something in the room is hostile' },
  { flag: 'bags_full', band: 'warn', label: 'Bags full', why: 'nothing more will go in' },
  { flag: 'hidden', band: 'good', label: 'Hidden', why: 'you are hiding, and nothing else on screen says when that breaks' },
  { flag: 'invisible', band: 'good', label: 'Invisible', why: 'you cannot be seen' },
  { flag: 'joined', band: 'good', label: 'Joined', why: 'you are in a group' },
]

const BAND_STYLE: Record<Band, string> = {
  danger: 'border-danger/40 bg-danger/15 text-danger',
  warn: 'border-warn/40 bg-warn/15 text-warn',
  good: 'border-good/40 bg-good/15 text-good',
}

/**
 * Spells running out soonest are the ones worth a colour.
 *
 * Under a minute it is going to drop mid-fight, which is the only time the
 * number changes a decision. Under five it wants recasting before the next
 * one. Above that it is just a fact and should read as one.
 */
function spellTone(minutes: number): string {
  if (minutes <= 1) return 'text-danger'
  if (minutes <= 5) return 'text-warn'
  return 'text-ink-muted'
}

export function StatusBoard() {
  const character = useAppStore((s) => s.character)

  if (!character) return null

  const flags = new Set<string>(character.situation)
  // roundtime is deliberately not a chip. It has a real countdown and gets one.
  flags.delete('roundtime')

  const shown = RANK.filter((r) => flags.has(r.flag))

  // Anything the bridge sends that this list has not heard of still renders,
  // at the end and in the neutral band. A newer bridge adding a flag should
  // show up as a word nobody has styled yet, not disappear.
  const unknown = [...flags].filter((f) => !RANK.some((r) => r.flag === f))

  const spells = character.spells ?? []
  const inRoundtime = (character.roundtime ?? 0) > 0
  const quiet = shown.length === 0 && unknown.length === 0 && !inRoundtime

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {/* First, and its own shape, because it is the only one that is
            counting and the only one where waiting is the right response. */}
        <RoundtimeMeter />

        {shown.map((r) => (
          <span
            key={r.flag}
            title={`${r.label}: ${r.why}`}
            className={cn(
              'rounded border px-1.5 py-0.5 text-xs font-medium',
              BAND_STYLE[r.band]
            )}
          >
            {r.label}
          </span>
        ))}

        {unknown.map((f) => (
          <span
            key={f}
            title="Reported by the bridge, not yet known to this panel."
            className="rounded border border-border bg-surface-overlay px-1.5 py-0.5 text-xs text-ink-muted"
          >
            {f.replace(/_/g, ' ')}
          </span>
        ))}

        {quiet && <span className="text-xs text-ink-faint">Nothing on you.</span>}
      </div>

      {spells.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-border pt-1.5">
          {/* Shortest first, because the only decision this informs is what is
              about to drop. Minutes, as dr-scripts counts them, not a bar:
              a bar would need a maximum and no maximum was ever sent. */}
          {spells.map((s) => (
            <div key={s.name} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{s.name}</span>
              <span className={cn('shrink-0 text-xs tabular-nums', spellTone(s.minutes))}>
                {s.minutes}m
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
