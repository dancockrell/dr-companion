extends SceneTree
## A cell that draws nothing, and the one exit shape that made every cell draw
## nothing.
##
## Written for issue #376. `docs/verification/token-height-2026-09-06.md` left
## this open: cell `1-16`, a 3 m interior cutaway, "draws no placeholder block
## at all at Route distance", while every other cell that should draw one does.
##
## The cause was not in `ContentRegistry` and not about that cell. `1-16` is one
## hop from `1-40`, which publishes three exits with `targetCellId: null` - the
## manifest's documented way of saying an exit leaves the loaded subset
## (`world_manifest_loader.gd`, and `tools/godot-fixture-contract-test.mjs`
## asserts both the mock fixture and the live compiler carry some).
## `cell_visibility_policy.gd:29` read that field with `String()`, which has no
## constructor taking Nil, so the breadth-first walk raised at runtime,
## `detail_window()` returned null, and `world_root.gd:_apply_detail_window()`
## mounted primitives for **no cell at all**. The board drew nothing anywhere;
## `1-16` was simply the room the capture was pointed at, and its fixture tokens
## were still drawn on top of the emptiness because they come from a different
## layer.
##
## So the property is not "1-16 draws a block". It is:
##
##   - every loaded cell is a usable detail-window origin, all 19 of 19. The
##     wrong answer is available: from `1-14` - the mock's own starting room,
##     and the origin of every capture in docs/verification before this one -
##     the walk never reaches a null-targeted exit inside two hops and passes
##     with the bug present. Only sweeping every origin separates them;
##   - and a cell's primitives are drawn, counted, at the size that cell
##     published.
##
## Camera distance is not in this at all, which is worth saying because the
## report named one: `detail_window()` takes no camera argument and
## `_apply_detail_window()` runs on every snapshot regardless of mode. Route
## distance is where it was seen, not what caused it.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"

## The cell the report named.
const REPORTED_CELL := "1-16"
## One hop from 1-16 and the source of the nulls that broke the walk.
const NULL_TARGET_NEIGHBOUR := "1-40"
const PREVIOUSLY_PASSING_ORIGIN := "1-14"

## Floors, well under the real counts, so a fixture that quietly stopped
## carrying the shape this file turns on cannot pass by having nothing to check.
const MIN_CELLS := 10
const MIN_NULL_TARGETED := 3
const MIN_UNREGISTERED_ON_REPORTED_CELL := 4

## An id no manifest publishes, so a synthetic cell cannot collide with a real
## one, and four kinds no content pack claims.
const UNREGISTERED_KINDS := [
	"unregistered-kind-a-376",
	"unregistered-kind-b-376",
	"unregistered-kind-c-376",
	"unregistered-kind-d-376",
]
const REGISTERED_KIND := "terrain-cell-5m"

## Sizes no board publishes, so a block that came back at a constant rather than
## at the synthetic cell's own footprint is caught.
const PROBE_WIDTH := 7.5
const PROBE_DEPTH := 2.25
const PROBE_HEIGHT := 6.25

## The real count when nothing aborts is 26. A GDScript runtime error does not
## stop `_initialize` reaching the summary, so without this floor a raise on the
## first line would print "0 checked, 0 failed" and read as a pass - which is
## precisely the failure mode of the bug under test.
const MIN_EXPECTED_CHECKS := 20

var _checked := 0
var _failed := 0

func _initialize() -> void:
	print("-- CellVisibilityPolicy: every loaded cell is a usable origin, and a cell's primitives are drawn --")
	_run()
	print("")
	print("%d checked, %d failed" % [_checked, _failed])
	if _checked < MIN_EXPECTED_CHECKS:
		print("FAILED - only %d checks ran (expected at least %d) - _run aborted early" % [_checked, MIN_EXPECTED_CHECKS])
		quit(1)
	elif _failed > 0:
		print("FAILED")
		quit(1)
	else:
		print("all passed")
		quit(0)

func _run() -> void:
	var registry: Node = root.get_node("ContentRegistry")
	var loader: Node = root.get_node("WorldManifestLoader")
	# A headless `--script` run reaches `_initialize` before the content pack's
	# `_enter_tree`, so ask it to register rather than reading an empty registry
	# and calling every factory absent. content_registry_test.gd does the same.
	root.get_node("SharedAssetContent").ensure_registration()
	var policy: RefCounted = load("res://scripts/cell_visibility_policy.gd").new()

	_ok("the mock fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))
	_ok("the fixture is non-trivial, so the sweep below has something to sweep",
		loader.cells.size() >= MIN_CELLS, "%d cells, floor %d" % [loader.cells.size(), MIN_CELLS])

	# -- the shape this file turns on is present --
	var null_targeted := 0
	var null_target_cells: Array = []
	for cell_id in loader.cells.keys():
		for exit in loader.cells[cell_id].get("exits", []):
			if exit is Dictionary and not (exit.get("targetCellId") is String):
				null_targeted += 1
				if not null_target_cells.has(cell_id):
					null_target_cells.append(cell_id)
	_ok("the fixture carries exits whose target is not a string, which is what raised",
		null_targeted >= MIN_NULL_TARGETED,
		"%d such exits across %d cells, floor %d" % [null_targeted, null_target_cells.size(), MIN_NULL_TARGETED])
	_ok("and %s is one of them, one hop from %s" % [NULL_TARGET_NEIGHBOUR, REPORTED_CELL],
		null_target_cells.has(NULL_TARGET_NEIGHBOUR), str(null_target_cells))

	# -- N of N: every loaded cell is a usable origin --
	# The chooser with the wrong answer available. Before the fix this was 1 of
	# 19 from some origins and 19 of 19 from others, and PREVIOUSLY_PASSING_ORIGIN
	# below is the one that passed either way.
	var usable := 0
	var first_failure := ""
	for cell_id in loader.cells.keys():
		var window = policy.detail_window(cell_id, loader.cells)
		if window is Dictionary and (window.get("detailIds", []) as Array).has(cell_id):
			usable += 1
		elif first_failure.is_empty():
			first_failure = "%s -> %s" % [cell_id, str(window)]
	_ok("every loaded cell is a detail-window origin that at least contains itself",
		usable == loader.cells.size(), "%d of %d cells%s" % [usable, loader.cells.size(), "" if first_failure.is_empty() else "; first failure " + first_failure])

	var previously_passing: Dictionary = policy.detail_window(PREVIOUSLY_PASSING_ORIGIN, loader.cells)
	_ok("the origin every earlier capture used still works, so the sweep is not a blanket change",
		(previously_passing.get("detailIds", []) as Array).has(PREVIOUSLY_PASSING_ORIGIN),
		"%d cells in %s's window" % [(previously_passing.get("detailIds", []) as Array).size(), PREVIOUSLY_PASSING_ORIGIN])

	# -- and the reported cell's own window --
	var window: Dictionary = policy.detail_window(REPORTED_CELL, loader.cells)
	var ids: Array = window.get("detailIds", [])
	_ok("the reported cell's window contains the reported cell", ids.has(REPORTED_CELL), str(ids.size()) + " ids")
	_ok("and reaches the null-targeting neighbour that used to abort the walk",
		ids.has(NULL_TARGET_NEIGHBOUR), str(ids))
	_ok("and it is not one lonely id, which is what an aborted walk returns",
		ids.size() >= 5, "%d ids" % ids.size())

	# The null is skipped, not coerced. `str(null)` would put "<null>" in here
	# and the id would then be looked up as though it were a room.
	var unknown: Array = []
	for id_value in ids:
		if not loader.cells.has(id_value):
			unknown.append(id_value)
	_ok("every id in the window is a cell in the manifest, so no null became an id",
		unknown.is_empty(), str(unknown) if not unknown.is_empty() else "%d ids checked" % ids.size())

	# -- and now the drawing, which is what the report was about --
	var reported_cell: Dictionary = loader.cells[REPORTED_CELL]
	var footprint: Dictionary = registry.footprint_metres(reported_cell)
	_ok("the reported cell publishes a footprint to be drawn at", not footprint.is_empty(), str(footprint))

	var unregistered_kinds: Array = []
	for primitive in reported_cell.get("primitives", []):
		if not registry.is_registered(String(primitive.get("kind", ""))):
			unregistered_kinds.append(primitive.get("kind", ""))
	_ok("the reported cell really does carry kinds no content pack claims",
		unregistered_kinds.size() >= MIN_UNREGISTERED_ON_REPORTED_CELL,
		"%d unregistered of %d primitives, floor %d: %s" % [unregistered_kinds.size(), (reported_cell.get("primitives", []) as Array).size(), MIN_UNREGISTERED_ON_REPORTED_CELL, str(unregistered_kinds)])

	var drawn: Dictionary = _mount(registry, reported_cell)
	_ok("mounting the reported cell draws one node per primitive, none of them dropped",
		drawn["nodes"] == (reported_cell.get("primitives", []) as Array).size(),
		"%d nodes for %d primitives" % [drawn["nodes"], (reported_cell.get("primitives", []) as Array).size()])
	_ok("and one placeholder block per unregistered kind, not none",
		drawn["blocks"] == unregistered_kinds.size(),
		"%d blocks for %d unregistered kinds" % [drawn["blocks"], unregistered_kinds.size()])
	_ok("every block it drew is the size that cell published, not a marker or a constant",
		drawn["blocks"] > 0 and drawn["offSizeBlocks"] == 0,
		"%d blocks at %.2f x %.2f x %.2f m, %d off-size" % [drawn["blocks"], footprint.get("width", 0.0), footprint.get("height", 0.0), footprint.get("depth", 0.0), drawn["offSizeBlocks"]])
	_ok("and the registered kind on that same cell still drew its own mesh rather than a block",
		drawn["nodes"] - drawn["blocks"] == (reported_cell.get("primitives", []) as Array).size() - unregistered_kinds.size(),
		"%d non-block nodes" % [drawn["nodes"] - drawn["blocks"]])
	_free_mounted(drawn)

	# -- the chooser, on synthetic cells where the wrong answer is available --
	var probe_board := {"footprint": {"width": PROBE_WIDTH, "depth": PROBE_DEPTH, "height": PROBE_HEIGHT, "unit": "metre"}, "ground": {"width": PROBE_WIDTH, "depth": PROBE_DEPTH, "unit": "metre"}}

	var all_unregistered := {"id": "all-unregistered-376", "board": probe_board, "primitives": []}
	for kind in UNREGISTERED_KINDS:
		_ok("the probe kind %s is unregistered, so it must reach the placeholder" % kind, not registry.is_registered(kind))
		(all_unregistered["primitives"] as Array).append({"kind": kind, "role": "landmark"})
	var unregistered_drawn: Dictionary = _mount(registry, all_unregistered)
	_ok("a cell whose every kind is unregistered draws one block each, not nothing",
		unregistered_drawn["blocks"] == UNREGISTERED_KINDS.size(),
		"%d blocks for %d kinds" % [unregistered_drawn["blocks"], UNREGISTERED_KINDS.size()])
	_ok("at that cell's own published footprint, so a constant cannot be deciding it",
		unregistered_drawn["offSizeBlocks"] == 0 and is_equal_approx(unregistered_drawn["firstSize"].y, PROBE_HEIGHT),
		"%.2f x %.2f x %.2f m" % [unregistered_drawn["firstSize"].x, unregistered_drawn["firstSize"].y, unregistered_drawn["firstSize"].z])
	_free_mounted(unregistered_drawn)

	var one_registered := {"id": "one-registered-376", "board": probe_board, "primitives": [{"kind": REGISTERED_KIND, "role": "base"}]}
	_ok("the control kind is registered, so this arm exercises the content pack",
		registry.is_registered(REGISTERED_KIND), REGISTERED_KIND)
	var registered_drawn: Dictionary = _mount(registry, one_registered)
	_ok("a registered kind still draws its own mesh and no placeholder block",
		registered_drawn["nodes"] == 1 and registered_drawn["blocks"] == 0,
		"%d nodes, %d blocks" % [registered_drawn["nodes"], registered_drawn["blocks"]])
	_free_mounted(registered_drawn)

	var no_primitives := {"id": "no-primitives-376", "board": probe_board, "primitives": []}
	var empty_drawn: Dictionary = _mount(registry, no_primitives)
	_ok("a cell that published no primitives draws nothing, which is its own honest answer",
		empty_drawn["nodes"] == 0, "%d nodes" % empty_drawn["nodes"])
	_ok("so the counts above are not simply whatever the mounter always returns",
		empty_drawn["nodes"] != unregistered_drawn["nodes"],
		"%d vs %d" % [empty_drawn["nodes"], unregistered_drawn["nodes"]])
	_free_mounted(empty_drawn)

## Mounts one cell exactly the way `world_root.gd:_mount_cell_detail` does, and
## counts what came back: total nodes, how many are placeholder blocks, and how
## many of those blocks are not the size the cell published.
func _mount(registry: Node, cell: Dictionary) -> Dictionary:
	var content := Node3D.new()
	var expected: Vector3 = registry.block_size_metres(cell)
	var nodes := 0
	var blocks := 0
	var off_size := 0
	var first_size := Vector3.ZERO
	for primitive in cell.get("primitives", []):
		var node = registry.build(cell, primitive)
		if node == null:
			continue
		content.add_child(node)
		nodes += 1
		if node is MeshInstance3D and (node as MeshInstance3D).mesh is BoxMesh:
			var size: Vector3 = ((node as MeshInstance3D).mesh as BoxMesh).size
			blocks += 1
			if blocks == 1:
				first_size = size
			if not (is_equal_approx(size.x, expected.x) and is_equal_approx(size.y, expected.y) and is_equal_approx(size.z, expected.z)):
				off_size += 1
	return {"content": content, "nodes": nodes, "blocks": blocks, "offSizeBlocks": off_size, "firstSize": first_size}

func _free_mounted(drawn: Dictionary) -> void:
	var content: Node3D = drawn.get("content")
	if content != null and is_instance_valid(content):
		content.free()

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s %s" % [label, detail])
	else:
		_failed += 1
		print("FAIL %s %s" % [label, detail])
