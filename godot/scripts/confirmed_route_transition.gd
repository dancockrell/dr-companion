extends Node3D
## Records an already-confirmed room transition without animating it.
##
## This layer cannot move a player and never predicts an arrival.  `WorldRoot`
## calls it only after a snapshot says the current room changed. Phase 1 is
## intentionally static: the actor snaps with the confirmed tether change and
## this layer retains only the validated edge for inspection. A later phase may
## render that edge as a streak. Reconnects, rejects, and unexplained jumps stay
## visually quiet rather than receiving invented travel.

var _last_route: Dictionary = {}

func play_confirmed_route(from_room_id: String, to_room_id: String, cells: Dictionary) -> bool:
	_last_route = {}
	if from_room_id.is_empty() or to_room_id.is_empty() or from_room_id == to_room_id:
		return false
	if not cells.has(from_room_id) or not cells.has(to_room_id) or not _has_true_link(from_room_id, to_room_id, cells):
		return false
	_last_route = {"fromRoomId": from_room_id, "toRoomId": to_room_id}
	return true

func last_route() -> Dictionary:
	return _last_route.duplicate()

func is_playing() -> bool:
	return false

func _has_true_link(from_room_id: String, to_room_id: String, cells: Dictionary) -> bool:
	var source: Dictionary = cells.get(from_room_id, {})
	for exit in source.get("exits", []):
		if exit is Dictionary and str(exit.get("targetCellId", "")) == to_room_id:
			return true
	return false
