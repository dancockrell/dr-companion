/**
 * A player's saved stations - single source of truth, backed by
 * persistence.ts's `favoriteStations` field. Used to live entirely as local
 * `useState` inside SoundControls, re-derived by hand in a second place
 * (SafetyFooter's own favorite-current star, 29 Aug 2026) the moment a
 * second surface needed to read or change it - the exact drift class this
 * file's own musicVolume/nowPlaying/crossfadeStyle precedent in
 * ambientSound.ts already exists to avoid, just for a preference list
 * instead of a playback parameter.
 *
 * A `builtin` favorite that names a station killed since it was saved (Salt
 * and Sail, Silk Road - 29 Aug 2026) is pruned once here, at module load, by
 * checking it against RADIO_STATIONS - the same fix SoundControls used to
 * carry as its own mount effect, moved to where every reader benefits from
 * it instead of only the one component that happened to have it. A `custom`
 * favorite (a player's own stream URL) isn't checked - this module has no
 * way to know if a URL still resolves, the same reasoning SoundControls'
 * original fix already documented.
 */
import { loadPrefs, savePrefs, type FavoriteStation } from './persistence.ts'
import { RADIO_STATIONS } from './ambientSound.ts'

function pruneDead(list: FavoriteStation[]): FavoriteStation[] {
  const liveStationIds = new Set(RADIO_STATIONS.map((s) => s.id))
  return list.filter((f) => f.kind !== 'builtin' || liveStationIds.has(f.id))
}

const savedFavorites = loadPrefs().favoriteStations ?? []
let favorites: FavoriteStation[] = pruneDead(savedFavorites)
// If pruning actually dropped something, persist that once at load - same as
// SoundControls' old mount effect did, so a killed station doesn't keep
// reappearing in storage every session even though nothing built on it can
// ever show it again.
if (favorites.length !== savedFavorites.length) {
  savePrefs({ favoriteStations: favorites })
}

const listeners = new Set<(list: FavoriteStation[]) => void>()

function commit(next: FavoriteStation[]) {
  favorites = next
  savePrefs({ favoriteStations: next })
  for (const l of listeners) l(favorites)
}

export function favoriteStations(): FavoriteStation[] {
  return favorites
}

export function onFavoritesChange(fn: (list: FavoriteStation[]) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function isFavorited(kind: FavoriteStation['kind'], id: string): boolean {
  return favorites.some((f) => f.kind === kind && f.id === id)
}

/** Add if absent, remove if present - what a star icon's click always means. */
export function toggleFavorite(kind: FavoriteStation['kind'], id: string, name: string) {
  commit(
    isFavorited(kind, id)
      ? favorites.filter((f) => !(f.kind === kind && f.id === id))
      : [...favorites, { kind, id, name }]
  )
}

export function removeFavorite(kind: FavoriteStation['kind'], id: string) {
  commit(favorites.filter((f) => !(f.kind === kind && f.id === id)))
}
