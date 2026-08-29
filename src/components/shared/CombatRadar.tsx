import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDragScroll } from '../../lib/useDragScroll'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from './CreatureArt'
import { Portrait } from './Portrait'
import { Paperdoll, type Pose } from './Paperdoll'
import { Activity, Anchor, Ban, Bug, Droplet, FlaskConical, HeartCrack, HeartPulse, Skull, Zap, type LucideIcon } from 'lucide-react'
import { playerArtFor, notePlayerArtMissing } from '../../lib/playerArt'
import { npcRoleGuessFor, npcDefaultFor } from '../../lib/npcDefaults'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { RoomBackdrop } from '../room/RoomBackdrop'
import { DECK_STYLE, type Deck } from '../../lib/cards'
import type { RoomCombatant } from '../../types'
import type { RoomCard } from '../../lib/cards'
import { SEVERITY_LABEL, type BodyPart, type Injury, type Severity } from '../../lib/body'
import type { Vital } from '../../lib/vitals'

/**
 * The room, with everyone in it — a compass filling the whole board edge to
 * edge, a narrow scrollable roster strip floating over its right side, and
 * you near the middle of the compass where the fight actually is.
 *
 * A prior pass here replaced the compass with two bordered halves — a
 * misreading of "move the battle left, the enemies right" as license to
 * drop the radial geometry entirely. It was wrong: the compass is the board,
 * real assess range and relation mapped to an angle and a radius so a
 * flanking fight actually reads as one. The roster does not carve its own
 * share of that width out of the compass either — it is a single scrollable
 * field (`RosterStrip`), two cards wide, laid *over* the compass's right
 * edge rather than beside it, so the play area itself still reaches all the
 * way to both edges the way the rest of the room picture does. The
 * compass's own visual center shifts left by half the strip's width to
 * compensate — see `centerXPct` — so `you` and anything positioned near the
 * right edge sit clear of the overlay rather than under it. Everyone not
 * currently positioned by a real assess reading — dead, or simply nothing
 * on the wire to place them by — falls to that strip instead of vanishing,
 * same as it always has.
 *
 * Colour lives on each card now, not on a region: a small red ring
 * (`border-danger`) for hostile, blue (`border-info`) for friendly, on the
 * puck itself. A whole side of the board painted one colour said "friendly"
 * and "hostile" about empty background as loudly as it said it about a
 * card; putting the tinge on the token instead says it about the thing
 * that's actually true of, and costs nothing when the board is crowded.
 *
 * `you`, when the caller has a character to hand, sits at the compass's own
 * center — face, doll (posed standing, sitting cross-legged, or lying down,
 * matching whatever the character's own situation currently says — see
 * `Paperdoll`'s `pose` prop), vitals as coloured numbers (not a bar — see
 * `YouCard`) and status, together, since those are the things that change
 * every few seconds in a fight and are worth a glance without looking away
 * from the picture. Exactly one copy of this card ever renders — it never
 * also appears in the roster strip.
 *
 * The backdrop is the room itself — `RoomBackdrop`, the same fingerprint or
 * real render `RoomScene` draws for this exact room, not a flat panel of
 * its own, when this board draws its own frame at all (embedded mode
 * skips it entirely; `RoomScene` already painted the real one one layer
 * down).
 *
 * Nothing on the board is ever an always-visible label — a puck (portrait,
 * submitted player picture, a guessed NPC default, or an initial letter
 * when none of those exist) plus a tooltip carrying the full sentence,
 * everywhere. Text has a 12px floor in this app (DESIGN.md, enforced by
 * tools/contrast-test.mjs), a floor that does not move for a small screen,
 * so a board crowded with names was always going to run out of room
 * before the text ran out of length. Pucks don't have that problem: a
 * marker shrinks, a tooltip does not, and nothing shown here is ever more
 * than a tap or a hover away from its full detail — including what a
 * hostile's own bestiary entry says about it (level, HP range, size,
 * whether it casts or hides) and whatever `assess` currently says is
 * wrong with it (stunned, off balance, cursed), the closest thing this
 * app has to "wounds" for something that is not you.
 */

/** Same threshold as this board has always used — assess data past a
 * minute old is shown softened rather than at full confidence. */
const STALE_AFTER_SECONDS = 60

/** Below this measured width, pucks shrink too, so a marker never claims
 * more of a tiny board than the gap between two of them can afford.
 * Nothing on this board ever prints an always-visible name, so this is the
 * only responsive threshold left: marker size, not label visibility. */
const COMPACT_MIN_PX = 160

/** How wide the roster strip is, in cards — "2 cards wide" per spec,
 * plus the gap and padding between them. Fixed in pucks rather than a
 * percentage of the board, so it stays exactly two cards wide whether the
 * board is a phone-sized pane or a full monitor; the compass gets
 * whatever is left. */
const STRIP_COLS = 2

/**
 * Melee wide, pole and missile progressively tighter. A floor, not the
 * final answer — see `rangeRadiusPct` below, which widens the melee ring
 * far enough that four cardinal-position pucks never overlap regardless of
 * how big pucks get.
 */
const RANGE_RADIUS_FLOOR_PCT: Record<'melee' | 'pole' | 'missile', number> = {
  melee: 20,
  pole: 27,
  missile: 34,
}

/** How much further out pole and missile sit than melee, once melee's own
 * radius is computed — a fixed gap rather than its own floor, so a melee
 * ring forced wider to fit its pucks still reads as "the same three rings,
 * further apart" instead of three radii drifting independently. */
const RANGE_DELTA_PCT: Record<'pole' | 'missile', number> = { pole: 6, missile: 12 }

/**
 * The actual radius to draw each range ring at, as a percentage of the
 * *compass's own box* (not the whole board — the compass has its own
 * measured width now that the roster lives in a separate strip). Widened
 * just enough that four pucks at the compass's four cardinal positions
 * (0/90/180/270, the only angles `angleFor` ever returns) can sit on the
 * melee ring at once without their circles overlapping — solved from the
 * real chord distance between two points 90° apart on the ring
 * (`R = diameter · breathing room / (2·sin(π/N))`), not the arc between
 * them, then compared against the floor and the larger one wins.
 */
function rangeRadiusPct(compassWidth: number, portraitPx: number): Record<'melee' | 'pole' | 'missile', number> {
  if (compassWidth <= 0) return { ...RANGE_RADIUS_FLOOR_PCT }
  const CARDINAL_SLOTS = 4
  const BREATHING_ROOM = 1.5
  const neededRadiusPx = (portraitPx * BREATHING_ROOM) / (2 * Math.sin(Math.PI / CARDINAL_SLOTS))
  const neededRadiusPct = (neededRadiusPx / compassWidth) * 100
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

/** A point on the unit circle around a given center, in this board's own
 * convention: 0° is straight up ("front"), clockwise. The center is a
 * parameter rather than a fixed 50/50 because the compass now spans the
 * whole board edge to edge (the roster floats over it as an overlay,
 * rather than sharing the board's width) — the *visual* center still
 * needs to sit clear of that overlay, so the caller nudges it left by
 * however much of the right edge the strip actually covers. */
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

/** Everyone the compass has no fixed position for, as a puck-worthy entry
 * for the roster strip instead — a hostile with no real assess reading to
 * place it by (dead, or simply not yet assessed), plus every ally and
 * person, none of whom the game gives a range or relation for at all. */
interface PaneEntry {
  key: string
  card: RoomCard
  combatant?: RoomCombatant
}

/** A hostile the compass *can* place precisely — assess gave it a real
 * range and relation, which `angleFor`/`rangeRadiusPct` turn into an actual
 * point on the ring. */
interface Positioned {
  key: string
  card: RoomCard
  combatant: RoomCombatant
  angleDeg: number
  radiusPct: number
}

/** What a pane needs beyond its list of entries: an accessible name, and
 * the honest fallback word for "assess has nothing to say about this one"
 * (a corpse or a PC/NPC always uses this; a live mob only does when no
 * combatant matched it at all). */
interface PaneMeta {
  label: string
  presence: string
  /** The per-card tinge — a small coloured ring on the puck itself, not a
   * border around a whole region (see the module doc comment for why that
   * changed). Hostile reads red, friendly reads blue, same tokens this
   * app's danger/info colours already mean everywhere else. */
  ringClass: string
}

const PANE_META: Record<Deck, PaneMeta> = {
  hostile: { label: 'Mobs', presence: 'unassessed', ringClass: 'border-danger/70' },
  people: { label: 'PCs', presence: 'here', ringClass: 'border-info/70' },
  allied: { label: 'NPCs', presence: 'allied', ringClass: 'border-info/70' },
}

/** The roster strip — one scrollable pane, two cards wide, holding every
 * entry the compass didn't get to place: dead or unassessed hostiles,
 * every ally, every person. One list rather than three stacked panes,
 * because the strip is narrow enough that three separate scroll regions
 * would each be too short to be worth their own header; each card still
 * carries its own deck (and so its own colour) via `EntryPuck`. Grab-and-
 * drag (see useDragScroll) over a visible scrollbar — the strip sits over
 * a picture, where a permanently-visible scrollbar track reads as chrome
 * on top of the room. */
function RosterStrip({
  width,
  bordered = true,
  children,
}: {
  width: number
  /** Off for `BattlePanel`'s standalone card, where this is the *only*
   * thing on the board rather than a strip beside a compass — a left
   * border and its own background would read as a stray line on an
   * otherwise plain dark disc. */
  bordered?: boolean
  children: ReactNode
}) {
  const drag = useDragScroll()
  return (
    <div
      ref={drag.ref}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      className={`no-scrollbar h-full shrink-0 cursor-grab overflow-x-hidden overflow-y-auto touch-none active:cursor-grabbing ${bordered ? 'border-l border-border/60 bg-surface/85' : ''}`}
      style={{ width }}
      aria-label="Roster"
    >
      <div className="flex flex-wrap content-start justify-center gap-1 p-1">{children}</div>
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
 * Same frame as PlayerPortrait, for a *guessed* NPC default instead of a
 * real submitted picture — kept separate so a 404 on a guessed npc-defaults
 * file never calls notePlayerArtMissing and poisons the real player-art
 * cache with a name that was never a player's in the first place.
 */
function NpcPortrait({ url, height, className }: { url: string; height: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <div className={`relative w-full overflow-hidden bg-surface-overlay ${className ?? ''}`} style={{ height }}>
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover object-top"
        onError={() => setFailed(true)}
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

  // No submitted picture — before falling all the way to a bare letter, try
  // a guessed NPC default. This only ever fires for names that turned up in
  // the wiki-researched shopkeeper/guard/clan lists (npcRoleGuessFor), so a
  // real player sharing no such name never hits it; a real player who
  // happens to share a researched NPC's name is the one accepted false
  // positive here, same tradeoff npc-defaults' whole design already takes.
  if (card.deck === 'people') {
    const guess = npcRoleGuessFor(card.name)
    const npcArt = guess ? npcDefaultFor(guess.role, guess.gender, card.name) : undefined
    if (npcArt) {
      return (
        <div style={{ width: px, boxShadow: PUCK_SHADOW, borderRadius: frameRadius }}>
          <NpcPortrait url={npcArt.url} height={height} className={`border ${ringClass} ${frameClass}`} />
        </div>
      )
    }
  }

  // People without a submitted picture or a guessed NPC default are the one
  // case with no bestiary answer to fall back to — a person is not a
  // creature, so CreatureArt's silhouette-by-body-type has nothing to draw.
  // Framed the same as every other fallback on this board though (same
  // shape, same shadow, an initial letter the way CreatureArt's own letter
  // tier reads) rather than a visually distinct dot — a PC and a mob
  // without art should read as the same *kind* of placeholder, not two
  // different systems.
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

/**
 * Green at full, quite yellow by 80%, orange by 60%, solidly red by 40% and
 * below — four calibration points rather than one straight ramp, because a
 * ramp that only reaches yellow around the halfway mark reads as "basically
 * fine" for exactly the stretch where a player actually wants a warning. A
 * hundred whole-percent steps each get their own point on this curve —
 * hue between the calibration points, and below the red point, a darkening
 * lightness instead (hue has nowhere further red to go) — so 39% and 5%
 * still read as visibly different urgency rather than collapsing into one
 * flat "red" the moment the number crosses 40.
 */
const VITAL_COLOR_STOPS: Array<{ pct: number; hue: number }> = [
  { pct: 100, hue: 120 }, // green
  { pct: 80, hue: 55 }, // quite yellow
  { pct: 60, hue: 30 }, // orange
  { pct: 40, hue: 0 }, // red
]

function vitalColor(share: number): string {
  const pct = Math.max(0, Math.min(1, share)) * 100

  if (pct <= 40) {
    // Below the red point, hue is pinned — the remaining 40 steps read
    // through lightness instead, darkening toward empty rather than
    // sitting at one unchanging red the whole way down.
    const lightness = 35 + (pct / 40) * 15
    return `hsl(0, 90%, ${lightness}%)`
  }

  for (let i = 0; i < VITAL_COLOR_STOPS.length - 1; i++) {
    const hi = VITAL_COLOR_STOPS[i]
    const lo = VITAL_COLOR_STOPS[i + 1]
    if (pct <= hi.pct && pct >= lo.pct) {
      const t = (pct - lo.pct) / (hi.pct - lo.pct)
      const hue = lo.hue + t * (hi.hue - lo.hue)
      return `hsl(${hue}, 90%, 50%)`
    }
  }
  return `hsl(${VITAL_COLOR_STOPS[0].hue}, 90%, 50%)`
}

/**
 * The status flags worth a glance mid-fight, as an icon rather than a text
 * chip — the full word-for-word list (with roundtime, spells, and the
 * "good" band like hidden/invisible/joined) already renders above the
 * picture in `BattleStatus`'s own `StatusBoard`; repeating all of that a
 * second time, in the middle of the board, was chrome saying the same
 * thing twice. `prone`/`kneeling`/`sitting` are left out on purpose too —
 * the doll's own pose already draws those. What's left is exactly the
 * injury-adjacent set: something actively hurting you, or costing you your
 * turn.
 */
const STATUS_ICON: Partial<Record<string, { Icon: LucideIcon; label: string; tone: string }>> = {
  dead: { Icon: Skull, label: 'Dead', tone: 'text-danger' },
  dying: { Icon: HeartCrack, label: 'Dying', tone: 'text-danger' },
  bleeding: { Icon: Droplet, label: 'Bleeding', tone: 'text-danger' },
  low_health: { Icon: HeartPulse, label: 'Low health', tone: 'text-danger' },
  poisoned: { Icon: FlaskConical, label: 'Poisoned', tone: 'text-danger' },
  diseased: { Icon: Bug, label: 'Diseased', tone: 'text-danger' },
  stunned: { Icon: Zap, label: 'Stunned', tone: 'text-warn' },
  webbed: { Icon: Anchor, label: 'Webbed', tone: 'text-warn' },
  immobilized: { Icon: Ban, label: 'Immobilised', tone: 'text-warn' },
}

/** Nerves, as the same three-step tone the doll's own parts use — plain,
 * warn, danger — rather than the doll's own near-invisible sliver: `nsys`
 * is a 2-unit-wide strip out of a 60-wide viewBox, which reads fine at the
 * dashboard's full-size doll (S2) and is sub-pixel at this card's much
 * smaller one. An icon carries the same fact at a size that's actually
 * legible here, instead of asking the doll to do a job it can't at this
 * scale. */
function nsysTone(wound: number): string {
  if (wound >= 2) return 'text-danger'
  if (wound === 1) return 'text-warn'
  return 'text-ink-faint'
}

/**
 * You — face, doll, pools and status, together, at the compass's own
 * center. The numbers stand in for a bar on purpose: a bar needs width
 * this card does not have to spare once the doll itself is sized to
 * actually read an injury, and a coloured number carries the same
 * "how worried should I be" read a bar does, just narrower. The doll's own
 * pose — standing, sitting cross-legged, or lying down — follows whatever
 * the character's situation currently says, so a downed or seated
 * character reads as one at a glance instead of standing through it.
 *
 * No border, and only just enough background to keep the numbers and
 * icons legible over whatever the room picture happens to be doing behind
 * them — a hard box edge was chrome the middle of a compass doesn't need,
 * and every pixel it cost was a pixel not spent on the portrait or the
 * doll.
 *
 * Exactly one of these ever renders (`CombatRadar` places it once, at the
 * compass center) — it never also appears as a puck in the roster strip.
 */
function YouCard({
  you,
  compact,
}: {
  you: {
    character: string
    race?: string | null
    injuries: Partial<Record<BodyPart, Injury>>
    injuriesKnown: boolean
    vitals: Vital[]
    pose: Pose
    statusFlags: string[]
  }
  compact: boolean
}) {
  const nsysWound = you.injuries.nsys?.wound ?? 0
  const statusIcons = you.statusFlags
    .map((f) => STATUS_ICON[f])
    .filter((s): s is NonNullable<typeof s> => s != null)

  return (
    <div
      className="pointer-events-auto flex max-w-[16rem] flex-col gap-0.5 rounded-lg bg-surface/55 p-1 backdrop-blur-sm"
      style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.6)' }}
    >
      <div className="flex items-center gap-1.5">
        <Portrait character={you.character} race={you.race ?? undefined} size={compact ? 64 : 92} />
        <Paperdoll
          injuries={you.injuries}
          height={compact ? 96 : 138}
          known={you.injuriesKnown}
          pose={you.pose}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {you.vitals.map((v) => {
          const share = v.max > 0 ? v.value / v.max : 1
          return (
            <span key={v.key} className="text-xs text-ink-muted" title={`${v.label}: ${v.value}/${v.max}`}>
              {v.label.slice(0, 2).toUpperCase()}{' '}
              <span className="text-sm font-bold tabular-nums" style={{ color: vitalColor(share) }}>
                {v.value}
              </span>
            </span>
          )
        })}

        {/* Nerves and the injury-adjacent status flags, as small icons in
            the same row the vitals sit in — see the doc comments above for
            why each lives here instead of a full StatusBoard. */}
        <span className="ml-auto flex items-center gap-1" title={`Nerves: ${SEVERITY_LABEL[nsysWound as Severity]}`}>
          <Activity className={`h-3.5 w-3.5 ${nsysTone(nsysWound)}`} aria-hidden />
        </span>
        {statusIcons.map(({ Icon, label, tone }) => (
          <span key={label} title={label} className="flex items-center">
            <Icon className={`h-3.5 w-3.5 ${tone}`} aria-hidden />
          </span>
        ))}
      </div>
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
   * You — face, doll, pools and status, at the top of the friendly side.
   * Optional, and only ever passed embedded: `BattleColumn` has a
   * character to hand, `BattlePanel`'s standalone card already shows a
   * paperdoll and vitals of its own above this component, so handing it a
   * second copy would just show them twice — same reasoning as
   * `zone`/`room`. Absent, no card renders at all (`BattlePanel` never had
   * one here to begin with).
   */
  you?: {
    character: string
    race?: string | null
    injuries: Partial<Record<BodyPart, Injury>>
    injuriesKnown: boolean
    vitals: Vital[]
    /** Standing, sitting cross-legged, or lying down — the caller derives
     * this from the character's own situation flags (see BattleColumn) and
     * hands it straight through to `Paperdoll`. */
    pose: Pose
    /** The injury-adjacent situation flags worth an icon on `YouCard` —
     * see that component's own doc comment for why this is a curated
     * subset rather than the full list `StatusBoard` shows. */
    statusFlags: string[]
  }
  /**
   * True when `RoomScene` is passing this in as its own `overlay` — the room
   * picture is already right there, one layer down in the same box, so
   * drawing a second copy of it (this component's own backdrop) would put
   * the same room on screen twice at once. Embedded mode skips its own
   * backdrop and fills whatever box it was handed instead with the two
   * bordered sides — see the module doc comment. Standalone (`BattlePanel`)
   * keeps the plain dark disc this radar has always drawn hostiles on.
   */
  embedded?: boolean
}) {
  const index = indexCombatants(combatants)
  const { run: runMacro, canSend: canAttack, reason: attackReason } = useMacroRunner()
  const { ref: boardRef, width: boardWidth } = useMeasuredWidth()
  const compact = boardWidth > 0 && boardWidth < COMPACT_MIN_PX

  const portraitPx = compact ? 60 : 84
  // The strip's own cards — smaller than a positioned compass puck, since
  // "2 cards wide" only fits at a size the strip's own measured width
  // actually allows.
  const stripPx = compact ? 44 : 58
  const compassPortraitPx = compact ? 40 : 56

  const stripGapPx = 4
  const stripWidthPx = embedded ? STRIP_COLS * stripPx + (STRIP_COLS + 1) * stripGapPx + 1 : 0

  // The compass now draws edge to edge — the roster floats over its right
  // side as an overlay (see RosterStrip below) rather than sharing the
  // board's width, so ring geometry is sized against the *whole* board.
  // Only the visual center moves: nudged left by half the strip's own
  // width so You and anything positioned near the right edge still sit in
  // the clear, rather than under the overlay.
  const compassWidth = boardWidth
  const centerXPct = embedded && boardWidth > 0 ? 50 - ((stripWidthPx / 2) / boardWidth) * 100 : 50
  const centerYPct = 50

  const RANGE_RADIUS_PCT = rangeRadiusPct(compassWidth, compassPortraitPx)

  // Two buckets, decided per hostile: assess gave it a real range and
  // relation, so the compass can place it precisely — or it did not (dead,
  // or simply never assessed), and it falls to the roster strip instead,
  // same list every ally and person lands in too (assess never describes
  // either of those with a range or relation at all).
  const positioned: Positioned[] = []
  const stripEntries: PaneEntry[] = []
  for (const card of cards) {
    if (card.deck !== 'hostile') {
      if (embedded) stripEntries.push({ key: card.id, card })
      continue
    }
    if (card.status === 'dead') {
      // A corpse is still a real thing in the room, worth skinning or
      // looting, so it still gets a puck rather than vanishing the moment
      // it dies — dimmed at render time, in the strip rather than on a
      // ring it no longer has a live range or relation to sit on.
      stripEntries.push({ key: card.id, card })
      continue
    }
    const combatant = combatantFor(card, index)
    // Standalone (`BattlePanel`) has no compass to place anything on — see
    // that branch's own comment — so every live hostile stays in the flat
    // list there regardless of what assess knew about it.
    if (embedded && combatant?.range && combatant.relation) {
      positioned.push({
        key: card.id,
        card,
        combatant,
        angleDeg: angleFor(combatant.relation, card.id),
        radiusPct: RANGE_RADIUS_PCT[combatant.range],
      })
    } else {
      stripEntries.push({ key: card.id, card, combatant })
    }
  }

  // Same-angle jitter: two combatants sharing one of the four cardinal
  // angles fan out into a small grid around their shared point rather than
  // stacking exactly on top of each other.
  const FAN_COLS = 3
  const fanGapPct = compassWidth > 0 ? Math.max((compassPortraitPx * 1.3 * 100) / compassWidth, 5) : 8
  const byAngle = new Map<number, Positioned[]>()
  for (const p of positioned) {
    const list = byAngle.get(p.angleDeg)
    if (list) list.push(p)
    else byAngle.set(p.angleDeg, [p])
  }
  const fanned = new Map<string, { x: number; y: number }>()
  for (const group of byAngle.values()) {
    group.forEach((p, i) => {
      const { x, y } = pointOn(centerXPct, centerYPct, p.angleDeg, p.radiusPct)
      const cols = Math.min(group.length, FAN_COLS)
      const col = i % cols
      const row = Math.floor(i / cols)
      const offsetX = (col - (cols - 1) / 2) * fanGapPct
      const offsetY = row * fanGapPct
      fanned.set(p.key, { x: x + offsetX, y: y + offsetY })
    })
  }

  // Click anything and it jumps to the top of the strip — a scrolling pile
  // of hundreds is only useful if the one you're looking for can be pulled
  // to where you can see it. Pins are per-room UI state, not game state:
  // they reset the moment the character walks into a different room, same
  // as the rest of this component.
  const [pinned, setPinned] = useState<string[]>([])
  const promote = (key: string) => setPinned((prev) => [key, ...prev.filter((k) => k !== key)])
  const orderedStrip = reorderByPin(stripEntries, (e) => e.key, pinned)

  const attack = () => runMacro(['attack'])
  const attackTitle = (label: string) =>
    attackReason ?? `${label} — attack (whatever is in front of you right now)`

  /** One puck — wired to attack on click for a live hostile, otherwise
   * only to pin itself to the top of the strip. Shared by the compass and
   * the strip so a goblin's puck behaves identically wherever it appears.
   * Colour lives here: a small tinted ring per deck (`PANE_META.ringClass`)
   * rather than a border around the region the puck happens to sit in. */
  function EntryPuck({
    card,
    combatant,
    px,
  }: {
    card: RoomCard
    combatant?: RoomCombatant
    px: number
  }) {
    const meta = PANE_META[card.deck]
    const detail = detailFor(card, combatant, meta.presence)
    const dead = card.status === 'dead'
    const attackable = card.deck === 'hostile' && !dead
    const onClick = attackable
      ? () => {
          attack()
          promote(card.id)
        }
      : () => promote(card.id)
    const label = attackable
      ? `${card.name} — ${detail} — ${attackTitle('Attack')}`
      : `${card.name} — ${detail} — click to bring to the top`
    return (
      <HoverCard content={<InfoCard card={card} combatant={combatant} presence={meta.presence} />}>
        <button
          type="button"
          disabled={attackable && !canAttack}
          onClick={onClick}
          aria-label={label}
          className="flex shrink-0 items-center justify-center disabled:cursor-not-allowed"
          style={{ width: px, height: Math.round(px * PORTRAIT_ASPECT), opacity: dead ? 0.55 : undefined }}
        >
          <Puck card={card} px={px} ringClass={meta.ringClass} shape="rect" />
        </button>
      </HoverCard>
    )
  }

  const disc = (
    <div
      ref={boardRef}
      className={
        embedded
          ? 'absolute inset-0 overflow-hidden'
          : 'relative mx-auto flex aspect-square w-full max-w-[300px] flex-col overflow-hidden rounded border-2 border-danger/70'
      }
    >
      {embedded ? (
        <>
          {/* The compass — the whole board, edge to edge. The roster floats
              over its right side as an overlay (below) rather than sharing
              the board's width with it, so the play area itself reaches
              all the way to both edges the way the rest of the room
              picture does. A hostile assess has given a real range and
              relation to sits on the ring at that range and angle; the
              ring itself is drawn faint so a player reads "closer means
              more dangerous" without the rings competing with the room
              picture underneath. */}
          {(['melee', 'pole', 'missile'] as const).map((r) => (
            <div
              key={r}
              aria-hidden
              className="absolute rounded-full border border-danger/25"
              style={{
                left: `${centerXPct - RANGE_RADIUS_PCT[r]}%`,
                top: `${centerYPct - RANGE_RADIUS_PCT[r]}%`,
                width: `${RANGE_RADIUS_PCT[r] * 2}%`,
                height: `${RANGE_RADIUS_PCT[r] * 2}%`,
              }}
            />
          ))}

          {positioned.map((p) => {
            const pos = fanned.get(p.key) ?? pointOn(centerXPct, centerYPct, p.angleDeg, p.radiusPct)
            return (
              <div
                key={p.key}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <EntryPuck card={p.card} combatant={p.combatant} px={compassPortraitPx} />
              </div>
            )
          })}

          {/* You, at the compass's own (shifted-left) center — the one
              place on this board that is never anyone else's. Exactly one
              copy: this is the only spot `YouCard` ever renders. */}
          {you && (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${centerXPct}%`, top: `${centerYPct}%` }}
            >
              <YouCard you={you} compact={compact} />
            </div>
          )}

          {positioned.length === 0 && !you && (
            <p
              className="absolute w-32 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-ink-faint"
              style={{ left: `${centerXPct}%`, top: `${centerYPct}%` }}
            >
              Nothing engaged
            </p>
          )}

          {/* The roster — everyone the compass didn't get to place: dead or
              unassessed hostiles, every ally, every person. Two cards
              wide, floated over the compass's right edge rather than
              sharing its width, so the compass itself still reaches all
              the way across the board underneath it. */}
          <div className="absolute right-0 top-0 h-full">
            <RosterStrip width={stripWidthPx}>
              {orderedStrip.map((entry) => (
                <EntryPuck key={entry.key} card={entry.card} combatant={entry.combatant} px={stripPx} />
              ))}
            </RosterStrip>
          </div>
        </>
      ) : (
        <>
          {/* Standalone (`BattlePanel`): hostile only, the plain dark disc
              this radar has always drawn them on — see the `embedded`
              prop's own doc comment for why allied/people never reach
              here. No compass here either (BattlePanel never measured a
              range/relation split before this pass and nothing asked for
              one now) — same flat scrollable list it has always shown. */}
          {zone && room != null && <RoomBackdrop zone={zone} room={room} title={title} text={text} />}
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.7) 100%)' }}
            aria-hidden
          />
          {orderedStrip.length > 0 ? (
            <RosterStrip width={boardWidth} bordered={false}>
              {orderedStrip.map((entry) => (
                <EntryPuck key={entry.key} card={entry.card} combatant={entry.combatant} px={portraitPx} />
              ))}
            </RosterStrip>
          ) : (
            <p className="absolute left-1/2 top-1/2 w-32 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-ink-faint">
              Nothing hostile here
            </p>
          )}
        </>
      )}
    </div>
  )

  return disc
}
