import { CreatureArt } from './CreatureArt'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import type { RoomCombatant } from '../../types'
import type { RoomCard } from '../../lib/cards'

/**
 * The fight, laid out the way `assess` actually describes it.
 *
 * DragonRealms' own combat readout is two facts about each opponent, not
 * one: range ("at melee range", "at pole weapon range", "at missile range")
 * and position ("in front of you", "behind you", "flanking", "beside you",
 * "to the left/right of you"). A player reading assess builds a mental map
 * from exactly those two numbers — this radar draws that same map instead of
 * inventing a different one. The words on it are the game's own: "pole
 * weapon", not "polearm"; "missile", not "ranged". A DR player should
 * recognise this as their own assess, not as a generic MMO raid frame.
 *
 * Only what assess actually reported gets a position. A creature with no
 * relation, or no range at all, is not guessed onto the radar — it goes in
 * the tray below, honestly labelled unassessed or not fighting, because a
 * wrong dot is worse than an admitted gap.
 */

const RANGE_RADIUS_PCT: Record<'melee' | 'pole' | 'missile', number> = {
  melee: 18,
  pole: 33,
  missile: 46,
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

interface Positioned {
  key: string
  card: RoomCard
  combatant: RoomCombatant
  angleDeg: number
  radiusPct: number
}

export function CombatRadar({
  cards,
  combatants,
}: {
  cards: RoomCard[]
  combatants: RoomCombatant[]
}) {
  const index = indexCombatants(combatants)

  const positioned: Positioned[] = []
  const notFighting: { card: RoomCard; combatant: RoomCombatant }[] = []
  const unassessed: RoomCard[] = []

  for (const card of cards) {
    if (card.deck !== 'hostile' || card.status === 'dead') continue
    const combatant = combatantFor(card, index)
    if (!combatant) {
      unassessed.push(card)
      continue
    }
    if (combatant.disengaged || !combatant.range || !combatant.relation) {
      notFighting.push({ card, combatant })
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
  const spread: (Positioned & { x: number; y: number })[] = []
  for (const group of groups.values()) {
    const n = group.length
    group.forEach((p, i) => {
      const jitter = n > 1 ? (i - (n - 1) / 2) * 14 : 0
      const rad = ((p.angleDeg - 90) * Math.PI) / 180
      spread.push({
        ...p,
        x: 50 + p.radiusPct * Math.cos(rad) + jitter,
        y: 50 + p.radiusPct * Math.sin(rad),
      })
    })
  }

  const hasFight = positioned.length > 0

  return (
    <div className="flex flex-col gap-2">
      <div className="relative mx-auto aspect-square w-full max-w-[280px]">
        {/* Range rings, in DR's own words, not a generic distance scale. */}
        {(['missile', 'pole', 'melee'] as const).map((range) => (
          <div
            key={range}
            className="absolute rounded-full border border-border/60"
            style={{
              left: `${50 - RANGE_RADIUS_PCT[range]}%`,
              top: `${50 - RANGE_RADIUS_PCT[range]}%`,
              width: `${RANGE_RADIUS_PCT[range] * 2}%`,
              height: `${RANGE_RADIUS_PCT[range] * 2}%`,
            }}
          />
        ))}
        <span className="absolute left-1/2 top-[4%] -translate-x-1/2 text-[9px] text-ink-faint/70">
          {RANGE_WORD.missile}
        </span>

        {/* Facing marker — "in front of you" is up, matching the compass
            every dot on this radar is drawn against. */}
        <span className="absolute left-1/2 top-0 -translate-x-1/2 text-ink-faint/50" aria-hidden>
          ▲
        </span>

        {/* You, at the center — the one fixed point everything else is
            relative to, same as assess itself. */}
        <div
          className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-accent bg-surface text-[9px] font-bold text-accent"
          style={{ left: '50%', top: '50%' }}
          title="You"
        >
          Y
        </div>

        {hasFight ? (
          spread.map((p) => (
            <div
              key={p.key}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              title={`${p.card.name} — ${p.combatant.relation}, at ${RANGE_WORD[p.combatant.range!]} range${
                p.combatant.target ? `, targeting ${p.combatant.target}` : ''
              }`}
            >
              <CreatureArt
                name={p.card.name}
                noun={p.card.noun}
                lore={p.card.lore}
                height={30}
                className={`!w-[30px] shrink-0 !rounded-full ring-2 ${
                  p.combatant.target?.toLowerCase() === 'you'
                    ? 'ring-danger animate-pulse'
                    : 'ring-warn/70'
                }`}
              />
              <span
                className="pointer-events-none absolute top-full mt-0.5 hidden -translate-x-1/2 whitespace-nowrap rounded bg-surface/95 px-1 text-[10px] text-ink shadow group-hover:block"
                style={{ left: '50%' }}
              >
                {p.card.name}
              </span>
            </div>
          ))
        ) : (
          <p className="absolute left-1/2 top-1/2 w-32 -translate-x-1/2 -translate-y-1/2 text-center text-xs text-ink-faint">
            Nothing assessed yet
          </p>
        )}
      </div>

      {(notFighting.length > 0 || unassessed.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1.5 text-xs">
          {notFighting.map(({ card }) => (
            <span key={card.id} className="text-ink-faint" title="assess reports this one has broken off">
              {card.name} <span className="text-ink-faint/60">(not fighting)</span>
            </span>
          ))}
          {unassessed.map((card) => (
            <span key={card.id} className="text-ink-faint/70" title="nobody has assessed this one yet">
              {card.name} <span className="text-ink-faint/50">(unassessed)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
