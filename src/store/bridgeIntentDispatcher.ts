import { bridge } from '../bridge'
import type { IntentName } from '../bridge/types'
import { combatRanks } from '../data/skills'
import type { AppState } from '../types'
import { isSafetyIntent } from './bridgePolicy'

export function requestIntent(
  intent: IntentName | `travel:${string}`,
  extraArgs: Record<string, unknown> | undefined,
  get: () => AppState
): void {
  const { character, addLog, bridgeConnected } = get()
  const safetyIntent = isSafetyIntent(intent)

  if (!bridgeConnected) {
    addLog(
      safetyIntent
        ? `Bridge is down — cannot send ${intent}. Stop scripts in Lich directly.`
        : `Not connected — cannot run intent: ${intent}`
    )
    return
  }
  if (!safetyIntent && !character?.connected) {
    addLog(`Character is not connected — cannot run intent: ${intent}`)
    return
  }

  let args = extraArgs
  if (intent === 'start_training') {
    const { trainFocus, huntFavorites, huntMode, selectedHuntId } = get()
    args = {
      focus: trainFocus,
      favorites: huntFavorites,
      huntMode,
      selectedHuntId,
      guild: character?.guild ?? 'unknown',
      skills: character?.skills ?? [],
      skillRanks: character?.skills?.length
        ? combatRanks(character.skills)
        : character?.skillRanks ?? 50,
    }
  }
  if (intent.startsWith('travel:')) {
    bridge.requestIntent('travel', { destination: intent.split(':')[1] || 'crossing' })
    return
  }
  if (intent === 'go_healer' || intent === 'escape_heal') {
    args = { preferredCity: get().preferredHealCity }
  }
  if (intent === 'burgle') {
    const { houseEntryMethod, houseEntryMaxSearches, houseEntryHide } = get()
    args = {
      method: houseEntryMethod,
      maxSearches: houseEntryMaxSearches,
      hide: houseEntryHide,
      guild: character?.guild ?? 'unknown',
    }
  }
  bridge.requestIntent(intent as IntentName, args)
}
