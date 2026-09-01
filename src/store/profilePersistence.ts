import type { AppState, GameInstance } from '../types'
import {
  copyProfileSettings,
  deleteProfile,
  loadProfiles,
  newProfile,
  profileKey,
  upsertProfile,
  type CharacterProfile,
} from '../lib/profiles'

type SetState = (partial: Partial<AppState>) => void
type GetState = () => AppState

export function syncProfile(
  name: string,
  instance: GameInstance,
  guild: string | undefined,
  set: SetState,
  get: GetState
): void {
  const key = profileKey(name, instance)
  if (key === get().activeProfileKey) return

  const profiles = loadProfiles()
  const existing = profiles[key]
  const profile = existing
    ? { ...existing, guild: guild ?? existing.guild, lastSeen: Date.now() }
    : newProfile(name, instance, { guild })

  upsertProfile(profile)
  set({
    activeProfileKey: key,
    profiles: loadProfiles(),
    trainFocus: profile.trainFocus,
    huntFavorites: profile.huntFavorites,
    huntMode: profile.huntMode,
    preferredHealCity: profile.preferredHealCity,
    houseEntryMethod: profile.houseEntryMethod,
    houseEntryMaxSearches: profile.houseEntryMaxSearches,
    houseEntryHide: profile.houseEntryHide,
  })
  get().addLog(
    existing
      ? `Loaded settings for ${name} on ${instance}.`
      : `New character: ${name} on ${instance}. Started a profile.`
  )
}

export function patchActiveProfile(
  patch: Partial<CharacterProfile>,
  set: SetState,
  get: GetState
): void {
  const key = get().activeProfileKey
  if (!key) return
  const current = loadProfiles()[key]
  if (!current) return
  upsertProfile({ ...current, ...patch, lastSeen: Date.now() })
  set({ profiles: loadProfiles() })
}

export function deleteProfileByKey(key: string, set: SetState, get: GetState): void {
  const profile = loadProfiles()[key]
  if (!profile) return
  const profiles = deleteProfile(profile.name, profile.instance)
  set({ profiles })
  get().addLog(`Deleted the profile for ${profile.name}.`)
}

export function copySettingsFrom(key: string, set: SetState, get: GetState): void {
  const profiles = loadProfiles()
  const source = profiles[key]
  const activeKey = get().activeProfileKey
  const target = activeKey ? profiles[activeKey] : undefined
  if (!source || !target) return

  const merged = copyProfileSettings(source, target)
  upsertProfile(merged)
  set({
    profiles: loadProfiles(),
    trainFocus: merged.trainFocus,
    huntFavorites: merged.huntFavorites,
    huntMode: merged.huntMode,
    preferredHealCity: merged.preferredHealCity,
    houseEntryMethod: merged.houseEntryMethod,
    houseEntryMaxSearches: merged.houseEntryMaxSearches,
    houseEntryHide: merged.houseEntryHide,
  })
  get().addLog(`Copied ${source.name}'s settings onto ${target.name}.`)
}
