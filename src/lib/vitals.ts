/**
 * The five pools, as a plain derivation - split out of VitalCluster.tsx so it
 * can be imported by a test without dragging JSX through Node's loader.
 *
 * See VitalCluster.tsx for what each choice below is for; this file only
 * holds the parts with no rendering in them.
 */
import type { CharacterStatus } from '../types'
import type { StreamVitals } from '../types/stream'

export interface Vital {
  key: string
  /** @deprecated kept so a caller still holding a hand-written array compiles. */
  glyph?: string
  tone?: 'health' | 'mana' | 'stamina' | 'spirit' | 'concentration'
  label: string
  value: number
  max: number
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

export function hasManaPool(guild: string | undefined, mana: number): boolean {
  const g = (guild ?? '').toLowerCase()
  if (MANA_GUILDS.has(g)) return true
  if (NO_MANA_GUILDS.has(g)) return false
  return mana > 0
}

/**
 * Below this share of max health, the app treats the character as needing a
 * healer rather than more fighting or training.
 *
 * One constant rather than the same `health / healthMax < 0.35` written out
 * independently in `SafetyFooter.tsx` (which button the safety bar offers)
 * and `SituationBanner.tsx` (whether the urgent banner shows) - two copies
 * that happened to agree by having been typed the same way twice, which is
 * exactly the kind of duplication that silently stops agreeing the next time
 * either one gets tuned. Not the same number as `VitalCluster`'s colour
 * bands: those apply one ramp to all five pools as a glance-only cue: this
 * one is specifically about health and specifically about triggering the
 * Healer flow, a different question that happens to share a threshold today.
 */
export const LOW_HEALTH_SHARE = 0.35

export function isLowHealth(character: CharacterStatus | null | undefined): boolean {
  if (!character) return false
  const { health, healthMax } = character.vitals
  return healthMax > 0 && health / healthMax < LOW_HEALTH_SHARE
}

/**
 * Stream over bridge, when the stream has an answer.
 *
 * Both sources know health, mana, spirit and stamina - the bridge polls for
 * them, and the stream carries them unasked on every `progressBar` tick. The
 * stream wins here rather than the bridge, and it is a real choice rather
 * than a default: `src/types/stream.ts` documents that stream-fed state
 * "keeps working when the bridge drops, which the logs show is not rare," so
 * a vitals row that prefers the bridge goes blank in exactly the failure this
 * client is supposed to survive. The bridge stays the fallback for whatever
 * the stream has not reported yet (concentration is never in `StreamVitals`
 * at all - DragonRealms does not send it as a `progressBar` - so it is
 * always bridge-only).
 */
function pick(
  key: keyof StreamVitals,
  streamVitals: StreamVitals | undefined,
  bridgeValue: number,
  bridgeMax: number
): { value: number; max: number } {
  const s = streamVitals?.[key]
  return s ? { value: s.current, max: s.max } : { value: bridgeValue, max: bridgeMax }
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
export function vitalsFor(
  character: CharacterStatus | null | undefined,
  streamVitals?: StreamVitals
): Vital[] {
  if (!character) return []
  const v = character.vitals

  const health = pick('health', streamVitals, v.health, v.healthMax)
  const out: Vital[] = [{ key: 'health', label: 'Health', ...health }]

  if (hasManaPool(character.guild, v.mana ?? 0)) {
    const mana = pick('mana', streamVitals, v.mana ?? 0, v.manaMax ?? 100)
    out.push({ key: 'mana', label: 'Mana', ...mana })
  }

  // `fatigue` on the wire, stamina everywhere a player will ever have read it.
  // Lich's field name is not the game's word and the label follows the game.
  // The stream calls the same bar `stamina`, so no translation is needed on
  // that side.
  const stamina = pick('stamina', streamVitals, v.fatigue, v.fatigueMax)
  out.push({ key: 'stamina', label: 'Stamina', ...stamina })

  const spirit = pick('spirit', streamVitals, v.spirit, v.spiritMax)
  out.push({ key: 'spirit', label: 'Spirit', ...spirit })

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
