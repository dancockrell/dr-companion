import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from './CreatureArt'
import { hasArt } from '../../lib/creatureArt'
import type { RoomCombatant } from '../../types'
import type { RoomCard } from '../../lib/cards'

/**
 * The fight, laid out the way `assess` actually describes it — as text at a
 * position, with a real portrait riding along when the pack genuinely has
 * one. An earlier pass put a round art token (or, for anything the bestiary
 * art pipeline has not reached yet — most creatures — a letter-in-a-circle
 * placeholder) at every point on this radar, unconditionally. It looked like
 * a raid-frame add-on borrowed from a different genre of game, and the text
 * a player reading `assess` actually gets was the part that had gone
 * missing. `hasArt` (lib/creatureArt.ts) is the same manifest check
 * RoomChips.tsx uses — never a guess, never the letter fallback CreatureArt
 * draws when asked to render regardless. A marker with no confirmed art
 * stays exactly the dot it was; nothing stands in for a portrait that does
 * not exist.
 *
 * DR's own combat readout is two facts about each opponent, not one: range
 * ("at melee range", "at pole weapon range", "at missile range") and
 * position ("in front of you", "behind you", "flanking", "beside you", "to
 * the left/right of you"). This draws that same map instead of inventing a
 * different one, using the game's own words throughout — "pole weapon", not
 * "polearm"; "missile", not "ranged".
 *
 * Only what assess actually reported gets a position. A creature with no
 * relation, or no range at all, is not guessed onto the radar — it goes in
 * the list below, honestly labelled unassessed or not fighting.
 */

/** Same threshold as RoomChips.tsx — assess data past a minute old is shown
 * softened rather than at full confidence. */
const STALE_AFTER_SECONDS = 60

const RANGE_RADIUS_PCT: Record<'melee' | 'pole' | 'missile', number> = {
  melee: 20,
  pole: 36,
  missile: 48,
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
      const jitter = n > 1 ? (i - (n - 1) / 2) * 16 : 0
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
      <div className="relative mx-auto aspect-square w-full max-w-[300px]">
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
        <span className="absolute left-1/2 top-[2%] -translate-x-1/2 text-xs text-ink-faint/70">
          {RANGE_WORD.missile}
        </span>

        {/* Facing marker — "in front of you" is up, matching the compass
            every dot on this radar is drawn against. */}
        <span className="absolute left-1/2 top-0 -translate-x-1/2 text-xs text-ink-faint/50" aria-hidden>
          ▲ front
        </span>

        {/* You, at the center — the one fixed point everything else is
            relative to, same as assess itself. Text, not a portrait — this
            app has never drawn the player character either. */}
        <div
          className="absolute flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-1/2"
          style={{ left: '50%', top: '50%' }}
        >
          <span className="h-2 w-2 rounded-full border-2 border-accent bg-surface" />
          <span className="text-xs font-semibold text-accent">you</span>
        </div>

        {hasFight ? (
          spread.map((p) => {
            const stale =
              p.combatant.enrichedAgeSeconds != null &&
              p.combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS
            const portrait = hasArt(p.card.name, p.card.noun)
            const onYou = p.combatant.target?.toLowerCase() === 'you'
            return (
              <div
                key={p.key}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 ${
                  stale ? 'opacity-60' : ''
                }`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={`${p.card.name} — ${p.combatant.relation}, at ${RANGE_WORD[p.combatant.range!]} range${
                  p.combatant.target ? `, targeting ${p.combatant.target}` : ''
                }${stale ? ` (last assessed ${p.combatant.enrichedAgeSeconds}s ago)` : ''}`}
              >
                {portrait ? (
                  <CreatureArt
                    name={p.card.name}
                    noun={p.card.noun}
                    lore={p.card.lore}
                    height={28}
                    className={`!w-7 rounded-full border ${onYou ? 'border-danger' : 'border-surface'}`}
                  />
                ) : (
                  <span
                    className={`h-2.5 w-2.5 rounded-full border border-surface ${
                      onYou ? 'animate-pulse bg-danger' : 'bg-warn'
                    }`}
                  />
                )}
                <span
                  className={`whitespace-nowrap rounded bg-surface/90 px-1 text-xs leading-tight shadow ${
                    onYou ? 'font-semibold text-danger' : 'text-ink'
                  }`}
                >
                  {p.card.name}
                  {p.card.count > 1 ? ` x${p.card.count}` : ''}
                  {stale ? ' ⏳' : ''}
                </span>
              </div>
            )
          })
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
