import { useEffect, useRef, useState } from 'react'
import { ChevronUp, User } from 'lucide-react'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from './CreatureArt'
import { hasArt } from '../../lib/creatureArt'
import { nounOf } from '../../lib/room'
import { useRoomItemTake } from '../../lib/useRoomItemTake'
import { RoomBackdrop } from '../room/RoomBackdrop'
import { DECK_STYLE } from '../../lib/cards'
import type { RoomCombatant } from '../../types'
import type { RoomCard } from '../../lib/cards'

/**
 * The room, with everyone and everything in it drawn where they actually
 * are — or, for the people and things `assess` says nothing about, honestly
 * placed as "somewhere in the room" rather than left off the picture or
 * shunted into a list beside it.
 *
 * `RoomChips` used to carry the ones this couldn't place: allied, people,
 * and any hostile without range/relation, as a row of icons under the
 * picture. That reads as two separate features that happen to agree — a
 * board with rings on it, and a list, both claiming to say who's here. One
 * of them has to be the answer. This is now the only one: everyone is on
 * the board, and the board is the only place they're drawn.
 *
 * Two tiers of honesty about position, and they look different on purpose:
 *
 *   - **The compass** — hostiles `assess` gave a real range and relation
 *     for. Radius is the range word, angle is the relation word, same as
 *     before. This is the only place this component claims to know where
 *     something actually is.
 *   - **The gallery ring** — everyone else embedded gets a card for: allied,
 *     people, and any hostile assess has nothing positional to say about
 *     (unassessed, disengaged, hidden). A wider, evenly-spaced ring further
 *     out than any real range reading, dot or portrait only, full detail on
 *     tap or hover. It says "in this room" and nothing more precise than
 *     that, because that is all this app was ever told.
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
 * A scrim sits between the two so the rings and names stay legible over
 * whatever the room happens to look like.
 *
 * Nothing on the board is ever an always-visible label — icon or dot, plus a
 * tooltip carrying the full sentence, everywhere. Text has a 12px floor in
 * this app (DESIGN.md, enforced by tools/contrast-test.mjs), a floor that
 * does not move for a small screen, so a board crowded with names was
 * always going to run out of room before the text ran out of length —
 * "Zdolyn's risen" at 12px is most of a 220px board on its own. Icons don't
 * have that problem: a marker shrinks, a tooltip does not, and nothing
 * shown here is ever more than a tap or a hover away from its full detail.
 */

/** Same threshold as RoomChips.tsx used — assess data past a minute old is
 * shown softened rather than at full confidence. */
const STALE_AFTER_SECONDS = 60

/**
 * How many floor items the radar draws directly on the picture, named and
 * exported so `BattleColumn` can fold the overflow into the last marker's
 * tooltip instead of repeating every item twice. Five is already most of
 * the melee ring's width at the radius this cluster sits at, and a real
 * drop pile is not uncommon after a fight this radar exists for.
 */
export const RADAR_ITEM_CAP = 5

/** Same idea for the gallery ring — a room can hold more people than a
 * ring of dots can space out and stay tappable. Capped, with the rest
 * folded into the last dot's tooltip, the same pattern the floor cluster
 * already uses. */
const GALLERY_CAP = 10

/** Below this measured width, portraits and dots shrink too, so a marker
 * never claims more of a tiny board than the gap between two of them can
 * afford. Nothing on this board ever prints an always-visible name any
 * more — see the module doc comment — so this is the only responsive
 * threshold left: marker size, not label visibility. */
const COMPACT_MIN_PX = 160

const RANGE_RADIUS_PCT: Record<'melee' | 'pole' | 'missile', number> = {
  melee: 20,
  pole: 36,
  missile: 48,
}

/** Further out than any real range reading (missile tops out at 48), so a
 * gallery-ring dot never sits where a real compass marker could also land
 * and reads unambiguously as "position not tracked" rather than "far
 * away." */
const GALLERY_RADIUS_PCT = 60

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

/** A point on the unit circle, in this board's own convention: 0° is
 * straight up ("front"), clockwise. Shared by the compass and the gallery
 * ring so "up" means the same thing on both. */
function pointOn(angleDeg: number, radiusPct: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: 50 + radiusPct * Math.cos(rad), y: 50 + radiusPct * Math.sin(rad) }
}

interface Positioned {
  key: string
  card: RoomCard
  combatant: RoomCombatant
  angleDeg: number
  radiusPct: number
}

/** Everyone the compass has no position for, drawn on the gallery ring
 * instead: allied, people, and any hostile assess left nothing positional
 * to say about. */
interface GalleryEntry {
  key: string
  card: RoomCard
  detail: string
}

/**
 * Measures its own rendered width and reports whether it has crossed a
 * threshold — the board shrinking inside a resizable pane or a genuinely
 * small screen are the same event to this hook, neither is a media query.
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

export function CombatRadar({
  zone,
  room,
  title,
  text,
  cards,
  combatants,
  items,
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
  /** Everyone in the room, every deck — hostile for the compass, all three
   * for the gallery ring when `embedded`. `BattlePanel` (standalone) still
   * passes hostile only; it keeps its own allied/people decks below the
   * radar rather than adopting the ring, so handing it more decks would
   * just show them twice. */
  cards: RoomCard[]
  combatants: RoomCombatant[]
  /** The floor, same feed `RoomChips` used to read. */
  items?: string[]
  /**
   * True when `RoomScene` is passing this in as its own `overlay` — the room
   * picture is already right there, one layer down in the same box, so
   * drawing a second copy of it (this component's own circular backdrop,
   * scaled to a smaller circle inside a square box that already has the
   * full-size original) would put the same room on screen twice at once.
   * Embedded mode skips its own backdrop and the circular frame and fills
   * whatever box it was handed instead, rings and markers only. It also
   * turns on the gallery ring — see the module doc comment.
   */
  embedded?: boolean
}) {
  const index = indexCombatants(combatants)
  const { take, canSend, reason } = useRoomItemTake()
  const { ref: boardRef, width: boardWidth } = useMeasuredWidth()
  const compact = boardWidth > 0 && boardWidth < COMPACT_MIN_PX

  const positioned: Positioned[] = []
  const galleryFromHostiles: GalleryEntry[] = []

  for (const card of cards) {
    if (card.deck !== 'hostile' || card.status === 'dead') continue
    const combatant = combatantFor(card, index)
    if (!combatant) {
      galleryFromHostiles.push({ key: card.id, card, detail: 'unassessed — nobody has checked yet' })
      continue
    }
    if (combatant.disengaged || !combatant.range || !combatant.relation) {
      galleryFromHostiles.push({
        key: card.id,
        card,
        detail: combatant.disengaged ? 'not fighting' : combatant.relation ?? 'position not reported',
      })
      continue
    }
    positioned.push({
      key: card.id,
      card,
      combatant,
      angleDeg: angleFor(combatant.relation, combatant.id),
      radiusPct: RANGE_RADIUS_PCT[combatant.range],
    })
  }

  // Spread anything sharing the exact same angle+range apart a little, so
  // two creatures both "flanking" at melee range do not sit on top of each
  // other. A real assess list would print them as separate lines; this is
  // the visual equivalent.
  const groups = new Map<string, Positioned[]>()
  for (const p of positioned) {
    const k = `${p.angleDeg}:${p.radiusPct}`
    const g = groups.get(k)
    if (g) g.push(p)
    else groups.set(k, [p])
  }
  const spread: (Positioned & { x: number; y: number; stack: number })[] = []
  for (const group of groups.values()) {
    const n = group.length
    group.forEach((p, i) => {
      const jitter = n > 1 ? (i - (n - 1) / 2) * 16 : 0
      const { x, y } = pointOn(p.angleDeg, p.radiusPct)
      spread.push({
        ...p,
        x: x + jitter,
        y,
        // Position within its own angle+range group, so the label can be
        // stacked as well as the marker. 16px of jitter separates two dots
        // fine and does nothing for their names: measured on the real radar,
        // "a wild boar" and "Zdolyn's risen" sit on the same line 16px apart
        // and are 68px and 82px wide, so they overlapped by 27px. The marker
        // is the thing jitter was sized for; the label is three to five times
        // wider than it.
        stack: i,
      })
    })
  }

  // The gallery ring: everyone embedded has no compass position for.
  // Standalone keeps its old hostile-only behaviour — see the `embedded`
  // prop's own doc comment for why allied/people never reach here
  // otherwise.
  const gallery: GalleryEntry[] = embedded
    ? [
        ...galleryFromHostiles,
        ...cards
          .filter((c) => c.deck === 'allied')
          .map((card) => ({ key: card.id, card, detail: 'allied' })),
        ...cards
          .filter((c) => c.deck === 'people')
          .map((card) => ({ key: card.id, card, detail: 'here' })),
      ]
    : []

  const hasFight = positioned.length > 0
  const portraitPx = compact ? 20 : 28
  const dotPx = compact ? 8 : 10

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
          text and pale range rings hold up over a bright snowfield or a
          washed-out real render alike; a radial vignette rather than a flat
          tint so "you", dead center, sits on the darkest point of the
          picture no matter what the room looks like. One treatment for both
          modes now — the compass fills the whole box either way, so there
          is no "empty lower half" to spare from a full scrim any more. */}
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
          frame of reference even before anything is assessed. */}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/40" aria-hidden />
      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border/40" aria-hidden />

      {/* Range rings, in DR's own words, not a generic distance scale — on
          the ring itself now (title, not a spoke label): three concentric
          circles read as "distance" on sight the way a topographic map
          does, and the word is a hover away for whoever wants the game's
          own term for the one they're looking at rather than three lines
          of always-on text competing with everything drawn inside them. */}
      {(['missile', 'pole', 'melee'] as const).map((range) => (
        <div
          key={range}
          className="absolute rounded-full border border-border/60"
          title={`${RANGE_WORD[range]} range`}
          style={{
            left: `${50 - RANGE_RADIUS_PCT[range]}%`,
            top: `${50 - RANGE_RADIUS_PCT[range]}%`,
            width: `${RANGE_RADIUS_PCT[range] * 2}%`,
            height: `${RANGE_RADIUS_PCT[range] * 2}%`,
          }}
        />
      ))}

      {/* The gallery ring itself, furthest out — drawn before its labelled
          spoke text below so the compass's own front/behind/left/right
          labels paint on top where the two would ever cross. */}
      {embedded && (
        <div
          className="absolute rounded-full border border-dashed border-border/35"
          style={{
            left: `${50 - GALLERY_RADIUS_PCT}%`,
            top: `${50 - GALLERY_RADIUS_PCT}%`,
            width: `${GALLERY_RADIUS_PCT * 2}%`,
            height: `${GALLERY_RADIUS_PCT * 2}%`,
          }}
          aria-hidden
        />
      )}

      {/* Facing marker — "in front of you" is up, matching the compass
          every dot on this board is drawn against. Behind/left/right get no
          icon of their own: three more markers on a compass that only ever
          has one meaningful reference direction is noise, and every dot's
          own tooltip already spells its relation out in words ("behind
          you", "flanking") — the one thing worth a permanent icon is which
          way is forward, since that's what every other position is read
          relative to. */}
      <span
        className="absolute left-1/2 top-0 -translate-x-1/2"
        title="Front — the direction you're facing. Everything else on this compass is positioned relative to this."
      >
        <ChevronUp className="h-3 w-3 text-ink-faint" aria-hidden />
        <span className="sr-only">Front</span>
      </span>

      {/* You, at the center — the one fixed point everything else is
          relative to, same as assess itself. An icon, not a portrait — this
          app has never drawn the player character either — and not the
          word "you" printed under it either any more: the center of the
          board, ringed in the accent colour nothing else on it uses, is
          already unambiguous, and the tooltip carries the word for anyone
          who wants it spelled out. */}
      <div
        className="absolute z-10 flex items-center justify-center rounded-full border-2 border-accent bg-surface p-0.5 -translate-x-1/2 -translate-y-1/2"
        style={{ left: '50%', top: '50%' }}
        title="You"
      >
        <User className="h-3 w-3 text-accent" aria-hidden />
      </div>

      {/* The floor, at your feet — squares rather than the round creature
          markers, so a dropped weapon is never mistaken for one more thing
          fighting you. Capped with the rest folded into the last tag's
          tooltip: five is already most of the melee ring's width at the
          radius this cluster sits at, and a real drop pile is not
          uncommon after a fight this board exists for. */}
      {items && items.length > 0 && (
        <>
          {items.slice(0, RADAR_ITEM_CAP).map((name, i) => {
            const n = Math.min(items.length, RADAR_ITEM_CAP)
            const spreadDeg = Math.min(64, (n - 1) * 22)
            const stepDeg = n > 1 ? spreadDeg / (n - 1) : 0
            const angle = 180 + (n > 1 ? (i - (n - 1) / 2) * (spreadDeg / Math.max(n - 1, 1)) : 0)
            const { x, y } = pointOn(angle, 13)
            /*
             * How large the target may be before it reaches its neighbour.
             *
             * The marker is 8px and the button sized to it, so the thing you
             * had to hit was 8x8 - about two millimetres, measured on the
             * real app - and a miss here is not a no-op, it sends a game
             * command. WCAG 2.5.8 puts the floor at 24px, and this app's own
             * design notes worry about players who are not twenty-five.
             *
             * 24 does not fit. These sit on an arc of radius 13% at 22
             * degrees apart, which is 15px between centres on a 300px radar
             * - measured, and why three items landed at cx 971, 986, 1001.
             * Forcing 24 made every neighbouring pair overlap by 9px, and
             * overlapping targets are the worse bug: a stray click stops
             * being nothing and becomes the wrong item taken.
             *
             * So the arc distance is the ceiling and 24px (8% of a 300px
             * radar) the cap. Three items get 15px, roughly double what they
             * had, with no ambiguity anywhere; a single item gets the full
             * 24. Expressed in percent so it holds when the radar is smaller
             * than 300px, which it is inside a narrow dashboard.
             */
            const hitPct = Math.min(8, n > 1 ? 13 * ((stepDeg * Math.PI) / 180) : 100)
            const overflow =
              i === RADAR_ITEM_CAP - 1 && items.length > RADAR_ITEM_CAP
                ? items.length - (RADAR_ITEM_CAP - 1)
                : 0
            const label = overflow > 0 ? `${name}, and ${overflow} more on the floor` : name
            const tooltip = reason ?? `${label} — get ${nounOf(name)}`
            return (
              <button
                key={`${name}-${i}`}
                type="button"
                disabled={!canSend}
                onClick={() => take(name)}
                title={tooltip}
                /* The marker stays 8px; the thing you have to hit does not.
                 * The button sized to its content, so the target was 8x8 -
                 * about two millimetres, measured on the real app - and a
                 * miss here is not a no-op, it sends a game command. WCAG
                 * 2.5.8 puts the floor at 24x24 and this app's own design
                 * notes worry about players who are not twenty-five.
                 *
                 * Centring is unchanged: -translate-*-1/2 is half the
                 * button, so a 24x24 box lands centred on the same point the
                 * 8x8 one did, with the dot centred inside it. */
                className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center disabled:cursor-not-allowed"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  width: `${hitPct}%`,
                  height: `${hitPct}%`,
                }}
              >
                <span className="block h-2 w-2 rounded-sm border border-surface bg-accent shadow hover:brightness-125" />
                <span className="sr-only">{label}</span>
              </button>
            )
          })}
        </>
      )}

      {/* The gallery ring's markers — allied, people, and any hostile the
          compass could not place. Dot or portrait only, never an
          always-visible label: a room can hold more people than a ring of
          text could ever avoid overlapping, and every one of these already
          carries its full detail in its own tooltip. */}
      {gallery.slice(0, GALLERY_CAP).map((g, i) => {
        const n = Math.min(gallery.length, GALLERY_CAP)
        const angle = (i / n) * 360
        const { x, y } = pointOn(angle, GALLERY_RADIUS_PCT)
        const overflow = i === GALLERY_CAP - 1 && gallery.length > GALLERY_CAP ? gallery.length - (GALLERY_CAP - 1) : 0
        const portrait = hasArt(g.card.name, g.card.noun)
        const style = DECK_STYLE[g.card.deck]
        const label = overflow > 0 ? `and ${overflow} more` : null
        return (
          <div
            key={g.key}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
            title={`${g.card.name} — ${g.detail}${label ? `, ${label} in the room` : ''}`}
          >
            {portrait ? (
              // CreatureArt sizes its own width to 100% of whatever it is
              // handed — see its own `frame` class — so a dynamic width
              // (this board's compact/full sizing) has to come from a
              // wrapper div, not a prop CreatureArt does not accept.
              <div style={{ width: portraitPx }}>
                <CreatureArt
                  name={g.card.name}
                  noun={g.card.noun}
                  lore={g.card.lore}
                  height={portraitPx}
                  className={`rounded-full border ${style.text.replace('text-', 'border-')}`}
                />
              </div>
            ) : (
              <span
                className="block rounded-full border border-surface"
                style={{ width: dotPx, height: dotPx, background: `var(--color-${style.band.replace('bg-', '')})` }}
              />
            )}
          </div>
        )
      })}

      {hasFight ? (
        spread.map((p) => {
          const stale =
            p.combatant.enrichedAgeSeconds != null && p.combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS
          const portrait = hasArt(p.card.name, p.card.noun)
          const onYou = p.combatant.target?.toLowerCase() === 'you'
          return (
            <div
              key={p.key}
              className="absolute"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              title={`${p.card.name} — ${p.combatant.relation}, at ${RANGE_WORD[p.combatant.range!]} range${
                p.combatant.target ? `, targeting ${p.combatant.target}` : ''
              }${stale ? ` (last assessed ${p.combatant.enrichedAgeSeconds}s ago)` : ''}`}
            >
              <div className={`absolute -translate-x-1/2 -translate-y-1/2 ${stale ? 'opacity-60' : ''}`}>
                {portrait ? (
                  <div style={{ width: portraitPx }}>
                    <CreatureArt
                      name={p.card.name}
                      noun={p.card.noun}
                      lore={p.card.lore}
                      height={portraitPx}
                      className={`rounded-full border ${onYou ? 'border-danger' : 'border-surface'}`}
                    />
                  </div>
                ) : (
                  <span
                    className={`rounded-full border border-surface ${onYou ? 'animate-pulse bg-danger' : 'bg-warn'}`}
                    style={{ display: 'block', width: dotPx, height: dotPx }}
                  />
                )}
              </div>
            </div>
          )
        })
      ) : !embedded ? (
        <p className="absolute left-1/2 top-1/2 w-32 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-ink-faint">
          Nothing assessed yet
        </p>
      ) : null}
    </div>
  )

  if (embedded) return disc

  const notFighting = galleryFromHostiles.filter((g) => g.detail !== 'unassessed — nobody has checked yet')
  const unassessed = galleryFromHostiles.filter((g) => g.detail === 'unassessed — nobody has checked yet')

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface-raised p-2">
      {disc}

      {(notFighting.length > 0 || unassessed.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1.5 text-xs">
          {notFighting.map(({ card, detail }) => (
            <span key={card.id} className="text-ink-faint" title={detail}>
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
