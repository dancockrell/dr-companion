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

/**
 * The mock's pause-latch modes, as a closed set the parser and the control
 * both read.
 *
 * See `MockBridge.setPauseLatchMode` for what each one means. The order is the
 * order the chooser offers them in, and `follow` is first because it is the
 * default.
 */
export const PAUSE_LATCH_MODES = ['follow', 'latched', 'clear', 'absent'] as const

export type PauseLatchMode = (typeof PAUSE_LATCH_MODES)[number]

function isPauseLatchMode(value: string | null): value is PauseLatchMode {
  return PAUSE_LATCH_MODES.includes(value as PauseLatchMode)
}

/**
 * `?mock-pause=latched|clear|absent|follow` - which cell of `pauseStatus.ts`
 * the mock bridge should open on.
 *
 * Here rather than in a parser of its own, for the reason the header above
 * gives about `?bridge=`: two functions answering "what did this URL ask for"
 * drift, and this one is read by the mock bridge (to start in that mode) and
 * by the settings control (to show which mode it is in). One parser, two
 * readers.
 *
 * Issue #503. `bridge.setPauseLatchMode` existed with no caller anywhere, so
 * `paused-by-bridge` and the connected form of `paused-unconfirmed` - the two
 * cells #487 was opened for - were still unreachable in development, and the
 * test saying otherwise was a regex over the file that *declares* the setter.
 * A knob nothing can reach is the same absence it was added to close, one
 * layer further in.
 *
 * Anything else, including an absent flag and a misspelt one, is `follow`:
 * the default is what a developer who did not ask for a cell gets, and a
 * typo must not silently produce a different world than the one on screen.
 *
 * @param search `window.location.search`, passed in so this is testable
 *        without a DOM.
 */
export function selectPauseLatchMode(search: string): PauseLatchMode {
  const flag = new URLSearchParams(search).get('mock-pause')
  return isPauseLatchMode(flag) ? flag : 'follow'
}

/** The same decision, reading the live location. Safe under SSR and in tests. */
export function initialPauseLatchMode(): PauseLatchMode {
  return selectPauseLatchMode(typeof window === 'undefined' ? '' : window.location.search)
}
