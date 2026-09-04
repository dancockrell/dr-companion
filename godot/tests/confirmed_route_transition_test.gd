extends SceneTree
## Phase 1 records confirmed travel but remains visually static.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const ConfirmedRouteTransition := preload("res://scripts/confirmed_route_transition.gd")

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var loader: Node = root.get_node("WorldManifestLoader")
	_ok("fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))
	var source_id := "1-14"
	var target_id := ""
	for exit in loader.true_exits(source_id):
		var candidate := str(exit.get("targetCellId", ""))
		if not candidate.is_empty() and loader.has_cell(candidate):
			target_id = candidate
			break
	_ok("fixture has a known local route to traverse", not target_id.is_empty())
	var layer: Node3D = ConfirmedRouteTransition.new()
	root.add_child(layer)
	_ok("a confirmed true-exit transition is accepted", layer.play_confirmed_route(source_id, target_id, loader.cells))
	_ok("the ribbon records only its confirmed source and destination", layer.last_route() == {"fromRoomId": source_id, "toRoomId": target_id})
	_ok("the static phase starts no travel animation", not layer.is_playing())
	_ok("an unknown destination creates no travel effect", not layer.play_confirmed_route(source_id, "not-a-room", loader.cells))
	_ok("a same-room snapshot is not presented as travel", not layer.play_confirmed_route(source_id, source_id, loader.cells))
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
