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
			# A null `targetCellId` is the manifest's own way of saying this is a
			# real exit that leads out of the loaded subset -
			# `world_manifest_loader.gd` calls the null "the whole signal, in both
			# the mock fixture and a live snapshot", and
			# `tools/godot-fixture-contract-test.mjs` asserts both subjects carry
			# some. Every other reader of this field uses `str()`, which tolerates
			# it; this line used `String()`, which has no constructor taking Nil,
			# so it raised at runtime and abandoned the walk.
			#
			# What that cost was not one skipped exit. `detail_window()` returned
			# null, `_apply_detail_window()` got no ids, and *no cell anywhere on
			# the board mounted any content at all* - no blocks, no ground, no
			# props - with one console line to say so. It only bit when the walk
			# reached such an exit inside `max_hops`, so it depended entirely on
			# which room the player stood in: from `1-14` the mock board draws,
			# from `1-16` (one hop from `1-40`, which has three null-targeted
			# exits) it draws nothing at all (issue #376).
			#
			# The type test is the check rather than a coercion: skipping is
			# exactly what a target outside the loaded subset means here, and
			# `str(null)` would smuggle a "<null>" id into the comparison below
			# instead of saying so.
			var target_value = exit.get("targetCellId")
			if not (target_value is String):
				continue
			var target_id: String = target_value
			if target_id.is_empty() or not cells.has(target_id) or distances.has(target_id):
				continue
			distances[target_id] = distance + 1
			queue.append(target_id)

	return {"originId": origin_id, "detailIds": queue, "distances": distances}
