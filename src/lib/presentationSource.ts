import type { PresentationSource } from './presentationTypes.ts'

/** Connection epochs are recorded at the store boundary, so React batching
 * cannot hide a disconnect/reconnect or let script-list updates revive old data. */
export function presentationSourceForState(input: {
  mode: 'mock' | 'live'; connected: boolean; hasCharacter: boolean; staleSince: number
  bridgeGeneration: number; characterGeneration: number
}): PresentationSource {
  return {
    kind: input.mode === 'mock' ? 'demo' : 'live',
    connected: input.connected && input.hasCharacter && input.staleSince === 0 &&
      (input.mode === 'mock' || (input.bridgeGeneration > 0 && input.characterGeneration === input.bridgeGeneration)),
  }
}
