/**
 * How many authoritative statements about the game world this session has
 * accepted.
 *
 * One number, one owner, in a file small enough that anything may read it.
 *
 * # Why it is not a field on the store
 *
 * The store cannot be the owner: `useAppStore.ts` reaches `mapData.ts`, which
 * uses `import.meta.glob`, so nothing outside a Vite build can import it. That
 * includes every test under `node --experimental-strip-types`, and it includes
 * `aiSuggestions.ts`, which is a safety module and is worth being able to load
 * and exercise with the app absent.
 *
 * It was also mirrored onto `AppState.stateVersion` for a while, on the
 * argument that a component showing freshness would need to re-render when it
 * moved. No component ever did, and a second copy of one number is a second
 * answer to one question, so the mirror was removed (#370). If a component
 * does need to re-render on it later, `onStateVersionChange` is the
 * subscription to use — the number keeps one owner either way.
 *
 * The counter is bumped in exactly one place, `versionedSetter` below, which
 * the store wraps its `set` in.
 *
 * # What counts as authoritative
 *
 * A write carrying `character` or `mapHere`: the game telling us where the
 * character is and what state they are in. Not renders, not settings, not log
 * lines, not a timestamp — two pushes can land in the same millisecond, and an
 * unchanged push is still a new statement.
 *
 * # Who reads it
 *
 * `aiSuggestions.ts`. A proposed command records the version it was reasoned
 * from, and the confirmation gate refuses to send it if the version has moved
 * since. Starting at 0 is deliberate: a suggestion built before the first
 * status matches nothing and is refused, which is the right way for it to
 * fail.
 */
let version = 0
const listeners = new Set<(version: number) => void>()

/** The current version. Read at the moment of a check, never captured. */
export function currentStateVersion(): number {
  return version
}

/**
 * Record one authoritative statement and return the new version.
 *
 * Called only by `versionedSetter` below, which the store wraps its `set` in.
 */
export function bumpStateVersion(): number {
  version += 1
  // Copied before iterating: a listener that unsubscribes while being notified
  // would otherwise mutate the set mid-loop. A listener that throws is
  // reported and skipped — this is a notification, and one bad subscriber must
  // not stop the others hearing that the world moved.
  for (const listener of [...listeners]) {
    try {
      listener(version)
    } catch (error) {
      console.error('a state-version listener threw and was skipped', error)
    }
  }
  return version
}

/** Watch for authoritative changes. Returns the unsubscribe function. */
export function onStateVersionChange(listener: (version: number) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The writes that count as the game telling us something: where the character
 * is and what state they are in.
 */
export const AUTHORITATIVE_KEYS = ['character', 'mapHere'] as const

type AuthoritativeState = Record<(typeof AUTHORITATIVE_KEYS)[number], unknown>

/**
 * Wrap a store's `set` so the version is bumped by the *shape of the write*,
 * not by the writer remembering to.
 *
 * Five places write `character` or `mapHere`, in three files, and two of them
 * are disconnect paths. A convention — "bump it when you write these" — holds
 * until the sixth write site, and the failure when it stops holding is silent
 * and exactly the wrong way round: a stale suggestion passes the freshness
 * check because the counter never moved.
 *
 * Every store helper takes `set` as an argument (`bridgeMessageHandler`,
 * `bridgeLifecycle`, `profilePersistence`), so wrapping it once in
 * `useAppStore.ts` covers all of them, including write sites nobody has
 * written yet.
 *
 * It lives here rather than in the store because the store cannot be imported
 * outside a Vite build (see the note at the top of this file), and a rule
 * nothing can execute is a rule only a regex over the source can defend.
 * The patch is passed through untouched: this counts writes, it does not
 * add to them.
 */
export function versionedSetter<S extends AuthoritativeState>(
  raw: (partial: Partial<S> | ((s: S) => Partial<S>)) => void,
  read: () => S
): (partial: Partial<S> | ((s: S) => Partial<S>)) => void {
  return (partial) => {
    const patch = typeof partial === 'function' ? partial(read()) : partial
    if (AUTHORITATIVE_KEYS.some((key) => key in patch)) {
      bumpStateVersion()
    }
    raw(patch)
  }
}
