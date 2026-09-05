/**
 * How many authoritative statements about the game world this session has
 * accepted.
 *
 * One number, one owner, in a file small enough that anything may read it.
 *
 * # Why it is not simply a field on the store
 *
 * It is *also* a field on the store — `AppState.stateVersion` — because a
 * component that wants to show freshness has to be able to re-render when it
 * moves. But the store cannot be the owner: `useAppStore.ts` reaches
 * `mapData.ts`, which uses `import.meta.glob`, so nothing outside a Vite build
 * can import it. That includes every test under `node --experimental-strip-types`,
 * and it includes `aiSuggestions.ts`, which is a safety module and is worth
 * being able to load and exercise with the app absent.
 *
 * So the counter lives here and the store mirrors it. There is one place that
 * bumps it (`useAppStore.ts`'s `set` wrapper) and one place that mirrors it
 * (the same line), which is what stops the two drifting.
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
 * Called only by the store's `set` wrapper. It returns the number rather than
 * requiring a second call to read it, so the store's mirror and this counter
 * are written from one expression and cannot disagree.
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
