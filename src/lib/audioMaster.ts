let muted = false
const listeners = new Set<(muted: boolean) => void>()

export function masterMuted(): boolean { return muted }

export function setMasterMuted(next: boolean): void {
  if (muted === next) return
  muted = next
  for (const listener of listeners) listener(muted)
}

export function effectiveAudioGain(configuredGain: number): number {
  return muted ? 0 : configuredGain
}

export function onMasterMuteChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
