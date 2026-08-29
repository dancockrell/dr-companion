import { useEffect, useRef, useState } from 'react'
import {
  Box,
  ChevronUp,
  Coins,
  Gem,
  Package,
  ScrollText,
  Skull,
  User,
  Wand2,
} from 'lucide-react'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from './CreatureArt'
import { hasArt } from '../../lib/creatureArt'
import { playerArtFor, notePlayerArtMissing } from '../../lib/playerArt'
import { nounOf } from '../../lib/room'
import { useRoomItemTake } from '../../lib/useRoomItemTake'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { RoomBackdrop } from '../room/RoomBackdrop'
import { DECK_STYLE, type Deck } from '../../lib/cards'
import type { RoomCombatant } from '../../types'
import type { RoomCard } from '../../lib/cards'

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
 *     literally standing in that corner of the room.
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

/**
 * How many floor items the board draws directly on the picture, named and
 * exported so callers elsewhere can reason about the cap. Every item still
 * gets a puck; past this many, the rest fold into the last puck's tooltip
 * the same way an overcrowded corner does.
 */
export const RADAR_ITEM_CAP = 6

/** Same idea, per corner — a room can hold more mobs, PCs or NPCs than a
 * 2x3 grid of pucks can hold without either overlapping or shrinking past
 * usefulness. Capped, with the rest folded into the last puck's tooltip. */
const CORNER_CAP = 6

/** Below this measured width, pucks shrink too, so a marker never claims
 * more of a tiny board than the gap between two of them can afford.
 * Nothing on this board ever prints an always-visible name, so this is the
 * only responsive threshold left: marker size, not label visibility. */
const COMPACT_MIN_PX = 160

/**
 * Melee wide, pole and missile progressively tighter — see the module doc
 * comment for why. Together they still leave the four corners real room:
 * the farthest ring (missile, 38%) is nowhere near the corner anchors at
 * 7%/93%, whose diagonal distance from center is about 61%.
 */
const RANGE_RADIUS_PCT: Record<'melee' | 'pole' | 'missile', number> = {
  melee: 24,
  pole: 31,
  missile: 37,
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

/** A point on the unit circle, in this board's own convention: 0° is
 * straight up ("front"), clockwise. */
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

/** Everyone the compass has no position for, drawn in a corner instead:
 * mobs not currently advancing, allied, and people. */
interface CornerEntry {
  key: string
  card: RoomCard
  combatant?: RoomCombatant
}

/**
 * Where each of the four corners lives and which way it grows. A circle
 * inscribed in a square leaves its corners empty at any radius, so this is
 * real space, not space carved out of the compass — see the module doc
 * comment. `dx`/`dy` are which direction (`+1` toward the middle, `-1` away)
 * each successive puck in that corner steps, so a top-left corner's grid
 * grows right-and-down while a bottom-right one grows left-and-up: every
 * corner's own grid stays anchored to its actual corner instead of drifting
 * toward the board's center as it fills up.
 */
const CORNERS: Record<Deck, { x: number; y: number; dx: number; dy: number; label: string; presence: string }> = {
  hostile: { x: 7, y: 7, dx: 1, dy: 1, label: 'Mobs', presence: 'unassessed' },
  people: { x: 93, y: 7, dx: -1, dy: 1, label: 'PCs', presence: 'here' },
  allied: { x: 7, y: 93, dx: 1, dy: -1, label: 'NPCs', presence: 'allied' },
}

const ITEM_CORNER = { x: 93, y: 93, dx: -1, dy: -1, label: 'Items' }

const CORNER_COLS = 2
// Tight on purpose — these are bigger pucks now (see portraitPx/cornerPx
// below) and a crowded corner reads better as a cluster of icons than as a
// grid with daylight between every one of them.
const CORNER_STEP = 9

function cornerPoint(corner: { x: number; y: number; dx: number; dy: number }, index: number) {
  const col = index % CORNER_COLS
  const row = Math.floor(index / CORNER_COLS)
  return { x: corner.x + corner.dx * col * CORNER_STEP, y: corner.y + corner.dy * row * CORNER_STEP }
}

/**
 * A generic-but-good icon for a floor item, guessed from its name the same
 * way a player glances at a pile and knows "that's coins" without reading a
 * label. Only a handful of keywords get their own icon — the things people
 * actually dig through a corpse for — everything else gets the same plain
 * "pile of something" icon rather than a wrong specific guess. Nothing here
 * is a claim about what the item actually is beyond what its own name
 * already says; the full name is still the tooltip.
 */
function iconForItem(name: string) {
  const n = name.toLowerCase()
  if (/\bcoins?\b|\bkronars?\b|\blirums?\b|\bdokoras?\b/.test(n)) return Coins
  if (/\bgems?\b|\bjewels?\b|\bstones?\b/.test(n)) return Gem
  if (/\bbox\b|\bchest\b|\bcrate\b|\bcase\b/.test(n)) return Box
  if (/\bcorpse\b|\bskull\b|\bbones?\b/.test(n)) return Skull
  if (/\bscroll\b|\bletter\b|\bnote\b|\bbook\b/.test(n)) return ScrollText
  if (/\bwand\b|\bstaff\b|\borb\b/.test(n)) return Wand2
  return Package
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
}: {
  name: string
  url: string
  height: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-surface-overlay ${className ?? ''}`}
      style={{ height }}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
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

/** One puck: a real portrait when the bestiary has one, a submitted player
 * picture when the bestiary doesn't but the person does, otherwise a
 * coloured dot — never a guess dressed as either. Shared by the compass
 * and the four corners so a goblin looks like the same goblin everywhere
 * it can appear on this board. */
function Puck({
  card,
  px,
  ringClass,
  pulse,
}: {
  card: RoomCard
  px: number
  ringClass: string
  pulse?: boolean
}) {
  // A person's own submitted picture, checked only for the people deck and
  // only before falling back to the bestiary lookup — a hostile or an
  // allied summon is never a candidate for this, so there is no path by
  // which a creature could borrow a player's art or a player's name could
  // accidentally resolve to bestiary art.
  const own = card.deck === 'people' ? playerArtFor(card.name) : undefined
  const bestiary = !own && hasArt(card.name, card.noun)

  if (own) {
    return (
      <div style={{ width: px }}>
        <PlayerPortrait name={own.name} url={own.url} height={px} className={`border ${ringClass}`} />
      </div>
    )
  }
  if (bestiary) {
    return (
      <div style={{ width: px }}>
        <CreatureArt
          name={card.name}
          noun={card.noun}
          lore={card.lore}
          height={px}
          className={`rounded-full border ${ringClass}`}
        />
      </div>
    )
  }
  const style = DECK_STYLE[card.deck]
  return (
    <span
      className={`block rounded-full border border-surface ${pulse ? 'animate-pulse' : ''}`}
      style={{ width: px, height: px, background: `var(--color-${style.band.replace('bg-', '')})` }}
    />
  )
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
  /** Everyone in the room, every deck — hostile for the compass and the
   * mobs corner, all three for their corners when `embedded`. `BattlePanel`
   * (standalone) still passes hostile only; it keeps its own allied/people
   * decks below the radar rather than adopting the corners, so handing it
   * more decks would just show them twice. */
  cards: RoomCard[]
  combatants: RoomCombatant[]
  /** The floor — every item gets its own puck in the items corner now,
   * capped the same way the other three corners are. */
  items?: string[]
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
  const { take, canSend: canTake, reason: takeReason } = useRoomItemTake()
  const { run: runMacro, canSend: canAttack, reason: attackReason } = useMacroRunner()
  const { ref: boardRef, width: boardWidth } = useMeasuredWidth()
  const compact = boardWidth > 0 && boardWidth < COMPACT_MIN_PX

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

  // Spread anything sharing the exact same angle+range apart a little, so
  // two creatures both "flanking" at melee range do not sit on top of each
  // other — the ring most likely to hold several at once got the extra
  // radius above for exactly this reason.
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
    group.forEach((p, i) => {
      const jitter = n > 1 ? (i - (n - 1) / 2) * 10 : 0
      const { x, y } = pointOn(p.angleDeg, p.radiusPct)
      spread.push({ ...p, x: x + jitter, y })
    })
  }

  // The three corners: everyone embedded has no compass position for.
  // Standalone keeps its old hostile-only behaviour — see the `embedded`
  // prop's own doc comment for why allied/people never reach here
  // otherwise.
  const cornerEntries: Record<Deck, CornerEntry[]> = embedded
    ? {
        hostile: cornerHostiles,
        allied: cards.filter((c) => c.deck === 'allied').map((card) => ({ key: card.id, card })),
        people: cards.filter((c) => c.deck === 'people').map((card) => ({ key: card.id, card })),
      }
    : { hostile: [], allied: [], people: [] }

  const hasFight = positioned.length > 0
  const portraitPx = compact ? 30 : 42
  const dotPx = compact ? 14 : 18
  const cornerPx = compact ? 26 : 36

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
          frame of reference even before anything is assessed. */}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/40" aria-hidden />
      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border/40" aria-hidden />

      {/* Range rings, in DR's own words, not a generic distance scale — a
          title rather than a spoke label: three concentric circles read as
          "distance" on sight the way a topographic map does, and the word
          is a hover away for whoever wants the game's own term for the one
          they're looking at. Melee is the widest of the three — see
          RANGE_RADIUS_PCT's own comment — to leave room for flanking
          without crowding pole and missile out or eating the corners. */}
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

      {/* Facing marker — "in front of you" is up, matching the compass
          every puck on this board is drawn against. Behind/left/right get
          no icon of their own: three more markers on a compass that only
          ever has one meaningful reference direction is noise, and every
          puck's own tooltip already spells its relation out in words
          ("behind you", "flanking") — the one thing worth a permanent icon
          is which way is forward, since that's what every other position
          is read relative to. */}
      <span
        className="absolute left-1/2 top-0 -translate-x-1/2"
        title="Front — the direction you're facing. Everything else on this compass is positioned relative to this."
      >
        <ChevronUp className="h-3 w-3 text-ink-faint" aria-hidden />
        <span className="sr-only">Front</span>
      </span>

      {/* You, at the center — the one fixed point everything else is
          relative to, same as assess itself. An icon, not a portrait — this
          app has never drawn the player character either — ringed in the
          accent colour nothing else on the board uses, so the center is
          unambiguous without a word under it. */}
      <div
        className="absolute z-10 flex items-center justify-center rounded-full border-2 border-accent bg-surface p-0.5 -translate-x-1/2 -translate-y-1/2"
        style={{ left: '50%', top: '50%' }}
        title="You"
      >
        <User className="h-3 w-3 text-accent" aria-hidden />
      </div>

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
                style={{ left: `${p.x}%`, top: `${p.y}%`, width: Math.max(24, portraitPx), height: Math.max(24, portraitPx) }}
                title={`${p.card.name} — ${detailFor(p.card, p.combatant, '')}\n${attackTitle('Attack')}`}
              >
                <Puck card={p.card} px={portraitPx} ringClass={onYou ? 'border-danger' : 'border-surface'} pulse={onYou} />
              </button>
            )
          })
        : !embedded && (
            <p className="absolute left-1/2 top-1/2 w-32 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-ink-faint">
              Nothing assessed yet
            </p>
          )}

      {/* The four corners: mobs not currently advancing, PCs, NPCs, and the
          floor, each grouped in the corner a circle inscribed in this
          square board always leaves empty. See CORNERS' own comment for
          why each grid grows the direction it does. A mob corner puck is
          also an attack button — closing the gap and swinging is one
          click, same as the compass; PCs, NPCs and items are not (nothing
          here should send a command against a person by accident). */}
      {embedded &&
        (Object.keys(CORNERS) as Deck[]).map((deck) => {
          const corner = CORNERS[deck]
          const entries = cornerEntries[deck]
          const shown = entries.slice(0, CORNER_CAP)
          const overflow = entries.length > CORNER_CAP ? entries.length - (CORNER_CAP - 1) : 0
          return shown.map((entry, i) => {
            const { x, y } = cornerPoint(corner, i)
            const isLast = i === shown.length - 1
            const detail = detailFor(entry.card, entry.combatant, corner.presence)
            const overflowNote = isLast && overflow > 0 ? ` — and ${overflow} more ${corner.label.toLowerCase()}` : ''
            const dead = entry.card.status === 'dead'
            // A corpse is not a target — attacking it is not a command DR
            // has any use for. Still a puck (see the loop above), just not
            // a button: dimmed, tooltip only, the same treatment items and
            // the other two corners already get.
            const clickable = deck === 'hostile' && !dead
            const body = (
              <Puck card={entry.card} px={cornerPx} ringClass="border-surface" pulse={false} />
            )
            const commonStyle = { left: `${x}%`, top: `${y}%`, opacity: dead ? 0.55 : undefined }
            if (clickable) {
              return (
                <button
                  key={entry.key}
                  type="button"
                  disabled={!canAttack}
                  onClick={attack}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full disabled:cursor-not-allowed"
                  style={{ ...commonStyle, width: Math.max(24, cornerPx), height: Math.max(24, cornerPx) }}
                  title={`${entry.card.name} — ${detail}${overflowNote}\n${attackTitle('Attack')}`}
                >
                  {body}
                </button>
              )
            }
            return (
              <div
                key={entry.key}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={commonStyle}
                title={`${entry.card.name} — ${detail}${overflowNote}`}
              >
                {body}
              </div>
            )
          })
        })}

      {/* The floor — its own corner now, the same as the other three,
          rather than clustered at your feet: an item is exactly as
          "somewhere in this room, not precisely located" as an NPC assess
          never positioned, so it gets the same honest treatment instead of
          a claim ("at your feet") this app was never actually told. Each
          puck is an icon guessed from the item's own name (see
          `iconForItem`) rather than a bare dot — a generic "pile" shape for
          anything unrecognised, a specific one for the handful of things a
          player is actually digging through a corpse for. */}
      {items &&
        items.length > 0 &&
        items.slice(0, RADAR_ITEM_CAP).map((name, i) => {
          const shownCount = Math.min(items.length, RADAR_ITEM_CAP)
          const { x, y } = cornerPoint(ITEM_CORNER, i)
          const isLast = i === shownCount - 1
          const overflow = items.length > RADAR_ITEM_CAP ? items.length - (RADAR_ITEM_CAP - 1) : 0
          const label = isLast && overflow > 0 ? `${name}, and ${overflow} more on the floor` : name
          const tooltip = takeReason ?? `${label} — get ${nounOf(name)}`
          const Icon = iconForItem(name)
          return (
            <button
              key={`${name}-${i}`}
              type="button"
              disabled={!canTake}
              onClick={() => take(name)}
              title={tooltip}
              /* 24x24 minimum hit target (WCAG 2.5.8) even though the puck
                 itself is smaller — a miss here is not a no-op, it sends a
                 game command. Centring unchanged either way:
                 -translate-*-1/2 is half the button, so it lands centred
                 on the same point regardless of which size wins. */
              className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-surface bg-surface-overlay shadow hover:brightness-125 disabled:cursor-not-allowed"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                width: Math.max(24, cornerPx),
                height: Math.max(24, cornerPx),
              }}
            >
              <Icon className="text-accent" style={{ width: dotPx, height: dotPx }} aria-hidden />
              <span className="sr-only">{label}</span>
            </button>
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
