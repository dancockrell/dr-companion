extends RefCounted
## Determines the local presentation budget from the authoritative cell graph.
##
## The whole map may stay loaded as graph data, but detailed geometry is a
## local resource: the room the player occupies plus at most two true-exit
## hops.  This is deliberately a graph traversal, not a radial-distance guess;
## a river, wall, bridge, or athletics check can make nearby coordinates
## unreachable, and only manifest exits describe real traversal.

const DEFAULT_DETAIL_HOPS := 2

func detail_window(origin_id: String, cells: Dictionary, max_hops: int = DEFAULT_DETAIL_HOPS) -> Dictionary:
	if origin_id.is_empty() or not cells.has(origin_id) or max_hops < 0:
		return {"originId": origin_id, "detailIds": [], "distances": {}}

	var distances: Dictionary = {origin_id: 0}
	var queue: Array = [origin_id]
	var cursor := 0
	while cursor < queue.size():
		var current_id: String = queue[cursor]
		cursor += 1
		var distance: int = distances[current_id]
		if distance >= max_hops:
			continue
		var cell: Dictionary = cells.get(current_id, {})
		for exit in cell.get("exits", []):
			if not (exit is Dictionary):
				continue
			var target_id := String(exit.get("targetCellId", ""))
			if target_id.is_empty() or not cells.has(target_id) or distances.has(target_id):
				continue
			distances[target_id] = distance + 1
			queue.append(target_id)

	return {"originId": origin_id, "detailIds": queue, "distances": distances}
