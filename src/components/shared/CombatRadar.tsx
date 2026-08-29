import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDragScroll } from '../../lib/useDragScroll'
import { ChevronUp, User } from 'lucide-react'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from './CreatureArt'
import { Portrait } from './Portrait'
import { Paperdoll } from './Paperdoll'
import { playerArtFor, notePlayerArtMissing } from '../../lib/playerArt'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { RoomBackdrop } from '../room/RoomBackdrop'
import { DECK_STYLE, type Deck } from '../../lib/cards'
import type { RoomCombatant } from '../../types'
import type { RoomCard } from '../../lib/cards'
import type { BodyPart, Injury } from '../../lib/body'

/**
 * The room, with everyone and everything in it drawn where they actually
 * are — or, for the people and things `assess` says nothing about, honestly
 * placed as "somewhere in this room, not currently advancing on you" rather
 * than left off the picture or shunted into a list beside it.
 *
 * Three tiers of honesty about position, and they look different on purpose:
 *
 *   - **The compass** — hostiles `assess` gave a real range and relation
 *     for: actively fighting, advancing, in range right now. Radius is the
 *     range word, angle is the relation word. This is the only place this
 *     component claims to know exactly where something is. Melee gets the
 *     most room of the three rings, on purpose: most mobs spend most of a
 *     fight at melee range, and flanking — several attackers sharing that
 *     same ring — is the normal case there, not the exception. Pole and
 *     missile are rarer and get correspondingly less.
 *   - **The four corners** — everyone and everything else embedded gets a
 *     puck for, grouped by what they are rather than scattered around a
 *     ring: mobs (hostile, not currently advancing — unassessed,
 *     disengaged, hidden) top-left, PCs (people) top-right, NPCs (allied)
 *     bottom-left, floor items bottom-right. Corners because a circle
 *     inscribed in a square board leaves its four corners empty regardless
 *     of how big the circle is — real, otherwise-wasted space, not a
 *     region carved out of the compass. A puck lands there only because
 *     assess has nothing positional to say about it, not because it is
 *     literally standing in that corner of the room. Each corner is a real
 *     rectangle that scrolls its own contents (`CornerPane`) — a room with
 *     a hundred mobs in it does not lose ninety of them to a cap folded
 *     into one puck's tooltip, it scrolls, the same as any other long list
 *     in this app.
 *   - **The compass rings themselves** — melee wide, pole and missile
 *     progressively tighter, so the four corners keep real room without the
 *     compass losing the one ring that actually gets crowded.
 *
 * DR's own combat readout is two facts about each opponent, not one: range
 * ("at melee range", "at pole weapon range", "at missile range") and
 * position ("in front of you", "behind you", "flanking", "beside you", "to
 * the left/right of you"). The compass draws that same map instead of
 * inventing a different one, using the game's own words throughout — "pole
 * weapon", not "polearm"; "missile", not "ranged".
 *
 * The backdrop is the room itself — `RoomBackdrop`, the same fingerprint or
 * real render `RoomScene` draws for this exact room, not a flat panel of its
 * own. A radar that looks like a different screen than the picture above it
 * reads as a second, unrelated feature; one that looks like the same room
 * with rings drawn over it reads as what it is, the same room, mid-fight.
 * A scrim sits between the two so the rings and pucks stay legible over
 * whatever the room happens to look like.
 *
 * Nothing on the board is ever an always-visible label — a puck (portrait,
 * submitted player picture, item icon, or a coloured dot when none exists)
 * plus a tooltip carrying the full sentence, everywhere. Text has a 12px
 * floor in this app (DESIGN.md, enforced by tools/contrast-test.mjs), a
 * floor that does not move for a small screen, so a board crowded with
 * names was always going to run out of room before the text ran out of
 * length. Pucks don't have that problem: a marker shrinks, a tooltip does
 * not, and nothing shown here is ever more than a tap or a hover away from
 * its full detail — including what a hostile's own bestiary entry says
 * about it (level, HP range, size, whether it casts or hides) and whatever
 * `assess` currently says is wrong with it (stunned, off balance, cursed),
 * the closest thing this app has to "wounds" for something that is not
 * you.
 *
 * Every puck is also a button. A hostile attacks on click, an item picks
 * itself up — the tooltip exists for the player who forgot what's under a
 * given icon, not as the only way to act on it.
 */

/** Same threshold as this board has always used — assess data past a
 * minute old is shown softened rather than at full confidence. */
const STALE_AFTER_SECONDS = 60

/** Below this measured width, pucks shrink too, so a marker never claims
 * more of a tiny board than the gap between two of them can afford.
 * Nothing on this board ever prints an always-visible name, so this is the
 * only responsive threshold left: marker size, not label visibility. */
const COMPACT_MIN_PX = 160

/**
 * Melee wide, pole and missile progressively tighter — see the module doc
 * comment for why. Shrunk so the four corner panes (see CORNERS below) have
 * real room: a corner pane is a real rectangle now, not a handful of points
 * diagonally spaced from the edge, and it needs enough of the board's own
 * width to hold more than one column of the bigger pucks below.
 *
 * A floor, not the final answer — see `rangeRadiusPct` below. The board can
 * genuinely hold four cardinal positions at once (front/behind/left/right),
 * and once pucks doubled in size, a fixed 12% melee radius put those four
 * points close enough together that they physically overlapped regardless
 * of anything the same-angle jitter below could do about it, because that
 * jitter only ever separates entries sharing one angle — it has nothing to
 * say about two different angles crowding each other on too small a ring.
 */
const RANGE_RADIUS_FLOOR_PCT: Record<'melee' | 'pole' | 'missile', number> = {
  melee: 12,
  pole: 16,
  missile: 20,
}

/** How much further out pole and missile sit than melee, once melee's own
 * radius is computed — kept as a fixed gap rather than its own floor, so a
 * melee ring forced wider to fit its pucks still reads as "the same three
 * rings, further apart" instead of three radii drifting independently. */
const RANGE_DELTA_PCT: Record<'pole' | 'missile', number> = { pole: 4, missile: 8 }

/**
 * The actual radius to draw each range ring at — the fixed floor above,
 * widened just enough that four pucks at the compass's four cardinal
 * positions (0/90/180/270, the only angles `angleFor` ever returns) can sit
 * on the melee ring at once without their circles overlapping. Solved from
 * the real chord distance between two points 90° apart on the ring, not the
 * arc between them (see the inline comment below for why that distinction
 * mattered), then compared against the floor and the larger one wins.
 * Unmeasured (`boardWidth` is 0 on the very first render, before the
 * ResizeObserver fires) falls back to the floor outright, same as
 * everything else keyed off `compact`.
 */
function rangeRadiusPct(boardWidth: number, portraitPx: number): Record<'melee' | 'pole' | 'missile', number> {
  if (boardWidth <= 0) return { ...RANGE_RADIUS_FLOOR_PCT }
  const CARDINAL_SLOTS = 4
  const BREATHING_ROOM = 1.5
  // The straight-line distance between two of the four cardinal points is
  // the chord `2R·sin(Ϭ/N)`, not the arc between them — a first pass here
  // used circumference/N instead, which measures distance *around* the
  // ring rather than *across* it and quietly asked for a smaller radius
  // than four 90°-apart circles actually need. Solved for R instead of
  // guessed at:  R = (diameter · breathing room) / (2·sin(Ϭ/N)).
  const neededRadiusPx = (portraitPx * BREATHING_ROOM) / (2 * Math.sin(Math.PI / CARDINAL_SLOTS))
  const neededRadiusPct = (neededRadiusPx / boardWidth) * 100
  const melee = Math.max(RANGE_RADIUS_FLOOR_PCT.melee, neededRadiusPct)
  return {
    melee,
    pole: Math.max(RANGE_RADIUS_FLOOR_PCT.pole, melee + RANGE_DELTA_PCT.pole),
    missile: Math.max(RANGE_RADIUS_FLOOR_PCT.missile, melee + RANGE_DELTA_PCT.pole + RANGE_DELTA_PCT.missile),
  }
}

/**
 * assess's own relation phrases, mapped to a compass angle (0 = in front of
 * you, clockwise). DR does not disambiguate which side "beside"/"flanking"/
 * "next to" put someone on, so those alternate deterministically by id
 * rather than always defaulting to the same side — real assess output would
 * show them scattered too, this just cannot know which side without asking.
 */
function angleFor(relation: string, id: string): number {
  const r = relation.toLowerCase()
  if (r.includes('behind')) return 180
  if (r.includes('left')) return 270
  if (r.includes('right')) return 90
  if (r.includes('front') || r.includes('facing') || r.includes('advancing')) return 0
  const hash = Array.from(id).reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0)
  return hash % 2 === 0 ? 90 : 270
}

/**
 * Where the compass is centered when embedded, off the board's own middle
 * toward the hostile side — the mobs corner and the compass are both about
 * the same thing, "what's dangerous and where," so putting them near each
 * other reads as one cluster rather than two unrelated features sharing a
 * board. Shifted left rather than centered leaves a real contiguous block
 * on the right for the two friendly corners (PCs, NPCs) to stack in
 * instead of splitting across opposite corners the way a centered compass
 * forced them to. Standalone (`embedded` false, `BattlePanel`'s own card)
 * has no corners to make room for, so it stays centered — see the
 * `compassCenter` call site.
 */
const COMPASS_CENTER_EMBEDDED = { x: 38, y: 50 }
const COMPASS_CENTER_STANDALONE = { x: 50, y: 50 }

function compassCenter(embedded: boolean) {
  return embedded ? COMPASS_CENTER_EMBEDDED : COMPASS_CENTER_STANDALONE
}

/** A point on the unit circle around the compass's own center, in this
 * board's own convention: 0° is straight up ("front"), clockwise. */
function pointOn(cx: number, cy: number, angleDeg: number, radiusPct: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + radiusPct * Math.cos(rad), y: cy + radiusPct * Math.sin(rad) }
}

/**
 * Pinned keys move to the front, in the order they were pinned — the most
 * recently promoted lands first, same as bringing a card to the top of a
 * hand. Everything else keeps the order it already had. A room with six
 * hundred mobs in a scrolling pane is unusable if the one you actually care
 * about can only be found by scrolling to wherever the game happened to
 * list it; this is the whole reason a corner is clickable at all.
 */
function reorderByPin<T>(entries: T[], keyOf: (t: T) => string, pins: string[]): T[] {
  if (pins.length === 0) return entries
  const byKey = new Map(entries.map((e) => [keyOf(e), e] as const))
  const front: T[] = []
  for (const k of pins) {
    const e = byKey.get(k)
    if (e) {
      front.push(e)
      byKey.delete(k)
    }
  }
  return [...front, ...entries.filter((e) => byKey.has(keyOf(e)))]
}

interface Positioned {
  key: string
  card: RoomCard
  combatant: RoomCombatant
  angleDeg: number
  radiusPct: number
}

/** Everyone the compass has no position for, drawn in a corner instead:
 * mobs not currently advancing, allied, and people. */
interface CornerEntry {
  key: string
  card: RoomCard
  combatant?: RoomCombatant
}

/**
 * Where each of the four corners lives — a real rectangle now, not a
 * handful of individually-placed points. A circle inscribed in a square
 * leaves its corners empty at any radius, so this is real space, not space
 * carved out of the compass — see the module doc comment. Each pane scrolls
 * its own contents (`overflow-y-auto`), so a corner is never capped at
 * however many pucks happen to fit before the next one overlaps: a room can
 * genuinely hold a hundred mobs, and the pane holds all of them, in a
 * wrapping grid the player scrolls the same way they scroll anything else
 * in this app.
 */
const CORNER_BOX_PCT = 34
const CORNER_MARGIN_PCT = 2

interface CornerBox {
  top?: number
  bottom?: number
  left?: number
  right?: number
  label: string
  presence: string
}

// Mobs stays on the left, near the (now off-center) compass — the same
// "what's dangerous" cluster. PCs and NPCs both stack on the right instead
// of splitting across opposite corners: two friendly panes sharing one
// side reads as "the people" in a way one top-right and one bottom-left
// never did.
const CORNERS: Record<Deck, CornerBox> = {
  hostile: { top: CORNER_MARGIN_PCT, left: CORNER_MARGIN_PCT, label: 'Mobs', presence: 'unassessed' },
  people: { top: CORNER_MARGIN_PCT, right: CORNER_MARGIN_PCT, label: 'PCs', presence: 'here' },
  allied: { bottom: CORNER_MARGIN_PCT, right: CORNER_MARGIN_PCT, label: 'NPCs', presence: 'allied' },
}

/** One scrollable corner pane — the container every corner and the floor
 * render their pucks into. A plain wrapping flexbox inside a fixed,
 * absolutely-positioned rectangle: position is set once by the box, content
 * flows and scrolls independently of it. Grab-and-drag (see useDragScroll)
 * over a visible scrollbar — the pane sits over a picture, where a
 * permanently-visible scrollbar track reads as chrome on top of the room. */
function CornerPane({ box, children }: { box: CornerBox; children: ReactNode }) {
  const drag = useDragScroll()
  return (
    <div
      ref={drag.ref}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      className="no-scrollbar absolute cursor-grab overflow-x-hidden overflow-y-auto touch-none active:cursor-grabbing"
      aria-label={box.label}
      style={{
        top: box.top != null ? `${box.top}%` : undefined,
        bottom: box.bottom != null ? `${box.bottom}%` : undefined,
        left: box.left != null ? `${box.left}%` : undefined,
        right: box.right != null ? `${box.right}%` : undefined,
        width: `${CORNER_BOX_PCT}%`,
        height: `${CORNER_BOX_PCT}%`,
      }}
    >
      <div className="flex flex-wrap content-start gap-1.5 p-1">{children}</div>
    </div>
  )
}

/**
 * Measures its own rendered width and reports it — the board shrinking
 * inside a resizable pane or a genuinely small screen are the same event
 * to this hook, neither is a media query.
 */
function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/**
 * A submitted player portrait, sized and framed the same as `CreatureArt`'s
 * own image branch — so a board mixing a hostile with bestiary art and a
 * person with their own submitted picture reads as one consistent set of
 * pucks, not two different rendering styles stitched together. Kept
 * separate from `CreatureArt` itself rather than teaching it a second
 * source, because `CreatureArt`'s whole job is "what does the bestiary say
 * this noun looks like" — a player's own picture is not a bestiary answer
 * and must never be reachable through a creature-noun lookup by accident.
 */
function PlayerPortrait({
  name,
  url,
  height,
  className,
  focus = 'center',
}: {
  name: string
  url: string
  height: number
  className?: string
  /** Same meaning as `CreatureArt`'s own `focus` — see its doc comment. */
  focus?: 'center' | 'top'
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    // The shape (circle on the compass, rectangle in a corner) lives
    // entirely in the caller-supplied className now — this frame no longer
    // hardcodes `rounded-full` of its own. Both classes present at once
    // used to fight over the same CSS property with no reliable winner,
    // since Tailwind's generated stylesheet order (not the order classes
    // appear in this string) decides which wins.
    <div className={`relative w-full overflow-hidden bg-surface-overlay ${className ?? ''}`} style={{ height }}>
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className={`h-full w-full object-cover ${focus === 'top' ? 'object-top' : ''}`}
        onError={() => {
          notePlayerArtMissing(name)
          setFailed(true)
        }}
      />
    </div>
  )
}

/**
 * Everything this app currently knows about one entry, in one sentence —
 * the tooltip's whole content. `assess`'s own combat detail first (the
 * closest thing to "wounds" this app has for anything that is not you:
 * stunned, off balance, cursed, hidden are the afflictions the game
 * actually reports on someone else), then the bestiary's static facts
 * (level, HP range, size, attack range, whether it casts or hides, what it
 * carries) for whatever has a lore entry at all. Nothing here is invented:
 * a field that is null or absent just does not appear, rather than being
 * guessed at or padded with a placeholder.
 */
function detailFor(card: RoomCard, combatant: RoomCombatant | undefined, presence: string): string {
  const bits: string[] = []

  if (card.status === 'dead') bits.push('dead')
  if (card.status === 'stunned') bits.push('stunned')

  if (combatant) {
    if (combatant.relation) bits.push(combatant.relation)
    if (combatant.range) bits.push(`${RANGE_WORD[combatant.range]} range`)
    if (combatant.target) bits.push(`targeting ${combatant.target}`)
    if (combatant.offBalance) bits.push('off balance')
    else if (combatant.balance) bits.push(`balance: ${combatant.balance}`)
    if (combatant.conditions.length) bits.push(combatant.conditions.join(', '))
    if (combatant.statuses.length) bits.push(combatant.statuses.join(', '))
    if (combatant.enrichedAgeSeconds != null && combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS) {
      bits.push(`assessed ${combatant.enrichedAgeSeconds}s ago`)
    }
  } else if (presence && card.status !== 'dead') {
    // "Unassessed" answers "is anyone tracking this fight" — a question a
    // corpse has already answered by being dead. Saying both is not wrong,
    // just redundant every single time, since a dead card never has a
    // combatant to report either way.
    bits.push(presence)
  }

  if (card.lore) {
    const l = card.lore
    if (l.level != null) bits.push(`level ${l.level}`)
    if (l.minCap != null || l.maxCap != null) {
      bits.push(
        l.minCap != null && l.maxCap != null
          ? `${l.minCap}-${l.maxCap} HP`
          : `up to ${l.minCap ?? l.maxCap} HP`
      )
    }
    const shape = [l.bodySize, l.bodyType].filter(Boolean).join(' ').toLowerCase()
    if (shape) bits.push(shape)
    if (l.attackRange) bits.push(`attacks at ${l.attackRange}`)
    if (l.castsSpells) bits.push('casts spells')
    if (l.stealthy) bits.push('stealthy')
    const loot = [l.hasCoins && 'coins', l.hasGems && 'gems', l.hasBoxes && 'boxes', l.skinnable && 'skinnable']
      .filter(Boolean)
      .join(', ')
    if (loot) bits.push(loot)
    if (card.loreApproximate) bits.push('bestiary match approximate')
  }

  return bits.join(' — ')
}

/**
 * A hover/focus popover anchored to whatever it wraps, escaping the corner
 * pane's own `overflow-y-auto` clip via `position: fixed` computed from the
 * trigger's real screen position rather than CSS positioning relative to an
 * ancestor — a tooltip that inherited the pane's own clipping would get cut
 * off at the pane's edge exactly when a puck near that edge needed it most.
 * `display: contents` on the wrapper keeps it invisible to the corner's own
 * flex-wrap layout, so wrapping a puck in this never changes where it sits
 * in the grid.
 */
/** Below this much clearance above the anchor, the card has nowhere to
 * fit if it opens upward — an estimate, not a measurement, because the
 * card hasn't rendered yet at the moment this decision has to be made. */
const HOVER_CARD_MIN_CLEARANCE_PX = 260

function HoverCard({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)

  const show = () => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (r) {
      // Opens upward by default (the usual case: a puck low enough on the
      // board that there's room above it). Not enough clearance above —
      // the Mobs corner sits at the board's own top edge, which in this
      // app's layout is close to the window's top edge too — and it opens
      // downward instead, or it renders with a negative `top` and sits
      // entirely off-screen, invisible, which is exactly what shipped
      // before this was measured against the real page rather than assumed
      // to always have room above.
      const flip = r.top < HOVER_CARD_MIN_CLEARANCE_PX
      setPos({ top: flip ? r.bottom + 8 : r.top - 8, left: r.left + r.width / 2, flip })
    }
    setOpen(true)
  }
  const hide = () => setOpen(false)

  return (
    // A plain span, not `display: contents` — a contents element generates
    // no box of its own, so `getBoundingClientRect()` on it returns an
    // empty rect and every card opened pinned to the corner of the screen
    // instead of the puck it was describing. A flex item is blockified
    // regardless of its own declared display, so a bare span here still
    // behaves correctly as one of CornerPane's flex-wrap children — it
    // just also, usefully, now has a real position to report.
    <span
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && pos && (
        <div
          role="tooltip"
          className={`pointer-events-none fixed z-50 w-64 -translate-x-1/2 rounded border border-border bg-surface-overlay p-2 shadow-xl ${pos.flip ? '' : '-translate-y-full'}`}
          style={{ top: pos.top, left: Math.min(Math.max(pos.left, 132), window.innerWidth - 132) }}
        >
          {content}
        </div>
      )}
    </span>
  )
}

/** One labelled row in an InfoCard's fact list — `dt`/`dd` so the pair
 * reads correctly to a screen reader as a term and its value, not just two
 * unrelated lines of text. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </>
  )
}

/**
 * The rich version of `detailFor` — the same two sources (live `assess`
 * detail, then the bestiary's own static facts) laid out as labelled rows
 * under their own headings instead of run together into one sentence. The
 * plain sentence still exists (`detailFor`, used for the `aria-label` this
 * card's trigger carries) because a screen reader gets one linear read
 * either way; this is the version for a sighted hover.
 *
 * The bestiary facts here are exactly what `data/bestiary.json` already
 * ships (scraped from Elanthipedia once, at build time — see
 * `tools/bestiary-index.mjs`), not a live re-scrape: this app has no route
 * to fetch a wiki page at runtime, and a card mid-fight is the wrong place
 * to first attempt one. A genuinely live pipeline — folding what a
 * character's own `assess`/`diagnose` output reveals turn to turn back into
 * this same static index, so an approximate match sharpens the more this
 * particular creature gets fought — is a real, separate feature and not
 * this one; nothing here pretends to do that yet.
 */
function InfoCard({
  card,
  combatant,
  presence,
}: {
  card: RoomCard
  combatant?: RoomCombatant
  presence: string
}) {
  const lore = card.lore
  const stale =
    combatant?.enrichedAgeSeconds != null && combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex items-start gap-2">
        <div className="shrink-0">
          <Puck card={card} px={44} ringClass="border-surface" shape="rect" />
        </div>
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-semibold leading-tight text-ink">{card.name}</p>
          {card.status === 'dead' && <p className="text-danger">dead</p>}
          {card.status === 'stunned' && <p className="text-warn">stunned</p>}
        </div>
      </div>

      {combatant ? (
        <div className="border-t border-border/60 pt-1.5">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Right now{stale ? ` (${combatant.enrichedAgeSeconds}s ago)` : ''}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {combatant.relation && <Fact label="Position" value={combatant.relation} />}
            {combatant.range && <Fact label="Range" value={RANGE_WORD[combatant.range]} />}
            {combatant.target && <Fact label="Targeting" value={combatant.target} />}
            {(combatant.balance || combatant.offBalance) && (
              <Fact label="Balance" value={combatant.offBalance ? 'off balance' : combatant.balance} />
            )}
            {combatant.conditions.length > 0 && <Fact label="Conditions" value={combatant.conditions.join(', ')} />}
            {combatant.statuses.length > 0 && <Fact label="Status" value={combatant.statuses.join(', ')} />}
          </dl>
        </div>
      ) : (
        presence &&
        card.status !== 'dead' && <p className="border-t border-border/60 pt-1.5 text-ink-faint">{presence}</p>
      )}

      {lore && (
        <div className="border-t border-border/60 pt-1.5">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Bestiary{card.loreApproximate ? ' — approximate match' : ''}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {lore.level != null && <Fact label="Level" value={lore.level} />}
            {(lore.minCap != null || lore.maxCap != null) && (
              <Fact
                label="HP"
                value={
                  lore.minCap != null && lore.maxCap != null
                    ? `${lore.minCap}-${lore.maxCap}`
                    : `up to ${lore.minCap ?? lore.maxCap}`
                }
              />
            )}
            {(lore.bodySize || lore.bodyType) && (
              <Fact label="Body" value={[lore.bodySize, lore.bodyType].filter(Boolean).join(' ').toLowerCase()} />
            )}
            {lore.attackRange && <Fact label="Attacks at" value={lore.attackRange} />}
            {lore.castsSpells && <Fact label="Casts" value="spells" />}
            {lore.stealthy && <Fact label="Stealthy" value="yes" />}
            {(lore.hasCoins || lore.hasGems || lore.hasBoxes || lore.skinnable) && (
              <Fact
                label="Carries"
                value={[lore.hasCoins && 'coins', lore.hasGems && 'gems', lore.hasBoxes && 'boxes', lore.skinnable && 'skinnable']
                  .filter(Boolean)
                  .join(', ')}
              />
            )}
          </dl>
        </div>
      )}
    </div>
  )
}

/**
 * A puck reads as a small physical token sitting on the board rather than a
 * flat icon printed on it — a soft shadow beneath, a highlight along the
 * top edge, a shade along the bottom, the way light actually falls on a
 * round chip. box-shadow rather than a drop-shadow filter: it costs nothing
 * extra to composite, and the two inset shadows are what make the token
 * itself read as domed rather than just floating.
 */
const PUCK_SHADOW =
  '0 3px 6px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.4), inset 0 2px 3px rgba(255,255,255,0.25), inset 0 -3px 4px rgba(0,0,0,0.35)'

/** How much taller than wide a `shape="rect"` puck draws — a portrait
 * aspect, not a square crop of one. Chosen to read as "a small picture of
 * the creature" rather than "a small circle with a creature-shaped smear
 * in it": most of a creature's silhouette (the bestiary's own art crops)
 * reads better tall than wide. */
const PORTRAIT_ASPECT = 1.3

/** One puck: a real portrait when the bestiary has one, a submitted player
 * picture when the bestiary doesn't but the person does, otherwise
 * `CreatureArt`'s own fallback chain — a body-shape silhouette from the
 * bestiary's own size/shape fields, or failing that an initial letter.
 * Never a flat coloured dot for a creature: this board draws the same three
 * tiers a card in the dashboard's own decks already draws, so a goblin
 * looks like the same goblin everywhere it can appear in this app, art pack
 * installed or not. Shared by the compass and the four corners for exactly
 * that reason.
 *
 * `shape` picks how the frame is cropped: `circle` (the compass's own
 * pucks, and the default) fills a square and clips it to a disc; `rect`
 * (the four corners) keeps the art's own portrait aspect uncropped instead
 * — a full picture rather than a coin with a fragment of one stamped into
 * it, since a corner has the width to spare and a hover card right next to
 * it to carry the rest of the detail regardless. */
function Puck({
  card,
  px,
  ringClass,
  pulse,
  shape = 'circle',
}: {
  card: RoomCard
  px: number
  ringClass: string
  pulse?: boolean
  shape?: 'circle' | 'rect'
}) {
  const height = shape === 'rect' ? Math.round(px * PORTRAIT_ASPECT) : px
  const frameClass = shape === 'rect' ? 'rounded-md' : 'rounded-full'
  const frameRadius = shape === 'rect' ? '10px' : '9999px'

  // A person's own submitted picture, checked only for the people deck and
  // only before falling back to the bestiary lookup — a hostile or an
  // allied summon is never a candidate for this, so there is no path by
  // which a creature could borrow a player's art or a player's name could
  // accidentally resolve to bestiary art.
  const own = card.deck === 'people' ? playerArtFor(card.name) : undefined

  if (own) {
    return (
      <div style={{ width: px, boxShadow: PUCK_SHADOW, borderRadius: frameRadius }}>
        {/* A person, not a creature — the part of the picture that tells
            the story is the face, not whatever a center crop happens to
            keep. Biased to the top regardless of shape: even the small
            circular compass token is a face crop, not a chest crop. */}
        <PlayerPortrait
          name={own.name}
          url={own.url}
          height={height}
          className={`border ${ringClass} ${frameClass}`}
          focus="top"
        />
      </div>
    )
  }

  // People without a submitted picture are the one case with no bestiary
  // answer to fall back to — a person is not a creature, so CreatureArt's
  // silhouette-by-body-type has nothing to draw. Framed the same as every
  // other fallback on this board though (same shape, same shadow, an
  // initial letter the way CreatureArt's own letter tier reads) rather
  // than a visually distinct dot — a PC and a mob without art should read
  // as the same *kind* of placeholder, not two different systems.
  if (card.deck === 'people') {
    const style = DECK_STYLE[card.deck]
    const height = shape === 'rect' ? Math.round(px * PORTRAIT_ASPECT) : px
    return (
      <div
        className={`flex items-center justify-center border ${ringClass} ${frameClass} ${pulse ? 'animate-pulse' : ''}`}
        style={{
          width: px,
          height,
          background: `var(--color-${style.band.replace('bg-', '')})`,
          boxShadow: PUCK_SHADOW,
        }}
      >
        <span className="text-lg font-semibold leading-none text-ink" aria-hidden="true">
          {card.name.charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  // Hostile and allied: CreatureArt already knows how to draw all three
  // tiers (real photo, then a body-shape silhouette from lore, then a bare
  // initial) — asking it directly, rather than gating on whether an exact
  // art file exists first, is what actually surfaces that fallback chain
  // here instead of skipping straight past it to a dot.
  return (
    <div
      className={pulse ? 'animate-pulse' : ''}
      style={{ width: px, boxShadow: PUCK_SHADOW, borderRadius: frameRadius }}
    >
      <CreatureArt
        name={card.name}
        noun={card.noun}
        lore={card.lore}
        height={height}
        className={`${frameClass} border ${ringClass}`}
        // Always, not just in the tall rectangle — a center crop on even a
        // small circular compass token still cuts off the face on some
        // bestiary renders, the ones where the art itself isn't centered
        // on its own subject. The token is what a player is actually
        // looking at mid-fight; getting the face wrong there matters more
        // than it does in a corner's hover-and-check card.
        focus="top"
      />
    </div>
  )
}

export function CombatRadar({
  zone,
  room,
  title,
  text,
  cards,
  combatants,
  you,
  embedded = false,
}: {
  /** Which room's backdrop to draw — same identity `RoomScene` keys its own
   * fingerprint by.
   *
   * Optional, because the backdrop is an enhancement and the radar is not.
   * `BattleColumn` has a room identity to hand (it derives zone from the
   * live zone payload and fetches the room text), and `BattlePanel` does
   * not — making these required broke that call site, and the alternative
   * was duplicating BattleColumn's fetch into a panel that has no business
   * doing it. A caller with no room identity gets the radar without a
   * backdrop, which is what it drew before there was one. Ignored entirely
   * when `embedded` is true — see that prop. */
  zone?: string
  room?: number | null
  title?: string | null
  text?: string | null
  /** Everyone in the room, every deck — hostile for the compass and the
   * mobs corner, all three for their corners when `embedded`. `BattlePanel`
   * (standalone) still passes hostile only; it keeps its own allied/people
   * decks below the radar rather than adopting the corners, so handing it
   * more decks would just show them twice. */
  cards: RoomCard[]
  combatants: RoomCombatant[]
  /**
   * You — the one fixed point everything else on the compass is drawn
   * relative to, same as `assess` itself. Optional, and only ever passed
   * embedded: `BattleColumn` has a character to hand, `BattlePanel`'s
   * standalone card already shows a paperdoll and vitals of its own above
   * this component, so handing it a second copy would just show them
   * twice — same reasoning as `zone`/`room`. Absent, the center falls back
   * to the plain accent-ringed icon this board has always drawn there.
   */
  you?: {
    character: string
    race?: string | null
    injuries: Partial<Record<BodyPart, Injury>>
    injuriesKnown: boolean
  }
  /**
   * True when `RoomScene` is passing this in as its own `overlay` — the room
   * picture is already right there, one layer down in the same box, so
   * drawing a second copy of it (this component's own circular backdrop,
   * scaled to a smaller circle inside a square box that already has the
   * full-size original) would put the same room on screen twice at once.
   * Embedded mode skips its own backdrop and the circular frame and fills
   * whatever box it was handed instead, rings and pucks only. It also turns
   * on the four corners — see the module doc comment.
   */
  embedded?: boolean
}) {
  const index = indexCombatants(combatants)
  const { run: runMacro, canSend: canAttack, reason: attackReason } = useMacroRunner()
  const { ref: boardRef, width: boardWidth } = useMeasuredWidth()
  const compact = boardWidth > 0 && boardWidth < COMPACT_MIN_PX
  const { x: compassCx, y: compassCy } = compassCenter(embedded)

  // Doubled — a corner is a real scrollable pane now (see CornerPane), not
  // a fixed handful of points squeezed into the board's own corner, so
  // there is no longer a ceiling on puck size fighting a ceiling on how
  // many can fit without overlapping.
  const portraitPx = compact ? 60 : 84
  const cornerPx = compact ? 52 : 72
  // Mobs read as the biggest thing in a corner on purpose — they're the
  // reason a player is looking at this board at all. PCs and NPCs share
  // the same frame and fallback chain (see Puck) so they read as the same
  // *kind* of card, just not the loudest one on the board.
  const hostileCornerPx = compact ? 68 : 94

  // The compass doesn't get that deal. A corner can always add another row
  // and scroll; the compass has nowhere to put an oversized puck but
  // outside the disc. Sized as a fraction of the board's own measured
  // width instead of the same compact/full toggle everything else uses, so
  // it shrinks continuously as the board narrows rather than snapping
  // between two fixed sizes with a dead zone between them — the exact gap
  // that let a 241px-wide board keep using 84px pucks and force the melee
  // ring out past a third of the board's own radius to fit them.
  //
  // Halved again on top of that — the corner cards read as the right size
  // once they went rectangular; the round compass tokens, sitting over a
  // busy room picture rather than a scrollable pane of their own, read
  // better smaller still.
  const COMPASS_PUCK_FRACTION = 0.09
  const COMPASS_PUCK_FLOOR_PX = 14
  const compassPortraitPx =
    boardWidth > 0
      ? Math.min(portraitPx / 2, Math.max(COMPASS_PUCK_FLOOR_PX, boardWidth * COMPASS_PUCK_FRACTION))
      : portraitPx / 2

  const RANGE_RADIUS_PCT = rangeRadiusPct(boardWidth, compassPortraitPx)

  const positioned: Positioned[] = []
  const cornerHostiles: CornerEntry[] = []

  for (const card of cards) {
    if (card.deck !== 'hostile') continue
    // A corpse never gets a compass position — nothing about "dead" is
    // "advancing" — but it is still a real thing in the room, worth
    // skinning or looting, so it still gets a puck rather than vanishing
    // from the board the moment it dies. Straight to its corner, dimmed.
    if (card.status === 'dead') {
      cornerHostiles.push({ key: card.id, card })
      continue
    }
    const combatant = combatantFor(card, index)
    if (!combatant) {
      cornerHostiles.push({ key: card.id, card })
      continue
    }
    if (combatant.disengaged || !combatant.range || !combatant.relation) {
      cornerHostiles.push({ key: card.id, card, combatant })
      continue
    }
    // Advancing — a real range and relation, actively fighting. Stays on
    // the compass; this is the one tier that claims to know exactly where
    // something is.
    positioned.push({
      key: card.id,
      card,
      combatant,
      angleDeg: angleFor(combatant.relation, combatant.id),
      radiusPct: RANGE_RADIUS_PCT[combatant.range],
    })
  }

  // Spread anything sharing the exact same angle+range apart, so several
  // creatures all "flanking" at melee range — the normal case, not the
  // exception, per the module doc comment — don't sit on top of each
  // other. A single-axis jitter was sized for the old, much smaller pucks
  // and stopped being enough the moment they doubled: five wild boars all
  // flanking at melee overlapped into one brown smear. This fans a group
  // out into a small grid instead of a line, spaced by the pucks' actual
  // measured pixel size rather than a constant, so it keeps working
  // whether the board is 200px or 800px wide.
  const FAN_COLS = 3
  const GAP_FALLBACK_PCT = 18
  const gapPct = boardWidth > 0 ? Math.max((compassPortraitPx * 1.4 * 100) / boardWidth, 6) : GAP_FALLBACK_PCT

  const groups = new Map<string, Positioned[]>()
  for (const p of positioned) {
    const k = `${p.angleDeg}:${p.radiusPct}`
    const g = groups.get(k)
    if (g) g.push(p)
    else groups.set(k, [p])
  }
  const spread: (Positioned & { x: number; y: number })[] = []
  for (const group of groups.values()) {
    const n = group.length
    const cols = Math.min(n, FAN_COLS)
    const rows = Math.ceil(n / cols)
    group.forEach((p, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const dx = n > 1 ? (col - (cols - 1) / 2) * gapPct : 0
      const dy = n > 1 ? (row - (rows - 1) / 2) * gapPct : 0
      const { x, y } = pointOn(compassCx, compassCy, p.angleDeg, p.radiusPct)
      spread.push({ ...p, x: x + dx, y: y + dy })
    })
  }

  // The three corners: everyone embedded has no compass position for.
  // Standalone keeps its old hostile-only behaviour — see the `embedded`
  // prop's own doc comment for why allied/people never reach here
  // otherwise.
  const rawCornerEntries: Record<Deck, CornerEntry[]> = embedded
    ? {
        hostile: cornerHostiles,
        allied: cards.filter((c) => c.deck === 'allied').map((card) => ({ key: card.id, card })),
        people: cards.filter((c) => c.deck === 'people').map((card) => ({ key: card.id, card })),
      }
    : { hostile: [], allied: [], people: [] }

  // Click anything in a corner and it jumps to the top of its own pane — a
  // scrolling pile of hundreds is only useful if the one you're looking for
  // can be pulled to where you can see it. Pins are per-room UI state, not
  // game state: they reset the moment the character walks into a different
  // room, same as the rest of this component.
  const [pinned, setPinned] = useState<{ hostile: string[]; people: string[]; allied: string[] }>({
    hostile: [],
    people: [],
    allied: [],
  })
  const promote = (bucket: keyof typeof pinned, key: string) =>
    setPinned((prev) => ({ ...prev, [bucket]: [key, ...prev[bucket].filter((k) => k !== key)] }))

  const cornerEntries: Record<Deck, CornerEntry[]> = {
    hostile: reorderByPin(rawCornerEntries.hostile, (e) => e.key, pinned.hostile),
    allied: reorderByPin(rawCornerEntries.allied, (e) => e.key, pinned.allied),
    people: reorderByPin(rawCornerEntries.people, (e) => e.key, pinned.people),
  }

  const hasFight = positioned.length > 0

  const attack = () => runMacro(['attack'])
  const attackTitle = (label: string) =>
    attackReason ?? `${label} — attack (whatever is in front of you right now)`

  const disc = (
    <div
      ref={boardRef}
      className={
        embedded
          ? 'absolute inset-0'
          : 'relative mx-auto aspect-square w-full max-w-[300px] overflow-hidden rounded-full'
      }
    >
      {/* Only when standalone and the caller actually knows which room this
          is. Embedded, `RoomScene` already painted the real backdrop one
          layer down — this box has no background of its own to fill.
          Standalone with no identity (BattlePanel today) gets the plain
          dark disc the radar has always had rather than a wrong or
          placeholder picture. */}
      {!embedded && zone && room != null && (
        <RoomBackdrop zone={zone} room={room} title={title} text={text} />
      )}

      {/* Between the room and the rings. Dark enough that white-on-anything
          pucks and pale range rings hold up over a bright snowfield or a
          washed-out real render alike; a radial vignette rather than a flat
          tint so "you", dead center, sits on the darkest point of the
          picture no matter what the room looks like. */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.7) 100%)',
        }}
        aria-hidden
      />

      {/* A fixed compass grid, independent of who's actually on it — the
          four rings/spokes the compass can ever place a marker on (angleFor
          only ever returns 0/90/180/270), drawn once so the eye has a
          frame of reference even before anything is assessed. Centered on
          the compass's own center (`compassCx`/`compassCy`, see
          `compassCenter`), not necessarily the board's middle. */}
      <div
        className="absolute top-0 h-full w-px bg-border/40"
        style={{ left: `${compassCx}%` }}
        aria-hidden
      />
      <div
        className="absolute left-0 h-px w-full bg-border/40"
        style={{ top: `${compassCy}%` }}
        aria-hidden
      />

      {/* Range rings, in DR's own words, not a generic distance scale — a
          title rather than a spoke label: three concentric circles read as
          "distance" on sight the way a topographic map does, and the word
          is a hover away for whoever wants the game's own term for the one
          they're looking at. Melee is the widest of the three, and can grow
          wider still — see `rangeRadiusPct`'s own comment — to leave room
          for flanking without crowding pole and missile out or eating the
          corners. */}
      {(['missile', 'pole', 'melee'] as const).map((range) => (
        <div
          key={range}
          className="absolute rounded-full border border-border/60"
          title={`${RANGE_WORD[range]} range`}
          style={{
            left: `${compassCx - RANGE_RADIUS_PCT[range]}%`,
            top: `${compassCy - RANGE_RADIUS_PCT[range]}%`,
            width: `${RANGE_RADIUS_PCT[range] * 2}%`,
            height: `${RANGE_RADIUS_PCT[range] * 2}%`,
          }}
        />
      ))}

      {/* Facing marker — "in front of you" is up, matching the compass
          every puck on this board is drawn against. Behind/left/right get
          no icon of their own: three more markers on a compass that only
          ever has one meaningful reference direction is noise, and every
          puck's own tooltip already spells its relation out in words
          ("behind you", "flanking") — the one thing worth a permanent icon
          is which way is forward, since that's what every other position
          is read relative to. */}
      <span
        className="absolute top-0 -translate-x-1/2"
        style={{ left: `${compassCx}%` }}
        title="Front — the direction you're facing. Everything else on this compass is positioned relative to this."
      >
        <ChevronUp className="h-3 w-3 text-ink-faint" aria-hidden />
        <span className="sr-only">Front</span>
      </span>

      {/* You, at the center — the one fixed point everything else on the
          compass is relative to, same as assess itself. `you`, when the
          caller has a character to hand (BattleColumn does; BattlePanel's
          standalone card already shows this above the radar, so it stays
          the plain icon there — see `you`'s own doc comment), draws the
          face and the doll — the two things about "you" that change every
          few seconds in a fight and are worth a glance without looking
          away from the picture. Vitals stay out of this specific card on
          purpose (see BattleColumn's own comment on why); everywhere else
          on this board a creature without a submitted picture gets a
          letter instead of nothing, and you is the one card that was
          always the plain icon regardless. */}
      {you ? (
        // No vitals here — they read fine at 12px in a header strip, not
        // in a card sitting on top of a room picture, and the space they
        // used to take goes to the one thing that actually needed it: the
        // doll itself, big enough now to read at a glance which limb is
        // hurt instead of just that something is.
        <div
          className="absolute z-10 flex items-center gap-1.5 rounded-lg border border-accent/60 bg-surface/90 p-1.5 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${compassCx}%`, top: `${compassCy}%`, boxShadow: PUCK_SHADOW }}
          title="You"
        >
          <Portrait character={you.character} race={you.race ?? undefined} size={compact ? 34 : 44} />
          <Paperdoll injuries={you.injuries} height={compact ? 62 : 82} known={you.injuriesKnown} />
        </div>
      ) : (
        <div
          className="absolute z-10 flex items-center justify-center rounded-full border-2 border-accent bg-surface p-0.5 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${compassCx}%`, top: `${compassCy}%` }}
          title="You"
        >
          <User className="h-3 w-3 text-accent" aria-hidden />
        </div>
      )}

      {/* Advancing hostiles — the compass proper. Everyone else embedded is
          in one of the four corners below instead. Each is its own attack
          button: click to swing at whatever is in front of you (the game
          does not let this app pick a target more specific than that — see
          `attack`'s own note), tooltip for the full read on what you're
          about to hit. */}
      {hasFight
        ? spread.map((p) => {
            const stale =
              p.combatant.enrichedAgeSeconds != null && p.combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS
            const onYou = p.combatant.target?.toLowerCase() === 'you'
            return (
              <button
                key={p.key}
                type="button"
                disabled={!canAttack}
                onClick={attack}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full disabled:cursor-not-allowed ${stale ? 'opacity-60' : ''}`}
                style={{ left: `${p.x}%`, top: `${p.y}%`, width: Math.max(24, compassPortraitPx), height: Math.max(24, compassPortraitPx) }}
                title={`${p.card.name} — ${detailFor(p.card, p.combatant, '')}\n${attackTitle('Attack')}`}
              >
                <Puck card={p.card} px={compassPortraitPx} ringClass={onYou ? 'border-danger' : 'border-surface'} pulse={onYou} />
              </button>
            )
          })
        : !embedded && (
            <p className="absolute left-1/2 top-1/2 w-32 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-ink-faint">
              Nothing assessed yet
            </p>
          )}

      {/* The four corners: mobs not currently advancing, PCs, NPCs, and the
          floor, each in a scrollable pane in the corner a circle inscribed
          in this square board always leaves empty. Every entry gets a
          puck — no cap, no folding the rest into the last one's tooltip;
          a room with a hundred mobs in it scrolls, the same way any other
          long list in this app does. Every puck is also a button: a live
          mob attacks on click, everything else (dead mobs, PCs, NPCs) has
          no game command to send, so its click just promotes it to the top
          of its own pane instead — the same gesture either way, "I want
          this one", it just does different work depending on what there is
          to do.

          Corner pucks are the full rectangular portrait (`shape="rect"`)
          rather than a circular crop — a corner has the width to spare, and
          a small circle of a large creature was mostly cropped-off
          background. Hover or focus opens an `InfoCard`: the same bestiary
          and live-assess detail `detailFor` already carries, laid out under
          headings instead of run into one sentence. `title` still carries
          the flat sentence as an `aria-label` so a screen reader gets the
          same information the hover card gives a sighted player. */}
      {embedded &&
        (Object.keys(CORNERS) as Deck[]).map((deck) => {
          const corner = CORNERS[deck]
          const entries = cornerEntries[deck]
          return (
            <CornerPane key={deck} box={corner}>
              {entries.map((entry) => {
                const detail = detailFor(entry.card, entry.combatant, corner.presence)
                const dead = entry.card.status === 'dead'
                // A corpse is not a target — attacking it is not a command
                // DR has any use for. Still a button, just a pin rather
                // than an attack — same as PCs and NPCs, which never had
                // an attack to send in the first place.
                const attackable = deck === 'hostile' && !dead
                const px = deck === 'hostile' ? hostileCornerPx : cornerPx
                const body = <Puck card={entry.card} px={px} ringClass="border-surface" shape="rect" />
                const onClick = attackable
                  ? () => {
                      attack()
                      promote(deck, entry.key)
                    }
                  : () => promote(deck, entry.key)
                const label = attackable
                  ? `${entry.card.name} — ${detail} — ${attackTitle('Attack')}`
                  : `${entry.card.name} — ${detail} — click to bring to the top`
                return (
                  <HoverCard
                    key={entry.key}
                    content={<InfoCard card={entry.card} combatant={entry.combatant} presence={corner.presence} />}
                  >
                    <button
                      type="button"
                      disabled={attackable && !canAttack}
                      onClick={onClick}
                      aria-label={label}
                      className="flex shrink-0 items-center justify-center disabled:cursor-not-allowed"
                      style={{
                        width: px,
                        height: Math.round(px * PORTRAIT_ASPECT),
                        opacity: dead ? 0.55 : undefined,
                      }}
                    >
                      {body}
                    </button>
                  </HoverCard>
                )
              })}
            </CornerPane>
          )
        })}

    </div>
  )

  if (embedded) return disc

  const notFighting = cornerHostiles.filter((g) => g.combatant)
  const unassessed = cornerHostiles.filter((g) => !g.combatant)

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface-raised p-2">
      {disc}

      {(notFighting.length > 0 || unassessed.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1.5 text-xs">
          {notFighting.map(({ card, combatant }) => (
            <span key={card.id} className="text-ink-faint" title={detailFor(card, combatant, '')}>
              {card.name} <span className="text-ink-faint">(not fighting)</span>
            </span>
          ))}
          {unassessed.map(({ card }) => (
            <span key={card.id} className="text-ink-faint" title="nobody has assessed this one yet">
              {card.name} <span className="text-ink-faint">(unassessed)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
