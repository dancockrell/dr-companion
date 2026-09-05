/**
 * The table of contents for the cartography that ships with the app.
 *
 * Kept separate from mapData.ts because that loader is also exercised in a
 * tiny Node harness which supplies map chunks itself. The browser can import
 * JSON directly; the isolated harness deliberately cannot.
 */
import MAP_INDEX from '../data/map/index.json' with { type: 'json' }

export interface MapZoneIndexEntry {
  id: string
  name: string
  rooms: number
}

/** Every shipped zone, including event and teleport-only maps with no gate. */
export const ZONE_INDEX: readonly MapZoneIndexEntry[] = MAP_INDEX
