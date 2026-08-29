import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from './CreatureArt'
import { hasArt } from '../../lib/creatureArt'
import { nounOf } from '../../lib/room'
import { useRoomItemTake } from '../../lib/useRoomItemTake'
import { RoomBackdrop } from '../room/RoomBackdrop'
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
 *
 * The backdrop is the room itself — `RoomBackdrop`, the same fingerprint or
 * real render `RoomScene` draws for this exact room, not a flat panel of its
 * own. A radar that looks like a different screen than the picture above it
 * reads as a second, unrelated feature; one that looks like the same room
 * with rings drawn over it reads as what it is, the same room, mid-fight.
 * A scrim sits between the two so the rings and names stay legible over
 * whatever the room happens to look like.
 *
 * Floor items ride along too, clustered at your feet (radius ~12%, centered
 * on "behind" since that is straight down on this compass) rather than
 * scattered — `assess` says nothing about where a dropped weapon is lying,
 * so guessing a scattered position for it would claim precision the game
 * never gave. "At your feet" is the one position that is always true.
 */

/** Same threshold as RoomChips.tsx — assess data past a minute old is shown
 * softened rather than at full confidence. */
const STALE_AFTER_SECONDS = 60

/**
 * How many floor items the radar draws directly on the picture, named and
 * exported so BattleColumn.tsx can hand the overflow to a chip list instead
 * of repeating the same items twice. Five is already most of the melee
 * ring's width at the radius this cluster sits at, and a real drop pile is
 * not uncommon after a fight this radar exists for.
 */
export const RADAR_ITEM_CAP = 5

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
   * `RoomColumn` has a room identity to hand (it derives zone from the live
   * zone payload and fetches the room text), and `BattlePanel` does not —
   * making these required broke that call site, and the alternative was
   * duplicating RoomColumn's fetch into a panel that has no business doing
   * it. A caller with no room identity gets the radar without a backdrop,
   * which is what it drew before there was one. Ignored entirely when
   * `embedded` is true — see that prop. */
  zone?: string
  room?: number | null
  title?: string | null
  text?: string | null
  cards: RoomCard[]
  combatants: RoomCombatant[]
  /** The floor, same feed `RoomChips`' "On the floor" group reads. */
  items?: string[]
  /**
   * True when `RoomScene` is passing this in as its own `overlay` — the room
   * picture is already right there, one layer down in the same box, so
   * drawing a second copy of it (this component's own circular backdrop,
   * scaled to a smaller circle inside a square box that already has the
   * full-size original) would put the same room on screen twice at once.
   * Embedded mode skips its own backdrop and the circular frame and fills
   * whatever box it was handed instead, rings and markers only.
   *
   * The "not fighting" / "unassessed" footer drops too, embedded — chips are
   * already sharing this same picture along its bottom edge, and every one
   * of those names is a hostile chip a hover away from the same words this
   * footer would print. `BattlePanel` still gets the footer: it is not
   * standing next to a chip row, so unpositioned hostiles need somewhere to
   * be named or a player watching only the radar would not know they exist.
   */
  embedded?: boolean
}) {
  const index = indexCombatants(combatants)
  const { take, canSend, reason } = useRoomItemTake()

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
  const spread: (Positioned & { x: number; y: number; stack: number })[] = []
  for (const group of groups.values()) {
    const n = group.length
    group.forEach((p, i) => {
      const jitter = n > 1 ? (i - (n - 1) / 2) * 16 : 0
      const rad = ((p.angleDeg - 90) * Math.PI) / 180
      spread.push({
        ...p,
        x: 50 + p.radiusPct * Math.cos(rad) + jitter,
        y: 50 + p.radiusPct * Math.sin(rad),
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

  const hasFight = positioned.length > 0

  const disc = (
    <div
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
            washed-out real render alike.
         *
         * Embedded, this only darkens the top band the compass actually
         * occupies — a top-to-bottom fade rather than the standalone disc's
         * centered vignette, because the compass itself moved to a shorter
         * square pinned at the top (see the wrapper below) and a full-box
         * scrim would keep darkening the now-empty lower half for nothing:
         * the picture has nothing drawn on it there, RoomChips' own gradient
         * already handles its bar's legibility independently, and a big flat
         * dark rectangle between the two read as broken chrome rather than
         * as a fight happening in a lit room. Standalone keeps the radial
         * vignette centered on "you", tuned for that circular presentation. */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: embedded ? '70%' : '100%',
            background: embedded
              ? 'linear-gradient(to bottom, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.42) 55%, transparent 100%)'
              : 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.72) 100%)',
          }}
          aria-hidden
        />

      {/*
       * Embedded, this is a HUD pinned to the top of the picture, not the
       * whole box — RoomScene's chip bar lives along the bottom edge of the
       * exact same box, and the compass used to reach all the way down to
       * it: a "behind you, at missile range" marker sits at radius 48% below
       * center, which is past where a two-row chip strip starts. Measured on
       * the real app with Hostile and People both populated: the chip bar's
       * own top edge landed at 56% down the box, squarely inside where the
       * floor-item cluster, the "pole weapon" and "behind" labels, and any
       * far/rear marker were already drawing. They were not gone, they were
       * painting first and the chip bar was painting over them.
       *
       * A smaller square, pinned to the top and centered horizontally, keeps
       * the compass circular (percentages inside it are of its own square,
       * not the outer box, so a ring stays a ring rather than the ellipse a
       * full-width/half-height box would squash it into) and keeps its
       * lowest possible point — the "behind" label and any dead-behind
       * marker at missile range, both at its own 100% — comfortably above
       * where a chip bar has ever measured starting. Standalone this is a
       * no-op: nothing else shares that box, so it still fills it exactly
       * as it always has.
       */}
      <div
        className={embedded ? 'absolute left-1/2 top-0 -translate-x-1/2' : 'absolute inset-0'}
        style={embedded ? { width: '55%', height: '55%' } : undefined}
      >
        {/* A fixed compass grid, independent of who's actually on it — the
            four rings/spokes this radar can ever place a marker on (angleFor
            only ever returns 0/90/180/270), drawn once so the eye has a
            frame of reference even before anything is assessed. */}
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border/40" aria-hidden />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border/40" aria-hidden />

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

        {/* Each ring labelled on its own spoke, so the scale reads without a
            hover — melee on the near-right spoke, pole below it, missile
            above, each offset enough from the ring above/below it and from
            the front/behind labels not to collide (issue #64 was exactly
            this fight over one corner). */}
        {/* Off the horizontal axis on purpose. This label sat at top 50%, the
          * same line "right" is pinned to at the radar's right edge, and the
          * two only cleared each other because this one was 10px. It is 12px
          * now — DESIGN.md's floor, enforced by tools/contrast-test.mjs — and
          * at 12px they collide on a small radar: the container is
          * `min-w-[13rem]` inside BattlePanel, so 208px is reachable, and
          * there "melee" spans 152→184px while "right" starts at ~180px.
          *
          * Raising it to 38% puts it between the melee and pole rings, clear
          * of the axis the flank labels own, and keeps the vertical spacing
          * against missile (3%) and pole (92%) that issue #64 established. */}
        <span
          className="absolute text-xs text-ink-faint"
          style={{ left: `${50 + RANGE_RADIUS_PCT.melee + 3}%`, top: '38%' }}
        >
          {RANGE_WORD.melee}
        </span>
        <span className="absolute left-[62%] top-[3%] text-xs text-ink-faint">{RANGE_WORD.missile}</span>
        <span className="absolute bottom-[8%] left-[62%] text-xs text-ink-faint">{RANGE_WORD.pole}</span>

        {/* Facing marker — "in front of you" is up, matching the compass
            every dot on this radar is drawn against — with its opposite and
            the two flanks labelled too, since assess only ever reports these
            four positions and a reader should not have to infer the other
            three from the one that is spelled out. */}
        <span className="absolute left-1/2 top-0 -translate-x-1/2 text-xs text-ink-faint" aria-hidden>
          ▲ front
        </span>
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-ink-faint" aria-hidden>
          behind
        </span>
        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-xs text-ink-faint" aria-hidden>
          left
        </span>
        <span className="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-ink-faint" aria-hidden>
          right
        </span>

        {/* You, at the center — the one fixed point everything else is
            relative to, same as assess itself. Text, not a portrait — this
            app has never drawn the player character either. */}
        <div
          className="absolute z-10 flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-1/2"
          style={{ left: '50%', top: '50%' }}
        >
          <span className="h-2 w-2 rounded-full border-2 border-accent bg-surface" />
          <span className="text-xs font-semibold text-accent">you</span>
        </div>

        {/* The floor, at your feet — squares rather than the round creature
            markers, so a dropped weapon is never mistaken for one more thing
            fighting you. Capped at five with the rest folded into the last
            tag's tooltip: five is already most of the melee ring's width at
            the radius this cluster sits at, and a real drop pile is not
            uncommon after a fight this radar exists for. */}
        {items && items.length > 0 && (
          <>
            {items.slice(0, RADAR_ITEM_CAP).map((name, i) => {
              const n = Math.min(items.length, RADAR_ITEM_CAP)
              const spreadDeg = Math.min(64, (n - 1) * 22)
              const stepDeg = n > 1 ? spreadDeg / (n - 1) : 0
              const angle = 180 + (n > 1 ? (i - (n - 1) / 2) * (spreadDeg / Math.max(n - 1, 1)) : 0)
              const rad = ((angle - 90) * Math.PI) / 180
              const radiusPct = 13
              const x = 50 + radiusPct * Math.cos(rad)
              const y = 50 + radiusPct * Math.sin(rad)
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
              const hitPct = Math.min(8, n > 1 ? radiusPct * ((stepDeg * Math.PI) / 180) : 100)
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
                    // See hitPct. Centring is unchanged either way:
                    // -translate-*-1/2 is half the button, so the box lands
                    // centred on the same point the 8x8 one did, with the
                    // marker centred inside it.
                    width: `${hitPct}%`,
                    height: `${hitPct}%`,
                  }}
                >
                  <span className="block h-2 w-2 rounded-sm border border-surface bg-accent shadow hover:brightness-125" />
                  <span className="sr-only">{label}</span>
                </button>
              )
            })}
            <span
              className="absolute -translate-x-1/2 text-xs text-ink-faint"
              style={{ left: '50%', top: '69%' }}
              aria-hidden
            >
              floor
            </span>
          </>
        )}

        {hasFight ? (
          spread.map((p) => {
            const stale =
              p.combatant.enrichedAgeSeconds != null &&
              p.combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS
            const portrait = hasArt(p.card.name, p.card.noun)
            const onYou = p.combatant.target?.toLowerCase() === 'you'
            // A name tag centered under its marker extends equally in both
            // directions - fine near the middle of the radar, but a
            // due-left/right missile-range creature sits close enough to the
            // frame edge (radius 48%) that half a longer name ("Zdolyn's
            // risen") runs straight off it. See issue #64: measured, not
            // eyeballed - real name tags escaping the radar's own frame on
            // an entirely ordinary assess result, not a contrived case.
            //
            // Fix is to anchor the tag's near edge to the marker and let it
            // grow toward the center instead, which is always the side with
            // room - rather than estimating each name's rendered width to
            // clamp a centered position, which would need remeasuring every
            // time a font or size changes. The marker itself (this div,
            // sized to nothing but its own icon) is unaffected: it stays
            // exactly on the computed x/y point either way.
            const labelSide = p.x < 40 ? 'left-0' : p.x > 60 ? 'right-0' : 'left-1/2 -translate-x-1/2'
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
                </div>
                {/* Width-capped, because these are absolutely positioned and
                  * `whitespace-nowrap` on its own lets one long name run as
                  * wide as it likes across a 300px radar. Measured: "an Adan
                  * blood warrior" is 133px at 12px type, 44% of the radar, and
                  * three of those overlapping is not a reading of a fight.
                  *
                  * These were 9px until DESIGN.md's floor was applied - it
                  * sets 12px and says the tension with density "resolves in
                  * favour of legibility", which is right, and is exactly why
                  * the width needs a ceiling now: larger type with no cap
                  * turns a legibility fix into a collision. The full name is
                  * already on the parent's title, so a clipped tail costs
                  * nothing that was not already a hover away. */}
                <span
                  className={`absolute max-w-[8rem] truncate rounded bg-surface/90 px-1 text-xs leading-tight shadow ${labelSide} ${
                    stale ? 'opacity-60' : ''
                  } ${onYou ? 'font-semibold text-danger' : 'text-ink'}`}
                  // Stacked, not just jittered. Everything in one angle+range
                  // group shared a single line, so names wider than the 16px
                  // of horizontal jitter - which is all of them - landed on
                  // top of each other. One line each instead: 12px below the
                  // marker, then 16px per position in the group.
                  style={{ top: 12 + p.stack * 16 }}
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
      </div>
  )

  if (embedded) return disc

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface-raised p-2">
      {disc}

      {(notFighting.length > 0 || unassessed.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-1.5 text-xs">
          {notFighting.map(({ card }) => (
            <span key={card.id} className="text-ink-faint" title="assess reports this one has broken off">
              {card.name} <span className="text-ink-faint">(not fighting)</span>
            </span>
          ))}
          {unassessed.map((card) => (
            <span key={card.id} className="text-ink-faint" title="nobody has assessed this one yet">
              {card.name} <span className="text-ink-faint">(unassessed)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
