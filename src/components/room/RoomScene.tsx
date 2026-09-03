import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { RoomBackdrop } from '../../lib/removed2d.tsx'

/**
 * The width, in vh, a scene actually renders at once its own `min(100%, …)`
 * cap is the binding constraint — the same formula `sceneStyle` below uses
 * to size the DOM, exported so a caller outside this file (an outer column
 * allocator deciding how much width is worth handing this scene) can ask
 * this file what its own limit is, rather than re-deriving a second copy of
 * `maxHeightVh * 8/5` and risking the two drifting apart. A square scene has
 * no such cap — its width is bounded by height alone, so no vh-of-width
 * number applies — hence `null`.
 */
export function sceneMaxWidthVh(maxHeightVh: number, shape: 'square' | 'landscape'): number | null {
  return shape === 'landscape' ? maxHeightVh * (8 / 5) : null
}

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
  footer,
  shape = 'square',
  framed = true,
  locationReady = true,
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
  /** Interactive scene content anchored over the bottom of the art. */
  footer?: import('react').ReactNode
  /** False when a parent owns the shared battle frame and header. */
  framed?: boolean
  /** False while room and zone have not yet arrived as one coherent pair. */
  locationReady?: boolean
}) {
  const sceneRef = useRef<HTMLDivElement>(null)
  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const node = sceneRef.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSceneSize((current) => current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // One scale contract for everything painted on the room art. CombatRadar
  // already sizes combatants from both axes; exposing the same measurement at
  // their common parent means the floor overlay, controls, and future scene
  // furniture cannot drift into a collection of unrelated screenshot-tuned
  // pixel sizes. The floor remains bounded so its text never drops below the
  // app's 12px accessibility floor.
  const sceneScale = sceneSize.width > 0 && sceneSize.height > 0
    ? Math.max(0.65, Math.min(1.25, Math.min(sceneSize.width / 900, sceneSize.height / 650)))
    : 1
  const sceneStyle: CSSProperties & { '--radar-scale': number; '--radar-loot-height': string } = {
    ...(height
      ? { height }
      : { width: `min(100%, ${sceneMaxWidthVh(maxHeightVh, shape) ?? maxHeightVh}vh)` }),
    '--radar-scale': sceneScale,
    '--radar-loot-height': footer ? '2.25rem' : '0px',
  }

  return (
    <div
      ref={sceneRef}
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
          ? `relative w-full overflow-hidden ${framed ? 'rounded border border-border' : ''}`
          : shape === 'landscape'
            ? `relative mx-auto aspect-[8/5] overflow-hidden ${framed ? 'rounded border border-border' : ''}`
            : `relative mx-auto aspect-square overflow-hidden ${framed ? 'rounded border border-border' : ''}`
      }
      style={sceneStyle}
    >
      {/* A named, fixed base layer: the combat radar is tactical ink on this
          picture, never a sibling panel that can replace it with a flat
          background. Explicit z-order makes that survive future radar CSS
          changes instead of depending on incidental DOM paint order. */}
      <div className="absolute inset-0 z-0" aria-label="Room art">
        {locationReady ? (
          <RoomBackdrop zone={zone} room={room} title={title} text={text} />
        ) : (
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(124,132,142,0.22),transparent_42%),linear-gradient(155deg,#1d2229,#101318)]"
            role="status"
            aria-label="Waiting for the current map zone"
          />
        )}
      </div>

      {overlay && <div className="absolute inset-0 z-10" aria-label="Tactical radar over room art">{overlay}</div>}

      {footer && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 h-9 overflow-visible border-t border-border/70 bg-surface/82 px-1.5 py-1 backdrop-blur-md">
          {footer}
        </div>
      )}

      {/* Who's here, on the felt rather than in a list beside it — the
          bottom edge, since the title moved to the top to make room. */}
      {chips && !footer && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6">
          {chips}
        </div>
      )}
    </div>
  )
}
