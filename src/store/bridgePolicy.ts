/** Intents that must never be blocked by game state. See docs/DOMAIN.md. */
export const SAFETY_INTENTS = ['stop_all', 'pause', 'resume', 'escape'] as const

/**
 * Whether a control offering an intent should be enabled for the connected
 * bridge. `null` means the bridge did not report capabilities, not that it
 * implements nothing. Safety controls remain available even when capability
 * information is stale or incomplete.
 */
export function isIntentImplemented(
  bridgeIntents: string[] | null,
  intent: string
): boolean {
  if ((SAFETY_INTENTS as readonly string[]).includes(intent)) return true
  if (bridgeIntents === null) return true
  return bridgeIntents.includes(intent)
}

export function isSafetyIntent(intent: string): boolean {
  return (SAFETY_INTENTS as readonly string[]).includes(intent)
}
