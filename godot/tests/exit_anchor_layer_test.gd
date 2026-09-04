extends SceneTree
## Exit-anchor gate: every marker comes from one known exit and can request
## only that exact move for the room it was rendered for.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const ExitAnchorLayer := preload("res://scripts/exit_anchor_layer.gd")
const ROOM_ID := "1-14"

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var loader: Node = root.get_node("WorldManifestLoader")
	_ok("fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))
	var layer: Node3D = ExitAnchorLayer.new()
	root.add_child(layer)
	layer.render_exits(ROOM_ID, loader.cells)
	var expected_moves: Array = []
	for exit in loader.true_exits(ROOM_ID):
		expected_moves.append(str(exit.get("move", "")))
	_ok("every displayed anchor comes from a true current-room exit", layer.visible_moves().size() == expected_moves.size())
	var requested: Array = []
	layer.exit_requested.connect(func(room_id, move): requested.append({"room": room_id, "move": move}))
	_ok("an anchor requests its exact real move", layer.request_exit(ROOM_ID, expected_moves[0]))
	_ok("the request retains the room the marker was rendered for", requested == [{"room": ROOM_ID, "move": expected_moves[0]}])
	_ok("an arbitrary move is not clickable", not layer.request_exit(ROOM_ID, "go imaginary secret door"))
	_ok("a stale marker cannot request a walk from another room", not layer.request_exit("not-current", expected_moves[0]))
	var placement_cells := {
		"room": {"position": {"x": 0, "y": 0, "z": 0}, "exits": [
			{"move": "north", "boardAnchor": {"x": 0, "y": 0, "z": -2.5}, "targetCellId": "north-room"},
			{"move": "go mysterious portal", "boardAnchor": null, "targetCellId": null},
		]},
		"north-room": {"position": {"x": 0, "y": 0, "z": -5}, "exits": []},
	}
	layer.render_exits("room", placement_cells)
	_ok("compiled board anchors resolve a true compass exit", layer.position_state_for("north") == "resolved")
	_ok("a directionless external exit stays actionable but unpositioned", layer.position_state_for("go mysterious portal") == "unpositioned" and layer.request_exit("room", "go mysterious portal"))
	layer.free()
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
