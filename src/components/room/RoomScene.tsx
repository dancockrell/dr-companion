import { RoomBackdrop } from './RoomBackdrop'

/**
 * The picture of the room, or something that stands in for it.
 *
 * The stand-in matters more than the art does, and will for a while. There are
 * 17,750 rooms and the renderer manages a couple of hundred an hour, so for
 * the next several days almost every room a player walks into will be a room
 * with no picture. A grey box in that slot would make the whole column look
 * broken rather than unfinished.
 *
 * So the stand-in is generated from the room itself and is different for every
 * room. That is the point Dan asked for: something "easy to identify". Two
 * rooms should not look alike, and walking from one to the next should be
 * visibly a change even before any art exists — which is a thing the real
 * pictures will also have to do.
 *
 * The bands are drawn from the room's own description, so a forest is green
 * and a cellar is not. It is not a picture of the room. It is a consistent
 * fingerprint of it, which is a different and more achievable thing.
 *
 * The fingerprint/art generation itself lives in `RoomBackdrop` now, not
 * here — `CombatRadar` draws on the same backdrop for the same room rather
 * than a flat panel of its own, and two copies of "what does this room look
 * like" would drift the first time either changed.
 */

export function RoomScene({
  zone,
  room,
  title,
  text,
  height,
  maxHeightVh = 42,
  chips,
  overlay,
  shape = 'square',
}: {
  zone: string
  room: number
  title?: string | null
  text?: string | null
  /** A fixed height, for a strip. Omit it for the square stage — the default. */
  height?: number
  /**
   * The height ceiling for the square stage, as a percent of the viewport —
   * ignored when `height` is set. 42 is right for a scene sharing its column
   * with a game pane and chat log underneath it: tall enough to be a real
   * picture, short enough to leave those room to breathe on a wide window.
   * `BattleColumn` has no such neighbour any more — the picture is the pane,
   * give or take a status strip, an action bar and a description box — so it
   * passes a much larger number instead of inheriting a ceiling sized for
   * panels that are not there.
   */
  maxHeightVh?: number
  /** Battle uses a landscape field: cards and a wide central dashboard fit
   * naturally around elliptical range bands instead of colliding inside a
   * square. Other room scenes retain their square composition. */
  shape?: 'square' | 'landscape'
  /** Who's here, layered on top along the bottom edge. */
  chips?: import('react').ReactNode
  /**
   * A tactical layer over the picture itself — `CombatRadar`, when there is a
   * fight. Sized to the same box the backdrop fills, between the picture and
   * the title/chip bars, so a fight draws on the room rather than beside it:
   * one image, not two. It used to be its own separate square underneath
   * this one, drawing the same backdrop a second time — which is the same
   * room rendered twice on screen at once, and the two would silently
   * disagree the moment either one changed independently of the other.
   */
  overlay?: import('react').ReactNode
}) {
  return (
    <div
      // No fixed height by default: a true square, width min(column, Nvh) so
      // it reads as a peer to whatever else is in the column, without
      // ballooning past a shorter neighbour on a wide window. The width is
      // driven by `min()`, not a height cap, because `aspect-square` only
      // derives the dimension left auto — pin width to 100% and cap height
      // instead, and the two stop matching the moment the column gets wide:
      // the box would render its full column width but a clipped height,
      // which is a stretched picture, not a smaller square. `maxHeightVh` is
      // a runtime value (`BattleColumn` passes its own), so this is an
      // inline `min()` rather than a Tailwind arbitrary-value class — a
      // template-literal class string never matches Tailwind's static
      // scanner and would silently produce no rule at all. A caller that
      // still wants the old strip passes `height` and gets it, full width,
      // exactly as before.
      className={
        height
          ? 'relative w-full overflow-hidden rounded border border-border'
          : shape === 'landscape'
            ? 'relative mx-auto aspect-[4/3] overflow-hidden rounded border border-border'
            : 'relative mx-auto aspect-square overflow-hidden rounded border border-border'
      }
      style={height ? { height } : { width: shape === 'landscape' ? `min(100%, ${maxHeightVh * 4 / 3}vh)` : `min(100%, ${maxHeightVh}vh)` }}
    >
      {/* A named, fixed base layer: the combat radar is tactical ink on this
          picture, never a sibling panel that can replace it with a flat
          background. Explicit z-order makes that survive future radar CSS
          changes instead of depending on incidental DOM paint order. */}
      <div className="absolute inset-0 z-0" aria-label="Room art">
        <RoomBackdrop zone={zone} room={room} title={title} text={text} />
      </div>

      {overlay && <div className="absolute inset-0 z-10" aria-label="Tactical radar over room art">{overlay}</div>}

      {title && (
        <div className="absolute inset-x-0 top-0 z-20 bg-surface/80 px-2 py-1 text-xs text-ink backdrop-blur-sm">
          <span className="truncate">{title}</span>
        </div>
      )}

      {/* Who's here, on the felt rather than in a list beside it — the
          bottom edge, since the title moved to the top to make room. */}
      {chips && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6">
          {chips}
        </div>
      )}
    </div>
  )
}
