import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useDragScroll } from '../../lib/useDragScroll'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from './CreatureArt'
import { Portrait } from './Portrait'
import { Paperdoll } from './Paperdoll'
import { StatusBoard } from './StatusBoard'
import { playerArtFor, notePlayerArtMissing } from '../../lib/playerArt'
import { npcRoleGuessFor, npcDefaultFor } from '../../lib/npcDefaults'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { RoomBackdrop } from '../room/RoomBackdrop'
import { DECK_STYLE, type Deck } from '../../lib/cards'
import type { RoomCombatant } from '../../types'
import type { RoomCard } from '../../lib/cards'
import type { BodyPart, Injury } from '../../lib/body'
import type { Vital } from '../../lib/vitals'

/**
 * The room, with everyone in it — two sides, because a fight only ever has
 * two: you and your friends on one, everything hostile on the other.
 *
 * Earlier passes tried to draw this as a compass — real assess range and
 * relation mapped to an angle and a radius, everyone else parked in
 * whichever of four corners fit their deck. It looked like DR's own combat
 * readout and it cost more than it gave: a ring wide enough to hold a real
 * flanking fight left no room for the rest of the board, off-center it
 * fought the very corners it was supposed to leave free, and every one of
 * those problems came back the moment a puck grew past the size that made
 * the geometry work in the first place. The board is two bordered halves
 * instead — blue (`border-info`) for you and your friends on the left,
 * red (`border-danger`) for hostiles on the right, each a real scrollable
 * pane (`SidePane`) rather than a fixed number of points squeezed onto a
 * ring. Nothing about `assess`'s own detail was lost in the move: range,
 * relation, target, balance and conditions all still show, in `InfoCard`,
 * on hover or focus — this only changed how a card's *position on the
 * board* is decided, not what it's allowed to say about itself.
 *
 * Friendly is PCs above NPCs, sharing the left side's height evenly — two
 * panes stacked instead of split across opposite corners, so "the people"
 * reads as one cluster rather than two unrelated boxes. `you`, when the
 * caller has a character to hand, sits above both: face, doll, vitals (as
 * coloured numbers, not a bar — see `YouCard`) and status, together, since
 * those are the things about "you" that change every few seconds in a
 * fight and are worth a glance without looking away from the picture.
 *
 * Hostile is one pane, dead or alive, assessed or not — a corpse is dimmed
 * and un-clickable rather than dropped from the board, since it's still a
 * real thing in the room worth skinning. A live entry attacks on click; a
 * dead one, or anyone on the friendly side, only pins itself to the top of
 * its own pane, the same gesture either way ("I want this one") doing
 * whatever there actually is to do with it.
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

/** Everyone in one deck, as a puck-worthy entry — the compass's old
 * "positioned vs corner" split is gone: there is no more radial geometry to
 * place someone precisely on, so every hostile, ally and person is the
 * same shape of entry now, differing only in what `detailFor`/`InfoCard`
 * happen to find to say about them. */
interface PaneEntry {
  key: string
  card: RoomCard
  combatant?: RoomCombatant
}

/** What a pane needs beyond its list of entries: an accessible name, and
 * the honest fallback word for "assess has nothing to say about this one"
 * (a corpse or a PC/NPC always uses this; a live mob only does when no
 * combatant matched it at all). */
interface PaneMeta {
  label: string
  presence: string
}

const PANE_META: Record<Deck, PaneMeta> = {
  hostile: { label: 'Mobs', presence: 'unassessed' },
  people: { label: 'PCs', presence: 'here' },
  allied: { label: 'NPCs', presence: 'allied' },
}

/** One scrollable pane — the container every side of the board renders its
 * pucks into. A plain wrapping flexbox, `flex-1` so two panes stacked in
 * one bordered side share its height evenly. Grab-and-drag (see
 * useDragScroll) over a visible scrollbar — the pane sits over a picture,
 * where a permanently-visible scrollbar track reads as chrome on top of
 * the room. */
function SidePane({ label, children }: { label: string; children: ReactNode }) {
  const drag = useDragScroll()
  return (
    <div
      ref={drag.ref}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      className="no-scrollbar min-h-0 flex-1 cursor-grab overflow-x-hidden overflow-y-auto touch-none active:cursor-grabbing"
      aria-label={label}
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

/** Green at full, red at empty, sliding smoothly through amber between —
 * a gradient rather than the app's usual three-band jump (VitalCluster's
 * own good/warn/danger steps), because a number reads its own severity
 * once it has a colour at all; the step boundaries that matter for a bar's
 * length stop mattering once the number itself is what's being read. */
function vitalColor(share: number): string {
  const hue = Math.max(0, Math.min(1, share)) * 120
  return `hsl(${hue}, 70%, 55%)`
}

/**
 * You — face, doll, pools and status, together, at the top of the
 * friendly side. The numbers stand in for a bar on purpose: a bar needs
 * width this card does not have to spare once the doll itself is sized to
 * actually read an injury, and a coloured number carries the same
 * "how worried should I be" read a bar does, just narrower.
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
  }
  compact: boolean
}) {
  return (
    <div
      className="m-1 flex flex-col gap-1.5 rounded-lg border border-accent/60 bg-surface/90 p-2"
      style={{ boxShadow: PUCK_SHADOW }}
    >
      <div className="flex items-center gap-2">
        <Portrait character={you.character} race={you.race ?? undefined} size={compact ? 44 : 64} />
        <Paperdoll injuries={you.injuries} height={compact ? 78 : 112} known={you.injuriesKnown} />
      </div>
      {you.vitals.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          {you.vitals.map((v) => {
            const share = v.max > 0 ? v.value / v.max : 1
            return (
              <span
                key={v.key}
                className="text-xs font-semibold tabular-nums"
                style={{ color: vitalColor(share) }}
                title={`${v.label}: ${v.value}/${v.max}`}
              >
                {v.label.slice(0, 2).toUpperCase()} {v.value}
              </span>
            )
          })}
        </div>
      )}
      <StatusBoard />
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

  // Doubled — a pane is a real scrollable list now (see SidePane), not a
  // fixed handful of points squeezed into a corner, so there is no longer
  // a ceiling on puck size fighting a ceiling on how many can fit without
  // overlapping.
  const portraitPx = compact ? 60 : 84
  const cornerPx = compact ? 52 : 72
  // Mobs read as the biggest thing on the board on purpose — they're the
  // reason a player is looking at it at all. PCs and NPCs share the same
  // frame and fallback chain (see Puck) so they read as the same *kind* of
  // card, just not the loudest one.
  const hostileCornerPx = compact ? 68 : 94

  // Every hostile is one flat list now — the old "positioned on the
  // compass" vs "in a corner" split existed only to feed radial geometry
  // that no longer exists (see the module doc comment on why the board
  // moved to two bordered sides instead of a compass). `detailFor` and
  // `InfoCard` still carry every bit of assess detail (range, relation,
  // target, balance) regardless of which list a card sits in, so nothing
  // about that information was lost, only the spatial drawing of it.
  const hostileEntries: PaneEntry[] = []
  for (const card of cards) {
    if (card.deck !== 'hostile') continue
    if (card.status === 'dead') {
      // A corpse is still a real thing in the room, worth skinning or
      // looting, so it still gets a puck rather than vanishing the moment
      // it dies — dimmed at render time, not dropped here.
      hostileEntries.push({ key: card.id, card })
      continue
    }
    hostileEntries.push({ key: card.id, card, combatant: combatantFor(card, index) })
  }

  // Friendlies: embedded only — see the `embedded` prop's own doc comment
  // for why allied/people never reach here otherwise (BattlePanel keeps
  // its own decks below the radar).
  const rawEntries: Record<Deck, PaneEntry[]> = embedded
    ? {
        hostile: hostileEntries,
        allied: cards.filter((c) => c.deck === 'allied').map((card) => ({ key: card.id, card })),
        people: cards.filter((c) => c.deck === 'people').map((card) => ({ key: card.id, card })),
      }
    : { hostile: hostileEntries, allied: [], people: [] }

  // Click anything and it jumps to the top of its own pane — a scrolling
  // pile of hundreds is only useful if the one you're looking for can be
  // pulled to where you can see it. Pins are per-room UI state, not game
  // state: they reset the moment the character walks into a different
  // room, same as the rest of this component.
  const [pinned, setPinned] = useState<{ hostile: string[]; people: string[]; allied: string[] }>({
    hostile: [],
    people: [],
    allied: [],
  })
  const promote = (bucket: keyof typeof pinned, key: string) =>
    setPinned((prev) => ({ ...prev, [bucket]: [key, ...prev[bucket].filter((k) => k !== key)] }))

  const entries: Record<Deck, PaneEntry[]> = {
    hostile: reorderByPin(rawEntries.hostile, (e) => e.key, pinned.hostile),
    allied: reorderByPin(rawEntries.allied, (e) => e.key, pinned.allied),
    people: reorderByPin(rawEntries.people, (e) => e.key, pinned.people),
  }

  const attack = () => runMacro(['attack'])
  const attackTitle = (label: string) =>
    attackReason ?? `${label} — attack (whatever is in front of you right now)`

  /** One puck, wired for both the hostile side (attacks on click) and the
   * friendly side (click only pins — nothing here should send a command
   * against a person by accident). Shared between the two sides and
   * between embedded/standalone so a goblin's puck behaves identically
   * everywhere it can appear. */
  function EntryPuck({ deck, entry, px }: { deck: Deck; entry: PaneEntry; px: number }) {
    const meta = PANE_META[deck]
    const detail = detailFor(entry.card, entry.combatant, meta.presence)
    const dead = entry.card.status === 'dead'
    const attackable = deck === 'hostile' && !dead
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
      <HoverCard content={<InfoCard card={entry.card} combatant={entry.combatant} presence={meta.presence} />}>
        <button
          type="button"
          disabled={attackable && !canAttack}
          onClick={onClick}
          aria-label={label}
          className="flex shrink-0 items-center justify-center disabled:cursor-not-allowed"
          style={{ width: px, height: Math.round(px * PORTRAIT_ASPECT), opacity: dead ? 0.55 : undefined }}
        >
          <Puck card={entry.card} px={px} ringClass="border-surface" shape="rect" />
        </button>
      </HoverCard>
    )
  }

  const disc = (
    <div
      ref={boardRef}
      className={
        embedded
          ? 'absolute inset-0 flex gap-1 p-1'
          : 'relative mx-auto flex aspect-square w-full max-w-[300px] flex-col overflow-hidden rounded border-2 border-danger/70'
      }
    >
      {embedded ? (
        <>
          {/* Two sides, not four corners around a compass — this board only
              ever has two kinds of actors on it, friendly and not, and a
              player reads "which side is which" faster from a solid
              bordered half than from where a dot happens to sit on a
              circle. Blue for friendly, red for hostile — this app's own
              info/danger tokens, not a colour invented for this board. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border-2 border-info/70 bg-surface/70">
            {you && <YouCard you={you} compact={compact} />}
            {/* PCs above NPCs, sharing this side's height evenly — two
                friendly panes stacked instead of split across opposite
                corners, so "the people" reads as one cluster. */}
            <SidePane label={PANE_META.people.label}>
              {entries.people.map((entry) => (
                <EntryPuck key={entry.key} deck="people" entry={entry} px={cornerPx} />
              ))}
            </SidePane>
            <SidePane label={PANE_META.allied.label}>
              {entries.allied.map((entry) => (
                <EntryPuck key={entry.key} deck="allied" entry={entry} px={cornerPx} />
              ))}
            </SidePane>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border-2 border-danger/70 bg-surface/70">
            <SidePane label={PANE_META.hostile.label}>
              {entries.hostile.map((entry) => (
                <EntryPuck key={entry.key} deck="hostile" entry={entry} px={hostileCornerPx} />
              ))}
            </SidePane>
          </div>
        </>
      ) : (
        <>
          {/* Standalone (`BattlePanel`): hostile only, the plain dark disc
              this radar has always drawn them on — see the `embedded`
              prop's own doc comment for why allied/people never reach
              here. */}
          {zone && room != null && <RoomBackdrop zone={zone} room={room} title={title} text={text} />}
          <div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.7) 100%)' }}
            aria-hidden
          />
          {entries.hostile.length > 0 ? (
            <SidePane label={PANE_META.hostile.label}>
              {entries.hostile.map((entry) => (
                <EntryPuck key={entry.key} deck="hostile" entry={entry} px={portraitPx} />
              ))}
            </SidePane>
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
