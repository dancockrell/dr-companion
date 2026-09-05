/**
 * A player's own hand-picked playlists - single source of truth, backed by
 * persistence.ts's `playlists` field. Same shape as favorites.ts: a real
 * module with pub/sub rather than local component state, because the
 * "Tracks" browse view (adding tracks) and the "Playlists" list (playing,
 * renaming, deleting) are two different parts of one panel that both need
 * to see the same list change in the same tick.
 *
 * Distinct from a favorite (favorites.ts): a favorite stars a whole station
 * or stream someone else curated; a playlist is built one track at a time
 * from the pool `ambientSound.ts`'s `ALL_TRACKS` names - Dan, 30 Aug 2026:
 * "we have great music. let people see and choose individual tracks and
 * make playlists with them too."
 */
import { loadPrefs, savePrefs, type Playlist } from './persistence.ts'
import { ALL_TRACKS } from './ambientSound.ts'

export type { Playlist }

/** A track id that named a station killed since a playlist was saved (Salt
 * and Sail, Silk Road - 29 Aug 2026) would otherwise sit in a playlist
 * forever, unplayable and unremovable by any control that only shows live
 * tracks - same dead-reference class favorites.ts already guards against
 * for stations. Pruned once here, at module load. */
function pruneDeadTracks(list: Playlist[]): Playlist[] {
  const liveTrackIds = new Set(ALL_TRACKS.map((t) => t.id))
  return list.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => liveTrackIds.has(id)) }))
}

const savedPlaylists = loadPrefs().playlists ?? []
let store: Playlist[] = pruneDeadTracks(savedPlaylists)
// If pruning actually dropped a track id, persist that once at load - same
// as favorites.ts does for a dead station, so it doesn't keep reappearing
// in storage every session even though nothing can ever play it again.
const totalTracksBefore = savedPlaylists.reduce((n, p) => n + p.trackIds.length, 0)
const totalTracksAfter = store.reduce((n, p) => n + p.trackIds.length, 0)
if (totalTracksAfter !== totalTracksBefore) {
  savePrefs({ playlists: store })
}

const listeners = new Set<(list: Playlist[]) => void>()

function commit(next: Playlist[]) {
  store = next
  savePrefs({ playlists: next })
  for (const l of listeners) l(store)
}

export function playlists(): Playlist[] {
  return store
}

export function getPlaylist(id: string): Playlist | undefined {
  return store.find((p) => p.id === id)
}

export function onPlaylistsChange(fn: (list: Playlist[]) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** A short, collision-resistant id - not a UUID, this never leaves the
 * player's own machine and never needs to. */
function newPlaylistId(): string {
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createPlaylist(name: string): Playlist {
  const p: Playlist = { id: newPlaylistId(), name: name.trim() || 'New playlist', trackIds: [] }
  commit([...store, p])
  return p
}

export function deletePlaylist(id: string) {
  commit(store.filter((p) => p.id !== id))
}

export function renamePlaylist(id: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  commit(store.map((p) => (p.id === id ? { ...p, name: trimmed } : p)))
}

export function isTrackInPlaylist(id: string, trackId: string): boolean {
  return getPlaylist(id)?.trackIds.includes(trackId) ?? false
}

/** Add if absent, remove if present - what a track row's own toggle always
 * means, same convention as favorites.ts's toggleFavorite. */
export function toggleTrackInPlaylist(id: string, trackId: string) {
  const p = getPlaylist(id)
  if (!p) return
  commit(
    store.map((x) =>
      x.id === id
        ? {
            ...x,
            trackIds: x.trackIds.includes(trackId)
              ? x.trackIds.filter((t) => t !== trackId)
              : [...x.trackIds, trackId],
          }
        : x
    )
  )
}

export function removeTrackFromPlaylist(id: string, trackId: string) {
  commit(store.map((p) => (p.id === id ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) } : p)))
}
