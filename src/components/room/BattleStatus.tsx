import { useAppStore } from '../../store/useAppStore.ts'
import { StatusBoard } from '../shared/StatusBoard.tsx'
import { HandsRow } from '../shared/HandsRow.tsx'
import { GearNotice } from '../shared/GearNotice.tsx'

/**
 * You, above the fight rather than a column away from it — the two things
 * that are not the face, the doll or the pools.
 *
 * Those three moved into the middle of the battle board itself (see
 * `CombatRadar`'s own `you` prop) — the fixed point the compass is already
 * drawn relative to is exactly where a player's eye already is mid-fight,
 * more so than a header strip above the picture. What's currently wrong
 * with you and what's in your hands stayed here: `StatusBoard` is a list
 * of active effects and `HandsRow` a pair of item names, and neither reads
 * well shrunk into a small circle at the center of a busy compass the way
 * a portrait, a paperdoll's silhouette or a vital's thin bar all do.
 */
export function BattleStatus() {
  const character = useAppStore((s) => s.character)

  return (
    // No border/card background of its own — a first pass gave this its
    // own boxed panel, and stacked above the scene's own bordered box, the
    // actions row and the description box, four cards in a row read as a
    // cramped instrument panel rather than one coherent pane. This is a
    // header strip, not a fifth card: PanelBoundary already gives it a
    // label if something inside throws, and the picture below is the thing
    // that should look like a card here, not this.
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center justify-end gap-2">
      {/* HandsRow supplies its own top border and spacing, built for
          stacking under exactly this — see its doc comment: "in a fight
          this is the question." */}
      <HandsRow character={character ?? null} />
      {/* The global urgent strip already says In combat and the radar itself
          proves it visually. Suppress only that duplicate here; every other
          injury, action-blocking, stealth, spell and roundtime state remains. */}
      <StatusBoard hideInCombat />
      </div>
      <GearNotice />
    </div>
  )
}
