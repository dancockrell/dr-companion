/**
 * The one place that decides which bridge the app opens on.
 *
 * There are two inputs and they are not the same question:
 *
 *   - the stored preference, which is what the player chose last time
 *     (`persistence.ts`, written by `setBridgeMode`);
 *   - a `?bridge=mock` / `?bridge=live` query flag, which is an explicit
 *     request for this window only and wins over the stored value.
 *
 * The flag exists because until 6 Sep 2026 the stored default was `'mock'`,
 * so the dev server and every browser-driven harness got the invented world
 * for free by opening the page. Changing the default to `'live'` (issue #382)
 * takes that away, and a flag is the honest replacement: an entry point that
 * says out loud what it is asking for, rather than a default that decides for
 * everybody. It is deliberately not gated on `import.meta.env.DEV` - a branch
 * that only exists in one build is a branch nobody can demonstrate in the
 * other.
 *
 * Nothing else may read the preference to pick a mode. Two functions
 * answering "mock or real" would drift, and the one that drifted would be the
 * one deciding what a new user sees.
 */

export type BridgeModeChoice = 'mock' | 'live'

function isChoice(value: string | null): value is BridgeModeChoice {
  return value === 'mock' || value === 'live'
}

/**
 * @param stored the persisted preference, or undefined on a fresh profile.
 * @param search `window.location.search`, passed in so this is testable
 *        without a DOM.
 */
export function selectBridgeMode(
  stored: BridgeModeChoice | undefined,
  search: string
): BridgeModeChoice {
  const flag = new URLSearchParams(search).get('bridge')
  if (isChoice(flag)) return flag
  // `??`, not `||`: both members of the union are truthy strings, but an
  // absent preference and an empty one must land on the same branch.
  return stored ?? 'live'
}

/** The same decision, reading the live location. Safe under SSR and in tests. */
export function initialBridgeMode(stored: BridgeModeChoice | undefined): BridgeModeChoice {
  const search = typeof window === 'undefined' ? '' : window.location.search
  return selectBridgeMode(stored, search)
}
