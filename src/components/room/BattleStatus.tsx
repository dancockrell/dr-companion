import { useAppStore } from '../../store/useAppStore'
import { Paperdoll } from '../shared/Paperdoll'
import { VitalCluster, vitalsFor } from '../shared/VitalCluster'
import { StatusBoard } from '../shared/StatusBoard'
import { HandsRow } from '../shared/HandsRow'

/**
 * You, above the fight rather than a column away from it.
 *
 * Damage, what's currently wrong with you, and what's in your hands were
 * already on screen — DashboardLayout's own "You" box, top right. Real
 * information, in the wrong place for what it is used for: a fight asks
 * "can I keep taking this" and "what am I holding" continuously, and the
 * dashboard column is not the thing anyone is looking at while reading the
 * radar. Duplicating this handful of read-only views here costs nothing —
 * they all read straight from the store, nothing computed twice — and
 * means the answer to "how am I doing" never requires looking away from
 * the picture that is telling you what's about to hit you.
 *
 * Portrait is left out on purpose. It answers "what does my character look
 * like", which does not change mid-fight and already has a home in the
 * dashboard; spending width on a face here is width the paperdoll and the
 * vitals bar — the two things that *do* change every few seconds in combat
 * — do not get.
 */
export function BattleStatus() {
  const character = useAppStore((s) => s.character)
  const vitals = vitalsFor(character)

  return (
    <div className="rounded border border-border bg-surface-raised p-2">
      {/* Same row shape DashboardLayout's own "You" box uses — doll and
          vitals side by side, because a wound in a leg and a health bar at
          40% are one situation, not two. */}
      <div className="flex flex-wrap items-start gap-3">
        <Paperdoll
          injuries={character?.injuries ?? {}}
          height={64}
          known={character?.injuries !== undefined}
        />
        <VitalCluster vitals={vitals} height={48} />
      </div>
      <StatusBoard />
      {/* HandsRow supplies its own top border and spacing, built for
          stacking under exactly this — see its doc comment: "in a fight
          this is the question." */}
      <HandsRow character={character ?? null} />
    </div>
  )
}
