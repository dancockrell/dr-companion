/**
 * "Open the Sound panel" as a request, not a prop - MusicTransport's footer
 * copy and SoundControls (the panel itself) are siblings under SafetyFooter,
 * not parent/child, so a click on the footer's now-playing title (29 Aug
 * 2026: the footer got its own volume slider and transport, but favorites,
 * the station list and the crossfade-style picker only live in the full
 * panel) has nowhere to reach the panel's `open` state directly without
 * lifting it up through SafetyFooter and threading it back down. A tiny
 * pub/sub is less machinery than that for one boolean one component owns.
 */
const listeners = new Set<() => void>()

export function requestOpenSoundPanel() {
  for (const l of listeners) l()
}

/** Subscribe to open-panel requests. Returns an unsubscribe function. */
export function onOpenSoundPanelRequest(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
