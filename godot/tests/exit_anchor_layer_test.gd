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

	# -- a chevron sits on the block its own room published, whatever its height --
	#
	# The marker height was `marker.position.y = 0.24`, worked out on paper from
	# a 0.3 m slab that content_registry.gd had typed into itself. The manifest
	# publishes `board.footprint.height` - 1 for a room, 3 for an interior
	# cutaway - so 0.24 is inside every block taller than that slab: the same
	# burial the board-legibility pass had already fixed once (issue #362).
	#
	# 0.3 is deliberately one of the two heights. It is what the old constant
	# would still produce, so a marker that had gone back to a typed 0.24 passes
	# the short case and fails the tall one - a chooser tested where the wrong
	# answer is available.
	_ok("a chevron on a short block sits on that block's top face", _marker_clears_block(layer, SHORT_BLOCK_METRES),
		"%.3f m" % _marker_y(layer, SHORT_BLOCK_METRES))
	_ok("and on a 3 m block it sits on that block's top face, not inside it", _marker_clears_block(layer, TALL_BLOCK_METRES),
		"%.3f m" % _marker_y(layer, TALL_BLOCK_METRES))
	_ok("so the published height is what moved it, not a number in this file",
		_marker_y(layer, TALL_BLOCK_METRES) > _marker_y(layer, SHORT_BLOCK_METRES),
		"%.3f m vs %.3f m" % [_marker_y(layer, TALL_BLOCK_METRES), _marker_y(layer, SHORT_BLOCK_METRES)])
	layer.free()
	print("%d checked, %d failed" % [_checked, _failed])
	if _checked < MIN_EXPECTED_CHECKS:
		print("FAILED - only %d checks ran (expected at least %d)" % [_checked, MIN_EXPECTED_CHECKS])
		quit(1)
	quit(1 if _failed > 0 else 0)

## The two block heights the chevron is asked to clear. 0.3 is the slab
## content_registry.gd used to type; 3 is what an interior cutaway publishes.
const SHORT_BLOCK_METRES := 0.3
const TALL_BLOCK_METRES := 3.0

## A footprint whose width and depth are not the board's block size, so nothing
## here can be mistaken for a copy of it. Only the height is under test.
const PROBE_PLAN_METRES := 3.75

## How far above the block's top face the chevron may sit and still be "on" it.
## The layer keeps a deliberate hair of clearance against z-fighting; a marker
## floating a third of a metre up is a different thing and should fail.
const CLEARANCE_TOLERANCE_METRES := 0.1

## The real count when nothing aborts is 11.
const MIN_EXPECTED_CHECKS := 9

## One room publishing a block of the given height, with one compass exit.
func _height_cells(height: float) -> Dictionary:
	return {
		"room": {
			"id": "height-probe-362",
			"position": {"x": 0, "y": 0, "z": 0},
			"board": {"footprint": {"width": PROBE_PLAN_METRES, "depth": PROBE_PLAN_METRES, "height": height, "unit": "metre"}},
			"exits": [{"move": "north", "boardAnchor": {"x": 0, "y": 0, "z": -2.5}}],
		},
	}

func _marker_for(layer: Node3D, height: float) -> MeshInstance3D:
	layer.render_exits("room", _height_cells(height))
	for anchor in layer.get_children():
		for child in anchor.get_children():
			if child is MeshInstance3D:
				return child
	return null

func _marker_y(layer: Node3D, height: float) -> float:
	var marker := _marker_for(layer, height)
	return marker.position.y if marker != null else -1.0

## The block is a box centred on the cell origin, so its top face is half the
## published height above it. Restated here rather than asked of the registry:
## a test that computed the expected value with the same call the code under
## test uses would agree with it however wrong both were.
func _marker_clears_block(layer: Node3D, height: float) -> bool:
	var marker := _marker_for(layer, height)
	if marker == null:
		return false
	var mesh: PrismMesh = marker.mesh
	var bottom: float = marker.position.y - mesh.size.y * 0.5
	var block_top := height * 0.5
	return bottom >= block_top and bottom - block_top <= CLEARANCE_TOLERANCE_METRES

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s %s" % [label, detail])
	else:
		_failed += 1
		print("FAIL %s %s" % [label, detail])
