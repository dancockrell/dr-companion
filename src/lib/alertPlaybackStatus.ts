/** Visible, source-safe diagnostics for alert sounds that loaded but would not play. */
const failures = new Map<string, string>()
const listeners = new Set<() => void>()

function publish() {
  listeners.forEach((listener) => listener())
}

export function alertPlaybackFailureNote(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : ''
  if (name === 'NotAllowedError') {
    return 'Playback was blocked. Interact with the app, then use a channel preview to try again.'
  }
  if (name === 'NotSupportedError') {
    return 'This audio format is not supported by the current game window.'
  }
  return 'The audio source loaded, but the game window could not play it.'
}

export function recordAlertPlaybackFailure(name: string, error: unknown) {
  if (!name) return
  failures.set(name, alertPlaybackFailureNote(error))
  publish()
}

export function clearAlertPlaybackFailure(name: string) {
  if (failures.delete(name)) publish()
}

export function alertPlaybackFailures(): ReadonlyMap<string, string> {
  return failures
}

export function onAlertPlaybackFailuresChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetAlertPlaybackFailures() {
  if (failures.size === 0) return
  failures.clear()
  publish()
}
