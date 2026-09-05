/**
 * How the top bar says where the character is.
 *
 * The handoff's section 9 makes three rules about this line, and two of them
 * are about what it must *never* say:
 *
 *   1. it carries freshness and confirmation state - "Room 998 · confirmed
 *      3 s ago", never a bare name;
 *   2. an unresolved location says "unresolved", and never falls back to the
 *      last known town.
 *
 * Rule 2 is the one with teeth. `character.location` keeps its last good
 * value when the mapper loses the room, so a line built from it goes on
 * confidently naming Crossing while the character stands somewhere unknown -
 * and a confident wrong answer is worse than no answer, because nothing
 * distinguishes it from a correct one. `mapHere` goes null instead, and null
 * is rendered as "unresolved".
 *
 * This is a pure function rather than JSX inside `TopBar` so the rules can be
 * asserted directly (`tools/location-line-test.mjs`). A rule that only exists
 * inside a component nobody can render from a test is a rule nobody checks.
 */

/** Just the fields this line reads. Structurally satisfied by `MapRoom`. */
export interface LocationSource {
  id: number | null
  title?: string | null
}

export interface LocationLine {
  /** True when there is no confirmed room. The caller styles this as a warning. */
  unresolved: boolean
  /** The whole line, ready to read. */
  text: string
}

/** "3 s ago", "2 m ago", "1 h ago" - short enough for a 48px bar. */
export function ago(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'just now'
  if (seconds < 60) return `${Math.round(seconds)} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} m ago`
  return `${Math.floor(seconds / 3600)} h ago`
}

/**
 * @param here          the confirmed room, or null when the mapper has none
 * @param ageSeconds    how long since that room was last confirmed, or null
 *                      when it has only just arrived
 */
export function locationLine(
  here: LocationSource | null | undefined,
  ageSeconds: number | null,
): LocationLine {
  // Written first, and deliberately not reachable past this point, because
  // this is the state that must never quietly become the other one.
  const roomId = here?.id ?? null
  if (roomId === null) return { unresolved: true, text: 'Location unresolved' }

  const title = here?.title ? ` · ${here.title}` : ''
  // `?? null` rather than `|| null`: an age of 0 seconds is a real, and in
  // fact the best possible, reading.
  const age = ageSeconds ?? null
  const confirmed = age === null ? 'confirmed just now' : `confirmed ${ago(age)}`
  return { unresolved: false, text: `Room ${roomId}${title} · ${confirmed}` }
}
