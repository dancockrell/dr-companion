/**
 * What the game's own XML stream carries, and where a value came from.
 *
 * Lich sends this app more than it has ever read. Because the frontend
 * declares an XML capability, the raw wire carries vitals, status icons, the
 * compass and room components — and the app has been polling the bridge for
 * the same facts instead. Stream-fed state is the game's own word and it keeps
 * working when the bridge drops, which the logs show is not rare.
 *
 * These types exist to make three measured traps unrepresentable rather than
 * commented. All three were established from Lich's own source
 * (`global_defs.rb:2306`, `xmlparser.rb:698,788`) cross-checked against 22
 * seconds of real wire from a live session, by downloads-a6 — not from anyone's
 * memory of the protocol, including mine.
 */

/**
 * A value, and which source it came from.
 *
 * The provenance is *on* the value rather than beside it, and that is the
 * whole design. Two sources can supply the same fact — the stream and the
 * bridge both know your health — and a reader that cannot tell which it has is
 * how two sources silently overwrite each other. A sibling field answering
 * "where did this come from" gets dropped by the first `{...spread}` somebody
 * writes; a wrapper cannot be dropped without the value going with it.
 *
 * `at` is when it arrived, because "stale but from the game" and "fresh from
 * the bridge" is a real choice and it cannot be made without a timestamp.
 */
export interface Sourced<T> {
  value: T
  from: 'stream' | 'bridge'
  /** `Date.now()` at arrival. */
  at: number
}

/**
 * One vital, as the stream reports it.
 *
 * **Parsed from the tag's `text`, never its `value`.** Lich's own parser does
 * `attributes['text'].scan(/-?\d+/)` for exactly this reason: the attach dump
 * hardcodes `value='0'` on every bar it synthesises —
 *
 *     <progressBar id='health' value='0' text='health 100/100'/>
 *
 * — so a reader taking `value` shows **zero health on a healthy character**,
 * and nothing anywhere errors. `value` is meaningful only on `pbarStance` and
 * `mindState`, both of which are GemStone-only and neither of which reaches a
 * DragonRealms client at all.
 */
export interface StreamVital {
  current: number
  max: number
}

/**
 * The four bars DragonRealms actually sends.
 *
 * Deliberately not a `Record<string, StreamVital>`: an open map invites a
 * panel to read `vitals.stance` or `vitals.mind`, which are GemStone bars that
 * will never arrive here, and get `undefined` forever with no way to tell that
 * from "not measured yet".
 */
export interface StreamVitals {
  health?: StreamVital
  mana?: StreamVital
  spirit?: StreamVital
  stamina?: StreamVital
}

/**
 * Whether a status icon is lit — in three states, because the game uses three.
 *
 * `'y'` and `'n'` are the game speaking. **Empty is an icon the game has not
 * spoken about yet**, observed as `visible=''` on `IconPOISONED` in a real
 * capture. Modelling this as a boolean asserts "not poisoned" about something
 * nobody has been told, which is the same defect as a paperdoll showing a
 * clean bill of health it has never seen.
 */
export type IndicatorState = 'on' | 'off' | 'unknown'

/**
 * Status flags the stream carries: bleeding, poisoned, standing, kneeling,
 * prone and the rest, keyed by the game's own icon id with the `Icon` prefix
 * dropped and lowercased.
 *
 * Absent from this map means the tag has never arrived, which is a different
 * thing again from `'unknown'` — that one means it arrived and said nothing.
 */
export type StreamIndicators = Record<string, IndicatorState>

/**
 * What the game stream knows about the character right now.
 *
 * # What is deliberately not here
 *
 * **Hands, wounds, mindstate, stance and encumbrance never arrive in
 * DragonRealms.** Lich gates `<right>`, `<left>`, `<image id="chest"
 * name="Injury2"/>`, `pbarStance`, `mindState` and `encumlevel` behind
 * `XMLData.game.to_s.match?(/GS/)` in the attach dump, and none of them
 * appeared in the live capture. A panel fed from the stream for any of those
 * waits forever and shows an empty state that looks like an answer.
 *
 * They stay bridge-fed. Leaving them out of this type is the point: a field
 * that cannot arrive should not be somewhere a component can ask for it.
 */
export interface StreamCharacterState {
  vitals: Sourced<StreamVitals>
  indicators: Sourced<StreamIndicators>
  /** Available exits, from the compass tag. */
  compass?: Sourced<string[]>
  /** Active spell, as the game names it. */
  spell?: Sourced<string | null>
}
