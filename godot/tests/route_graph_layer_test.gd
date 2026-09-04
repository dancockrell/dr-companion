extends SceneTree
## Route-graph gate: world context is one mesh over known manifest links, not
## a second map with inferred roads or external-room guesses.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const RouteGraphLayer := preload("res://scripts/route_graph_layer.gd")

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var loader: Node = root.get_node("WorldManifestLoader")
	_ok("fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))
	var layer: Node3D = RouteGraphLayer.new()
	root.add_child(layer)
	layer.render_routes(loader.cells)
	var expected_pairs: Dictionary = {}
	for source_id_value in loader.cells.keys():
		var source_id := str(source_id_value)
		for exit in loader.cells[source_id].get("exits", []):
			var target_id := str(exit.get("targetCellId", ""))
			if not target_id.is_empty() and loader.cells.has(target_id):
				var key := "%s\u001f%s" % [source_id, target_id] if source_id < target_id else "%s\u001f%s" % [target_id, source_id]
				expected_pairs[key] = true
	_ok("one segment is drawn for each known undirected manifest connection", layer.segment_count() == expected_pairs.size())
	_ok("the route graph is one mesh instance, not a node per exit", layer.get_child_count() == 1)
	_ok("the mock subset exposes at least one local route", layer.segment_count() > 0)
	var typed_cells := {
		"a": {"position": {"x": 0, "y": 0, "z": 0}, "exits": [
			{"targetCellId": "b", "tetherKind": "road"},
			{"targetCellId": "c", "tetherKind": "portal"},
		]},
		"b": {"position": {"x": 5, "y": 0, "z": 0}, "exits": [{"targetCellId": "a", "tetherKind": "road"}]},
		"c": {"position": {"x": 0, "y": 0, "z": 5}, "exits": [{"targetCellId": "a", "tetherKind": "portal"}]},
	}
	layer.render_routes(typed_cells)
	_ok("roads and portals retain separate static visual families", layer.segment_count_for("road") == 1 and layer.segment_count_for("portal") == 1)
	_ok("each used tether family owns one mesh and material", layer.get_child_count() == 2)
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
