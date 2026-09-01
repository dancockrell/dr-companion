/**
 * Small loading primitives shared by lazy map resources.
 *
 * A rejected dynamic import must not become the answer forever. Vite chunks
 * can fail once because a laptop changed networks or a deployment replaced
 * the old file; keeping that rejected Promise in memory makes a Retry button
 * decorative. This cache shares concurrent work and successful values, but
 * deliberately forgets failures so the next call really tries again.
 */
export function createRetryableCache<T>(fetchValue: () => Promise<T>) {
  let cached: T | undefined
  let inFlight: Promise<T> | null = null

  return {
    load(): Promise<T> {
      if (cached !== undefined) return Promise.resolve(cached)
      if (inFlight) return inFlight

      const request = fetchValue().then((value) => {
        cached = value
        return value
      })
      inFlight = request

      // Both paths clear the shared request. Success is served from `cached`;
      // failure must permit a new fetch. A detached finally() would create a
      // second rejected promise and an unhandled-rejection warning.
      void request.then(
        () => {
          if (inFlight === request) inFlight = null
        },
        () => {
          if (inFlight === request) inFlight = null
        }
      )

      return request
    },
  }
}

/**
 * Monotonic request ownership for UI loads.
 *
 * Zone A can finish after the player has already asked for Zone B. Promises
 * cannot be cancelled, but their permission to update the screen can be.
 */
export function createLatestRequestGate() {
  let latest = 0
  return {
    next: () => ++latest,
    isCurrent: (request: number) => request === latest,
    invalidate: () => ++latest,
  }
}
