import { cn } from '../../lib/cn'
import type { CharacterStatus } from '../../types'

/**
 * The five pools, thin.
 *
 * This was a row of tall mixer columns with single-letter caps, and it was
 * wrong twice over. It showed H, S and F for Health, Spirit and Fatigue, which
 * is not the set of vitals this game has and not the names it calls them: the
 * Simutronics stream carries five bars, health, mana, stamina, spirit and
 * concentration, and `DRStats.fatigue` is the one behind the bar the game
 * labels stamina. So a player read S and got spirit where every other window
 * they own means stamina, and F for a bar with no F in its name. Mana was not
 * drawn at all although it arrived on every tick.
 *
 * The second thing wrong was the ceremony. Vitals are a glance, not a feature.
 * A tall column with a dashed danger notch and a percentage cap spent real
 * estate and ink arguing for its own importance while failing to say which
 * vital it was. One thin line each, the word, the bar, the number.
 *
 * **Why the bars are coloured, since that has to be answerable.** One ramp
 * across all five: green while there is plenty, amber when it is getting low,
 * red when it is nearly gone. Not a hue per vital. A hue per vital is
 * decoration, because the label already says which one it is, and it costs the
 * only channel that could answer the single question anybody asks of this
 * widget, which is *which pool is running out*. With one ramp a wall of green
 * means nothing needs you, and one red line is findable without reading a word.
 *
 * Colour never carries it alone. The bar's length and the number say the same
 * thing, so the reading survives a colour deficiency or a bad monitor.
 *
 * Nothing here drops below 12px. See docs/DESIGN.md §1.5.
 */
export interface Vital {
  key: string
  /**
   * Retained so callers still holding a hand-written array compile while they
   * move to `vitalsFor`. It no longer picks a colour: see the note above.
   */
  glyph?: string
  tone?: 'health' | 'mana' | 'stamina' | 'spirit' | 'concentration'
  label: string
  value: number
  max: number
}

/**
 * The ramp, with the reason each band exists written down beside it.
 *
 * The thresholds are the same for all five because the consequence is the same
 * shape in every case: a pool near empty stops you doing the thing it pays
 * for. What that thing is differs, which is what the label is for.
 */
const BANDS: Array<{ upTo: number; fill: string; ink: string; why: string }> = [
  { upTo: 0.15, fill: 'bg-danger', ink: 'text-danger', why: 'nearly gone' },
  { upTo: 0.35, fill: 'bg-warn', ink: 'text-warn', why: 'low' },
  { upTo: 1, fill: 'bg-good', ink: 'text-ink-muted', why: 'fine' },
]

function band(share: number) {
  return BANDS.find((b) => share <= b.upTo) ?? BANDS[BANDS.length - 1]
}

/**
 * What each pool costs you when it empties. Shown on hover, because the answer
 * is not obvious for three of the five and is the whole reason to look.
 */
const MEANS: Record<string, string> = {
  health: 'runs out and you die',
  mana: 'runs out and spells will not cast',
  stamina: 'runs out and you cannot swing, run or stand',
  spirit: 'runs out and a death costs full price',
  concentration: 'runs out and you cannot hold what you are maintaining',
}

/**
 * Guilds that have a mana pool, and guilds that do not.
 *
 * Two explicit lists rather than one, because "not in the list" has to mean
 * something different from "known to have none". A Barbarian burns inner fire
 * and a Thief spends khri; neither has mana and both report a permanent zero,
 * so drawing them an empty line every second of every session is a reading
 * that never reads anything.
 *
 * An unknown guild falls through to the value itself: draw it if there is
 * something in it. Guild arrives on the first status payload, so that fallback
 * only covers the moment before we know who we are talking to.
 */
const MANA_GUILDS = new Set([
  'bard',
  'cleric',
  'empath',
  'moon_mage',
  'necromancer',
  'paladin',
  'ranger',
  'warrior_mage',
])
const NO_MANA_GUILDS = new Set(['barbarian', 'thief', 'trader', 'commoner'])

function hasManaPool(guild: string | undefined, mana: number): boolean {
  const g = (guild ?? '').toLowerCase()
  if (MANA_GUILDS.has(g)) return true
  if (NO_MANA_GUILDS.has(g)) return false
  return mana > 0
}

/**
 * Every vital the character actually reports, derived rather than hand-listed.
 *
 * This exists because of the specific way mana went missing. It was in the
 * payload from the first version of the bridge and it had a field on the type,
 * but the two places that draw a cluster each wrote their own literal array,
 * and neither array mentioned it. Nothing broke and no check failed. Mana
 * simply arrived every second and was never asked for.
 *
 * A caller that has to remember which vitals exist will forget one again, so
 * callers no longer decide. They hand over the character and get the pools that
 * character has.
 *
 * Order is the game's own bar order, so it matches the client the player
 * already has open beside this one.
 *
 * Concentration and mana are both conditional, for the same reason by different
 * tests. Concentration exists only for some guilds and the bridge omits
 * `concentrationMax` when there is none, so the max is the test. Mana is always
 * sent with a max of 100 whether or not there is a pool behind it, so the max
 * cannot be the test and the guild has to be.
 */
export function vitalsFor(character: CharacterStatus | null | undefined): Vital[] {
  if (!character) return []
  const v = character.vitals

  const out: Vital[] = [
    { key: 'health', label: 'Health', value: v.health, max: v.healthMax },
  ]

  if (hasManaPool(character.guild, v.mana ?? 0)) {
    out.push({ key: 'mana', label: 'Mana', value: v.mana ?? 0, max: v.manaMax ?? 100 })
  }

  // `fatigue` on the wire, stamina everywhere a player will ever have read it.
  // Lich's field name is not the game's word and the label follows the game.
  out.push({ key: 'stamina', label: 'Stamina', value: v.fatigue, max: v.fatigueMax })
  out.push({ key: 'spirit', label: 'Spirit', value: v.spirit, max: v.spiritMax })

  if (v.concentrationMax) {
    out.push({
      key: 'concentration',
      label: 'Conc',
      value: v.concentration ?? 0,
      max: v.concentrationMax,
    })
  }

  return out
}

export function VitalCluster({
  vitals,
}: {
  vitals: Vital[]
  /**
   * Accepted and ignored. The old cluster was a fixed-height column and callers
   * sized it; these are lines and they size themselves. Kept in the signature
   * so a caller still passing it compiles.
   */
  height?: number
}) {
  return (
    /*
     * A floor, so this wraps instead of collapsing.
     *
     * It was `min-w-0 flex-1`, which in the dashboard's right rail meant the
     * portrait and the paperdoll took 232px of a 240px column and the vitals
     * were squeezed into what was left. The row is `flex-wrap` and would have
     * wrapped them onto their own line - but `min-w-0` tells flexbox this may
     * shrink to nothing, so it shrank rather than wrapped.
     *
     * On screen that was five labels sliced to "Heal", "Man", "Stam" with
     * every number cut off entirely. Health, mana, stamina, spirit and
     * concentration, all invisible, on the panel whose whole job is to say how
     * much of each you have left.
     *
     * It survived because `innerText` still reported the numbers, so every
     * check that read text passed. It took rendering the page and looking at
     * it. See tools/look.mjs.
     *
     * 8.5rem is the width of the widest row this draws: a 3.5rem label, a
     * 2.5rem number, the gaps, and enough bar left to read as a bar.
     */
    <div className="flex min-w-[8.5rem] flex-1 flex-col gap-0.5">
      {vitals.map((v) => {
        const share = v.max > 0 ? Math.max(0, Math.min(1, v.value / v.max)) : 0
        const pct = Math.round(share * 100)
        const b = band(share)

        /**
         * Percentages for the pools that are percentages, real numbers for the
         * pools that are not.
         *
         * Four of the five arrive from the game already as a percentage, so
         * their maximum is 100 and this column is both the value and the
         * share. Concentration is not one of them: the game sends it as a
         * quantity, and a Circle 1 Bard has 330 of it.
         *
         * Rendered as a percentage, a full Bard read "100" - true, useless,
         * and indistinguishable from health. Bards spend concentration in
         * fixed amounts per song, so the question being asked of this row is
         * *how much have I got*, not *what fraction is left*. A percentage
         * cannot answer that; the number answers both, because the bar beside
         * it already draws the share.
         *
         * The test is the maximum, not the guild and not the key. A pool whose
         * maximum is 100 is a percentage and says so; anything else is a
         * quantity. That keeps this right for whichever pool turns out next
         * not to be a percentage, with no list for anybody to maintain.
         */
        const shown = v.max === 100 ? pct : v.value

        return (
          <div
            key={v.key}
            className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-1.5"
            title={`${v.label}: ${v.value} of ${v.max}, ${b.why}. It ${MEANS[v.key] ?? 'is a pool'}.`}
          >
            <span className="truncate text-xs leading-none text-ink-muted">{v.label}</span>

            <span className="h-1.5 min-w-0 overflow-hidden rounded-sm bg-surface-overlay">
              <span
                className={cn('block h-full transition-[width] duration-300', b.fill)}
                style={{ width: `${pct}%` }}
              />
            </span>

            <span className={cn('text-right text-xs leading-none tabular-nums', b.ink)}>
              {shown}
            </span>
          </div>
        )
      })}
    </div>
  )
}
