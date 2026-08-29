/**
 * Names the game uses for its own channels, in words a player uses.
 *
 * Only for ids actually seen; anything unmapped shows its own id rather than
 * being hidden, because a channel we have no label for is still a channel and
 * dropping it would be the client deciding what matters.
 *
 * # Why this is a module and not a const in StreamTabs
 *
 * It shares a row with a second vocabulary - `CHANNELS` in chatChannels.ts,
 * the companion's own log tabs - and the two overlap. `talk` renders here as
 * "Speech"; the companion has a "Speech" tab of its own. Rendered together
 * that row read
 *
 *     Speech  Thoughts  |  All  Speech  Combat  Game  Companion
 *
 * two tabs, the same word, different content, one thin pipe apart.
 *
 * StreamTabs now captions each group, so an overlap is harmless rather than
 * forbidden. But a test cannot check that while these names live inside a
 * `.tsx` - importing that needs a JSX loader, which is exactly why
 * `vitals.ts` and `situation.ts` were split out of their components. Same
 * reason, same shape: out here, `tools/stream-test.mjs` can import both lists
 * and compute the real overlap instead of keeping a copy of one of them that
 * drifts.
 */
export const STREAM_LABELS: Record<string, string> = {
  thoughts: 'Thoughts',
  death: 'Deaths',
  talk: 'Speech',
  whispers: 'Whispers',
  logons: 'Arrivals',
  familiar: 'Familiar',
  group: 'Group',
  room: 'Room',
  bounty: 'Bounty',
  assess: 'Assess',
  inv: 'Inventory',
  society: 'Society',
}
