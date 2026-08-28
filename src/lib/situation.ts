/**
 * The bridge's flags, corrected by the stream where the stream has a definite
 * answer. Split out of StatusBoard.tsx so it can be imported by a test
 * without dragging JSX through Node's loader.
 *
 * A flag returned here does not mean "the bridge said so"; it means "this
 * believes it is true right now". `SituationFlag`s the stream can also see
 * arrive with the icon prefix already dropped and lowercased (`gameStream.ts`),
 * so most of them line up with the flag name directly - `bleeding`,
 * `poisoned`, `stunned`, `prone`, `kneeling`, `sitting`, `hidden`,
 * `invisible`, `diseased`, `webbed`, `joined`.
 *
 * The stream wins on those, same choice and same reason as vitals in
 * src/lib/vitals.ts: it is fed by every `indicator` tag on the wire and stays
 * current while the bridge is down, which the logs show happens often. Only
 * `'on'`/`'off'` count as an answer - `'unknown'` means the tag arrived with
 * nothing in it and absence means the tag has never arrived at all, and
 * either way the bridge's own read is what is left to go on.
 *
 * Flags the stream has no icon for at all - `in_combat`, `low_health`,
 * `dead`, `dying`, `bags_full`, `immobilized` - are not derived from a single
 * indicator and stay bridge-only; they simply never get a stream override
 * because `indicators` never has a key for them.
 */
import type { StreamIndicators } from '../types/stream'

export function situationFor(
  situation: readonly string[],
  indicators: StreamIndicators
): Set<string> {
  const flags = new Set<string>(situation)
  for (const [key, state] of Object.entries(indicators)) {
    if (state === 'on') flags.add(key)
    else if (state === 'off') flags.delete(key)
    // 'unknown': leave whatever the bridge said standing.
  }
  return flags
}
