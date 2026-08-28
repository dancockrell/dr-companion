/**
 * Turning `roomPlayers`/`roomItems` into the one line each is worth on
 * screen — split out as pure functions so the absent/empty/populated
 * distinction is testable without a live game stream (there is no route to
 * inject synthetic wire XML through the legitimate path in dev/mock mode,
 * since the stream parser is fed only from a real Tauri game-link event).
 *
 * `null` return means "render nothing" (absent — the game has not sent this
 * component yet). A non-null string is always worth showing, including the
 * "nobody"/"nothing" cases, which are real, current answers rather than a
 * lack of one. See StreamCharacterState's own doc comment in types/stream.ts.
 */
import type { RoomItem, RoomPlayer, Sourced } from '../types/stream'

export function describeRoomPlayers(players?: Sourced<RoomPlayer[]>): string | null {
  if (!players) return null
  return players.value.length === 0
    ? 'Also here: nobody else.'
    : `Also here: ${players.value.map((p) => p.name).join(', ')}`
}

export function describeRoomItems(items?: Sourced<RoomItem[]>): string | null {
  if (!items) return null
  return items.value.length === 0
    ? 'On the floor: nothing.'
    : `On the floor: ${items.value.map((i) => i.name).join(', ')}`
}
