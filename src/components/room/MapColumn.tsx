import { MapPanel } from '../shared/MapPanel.tsx'

/**
 * The map, in a column of its own.
 *
 * It used to be a cell in the dashboard grid, sharing a column with the
 * Experience board and competing with it for vertical space. That fight has a
 * predictable winner on a character with seventy skills, and it was not the
 * map: the grid needed an explicit `minmax(12rem,1fr)` floor to stop the map
 * collapsing to a couple of pixels.
 *
 * A floor is the wrong fix for the wrong shape. The map is the one surface
 * here that is watched rather than consulted - players keep it in view while
 * doing something else, because they know which rooms break a script - so it
 * gets the full height of the window and a width the player sets themselves.
 *
 * That is also what Genie does. On Dan's own layout the AutoMapper is a
 * full-height pane down one side, and the thing it is next to is the game
 * text. Nothing in that layout is a small map in the corner of something
 * else.
 */
export function MapColumn() {
  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-border bg-surface-raised">
        <MapPanel plane />
      </div>
    </div>
  )
}
