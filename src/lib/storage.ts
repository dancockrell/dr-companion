/**
 * The "parse JSON from a key, fall back on any error" and "stringify and
 * write, swallow quota/private-mode errors" shapes, factored out after they
 * showed up hand-rolled in six different files (persistence, profiles,
 * useMacroChoice, portraits, mapDock, layout) with the same reasoning
 * ("private mode or a full quota - losing a preference is not worth an error
 * in front of someone mid-fight") copy-pasted into each one's `catch` block.
 *
 * Callers that need to validate or merge what comes back - defaults, field
 * clamping, migrating an old shape - still do that themselves on top of the
 * raw value this returns. This only owns the storage access, not what a
 * caller trusts once it has one.
 */

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode, or a full quota. Losing a preference is not worth an
    // error in front of someone who is trying to play.
  }
}
