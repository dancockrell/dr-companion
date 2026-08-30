import { MindstateBoard } from './MindstateBoard'
import { useDragScroll } from '../../lib/useDragScroll'
import { cn } from '../../lib/cn'
import type { SkillState } from '../../data/skills'

/**
 * Experience, alone, all the way to the right, running the full height of
 * the window - the one thing Dan kept from the old middle dashboard column
 * when the rest of it was cut ("only thing in the middle that needs to
 * survive is a long strip for the experience... lets put that all the way
 * to the right").
 *
 * No Box, deliberately - "we don't need borders and padding." Every other
 * panel in this app uses Box's border-and-header shape because it sits
 * beside siblings that need telling apart; this is the whole column, so
 * there is nothing for a border to separate it from and nothing a header
 * would say that "it's the experience board" doesn't already say by being
 * the only thing here.
 *
 * Grab-and-drag scrolling, the same gesture the map and the Tasks & Scripts
 * grid use (`useDragScroll` - shared, not a fourth copy of the same
 * pointer-capture/threshold logic) - "make it its own field grab and fling
 * up and down like our other scrolling."
 */
export function ExperienceStrip({ skills }: { skills: SkillState[] }) {
  const { ref, dragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = useDragScroll()

  return (
    <div
      ref={ref}
      className={cn(
        'no-scrollbar h-full min-h-0 overflow-auto',
        dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
      )}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <MindstateBoard skills={skills} />
    </div>
  )
}
