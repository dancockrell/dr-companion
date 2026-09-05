extends SceneTree
## The placeholder block is the size the cell published, and a cell that
## published nothing is a visible, reported failure rather than a guess.
##
## Written for issue #345. `content_registry.gd` held
## `const FALLBACK_BLOCK_METRES := 4.4`, a fourth hand-typed copy of
## CELL_PITCH_METRES - CELL_GAP_METRES from src/lib/isometric-board-layout.mjs,
## and the mock fixture stripped `board` from all 19 cells - so that fallback
## was not a legacy path, it was the only path this viewer ever took, and
## because the copy was correct nothing on screen could have shown it.
##
## Two things are checked here that a capture cannot check:
##   - a cell whose footprint is deliberately *not* the board's block size gets
##     a block of that size, so a constant standing in for the cell would be
##     caught. A chooser tested where the only candidate is the right answer
##     tests nothing;
##   - a cell with no board at all gets the marker, and the marker is not a
##     plausible block - the degraded state has to look degraded.
##
## The fixture side (that every cell really does carry one, 19 of 19) is
## asserted from Node in tools/godot-fixture-contract-test.mjs, which can
## compare against CELL_BLOCK_METRES itself. This file deliberately types no
## block size at all: every number it compares against comes from the fixture
## it just loaded, or is a size chosen to be obviously not one.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const ROOM_ID := "1-14"

## Two sizes no board would ever publish - the board is square, and the depth
## is not a whole number of anything. A placeholder that comes back at these is
## reading the cell; one that comes back at any other number is not.
const PROBE_WIDTH := 7.5
const PROBE_DEPTH := 2.25

## An unregistered primitive kind, so build() must reach _placeholder rather
## than a content pack's factory. Checked below, not assumed.
const UNREGISTERED_KIND := "not-a-registered-kind-345"

## The real count when nothing aborts is 13. A GDScript runtime error does not
## stop _initialize reaching the summary, so without this floor a crash on the
## first line would print "0 checked, 0 failed" and read as a pass.
const MIN_EXPECTED_CHECKS := 10

var _checked := 0
var _failed := 0

func _initialize() -> void:
	print("-- ContentRegistry: the block is the cell's, not the script's --")
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

	_ok("the mock fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))
	_ok("the fixture is non-trivial (a floor, so an empty load cannot pass the count below)",
		loader.cells.size() >= 10, "%d cells" % loader.cells.size())

	# The denominator this bug was found by: it was 0 of 19.
	var with_footprint := 0
	for cell_id in loader.cells.keys():
		if not registry.footprint_metres(loader.cells[cell_id]).is_empty():
			with_footprint += 1
	_ok("every cell in the fixture publishes a board footprint",
		with_footprint == loader.cells.size(), "%d of %d cells" % [with_footprint, loader.cells.size()])

	var published: Dictionary = registry.footprint_metres(loader.cells[ROOM_ID])
	_ok("a real cell's footprint reads back with a width and a depth",
		published.has("width") and published.has("depth"), str(published))
	if published.is_empty():
		return

	# _placeholder is only reached for a kind no content pack claims. If some
	# pack ever registers this string the rest of the file would be testing that
	# pack instead, silently.
	_ok("the probe kind is unregistered, so build() must reach the placeholder",
		not registry.is_registered(UNREGISTERED_KIND), UNREGISTERED_KIND)

	var primitive := {"kind": UNREGISTERED_KIND, "role": "base"}

	# -- the cell decides, and the wrong answer is available --
	var probe_cell := {
		"id": "probe-345",
		"board": {"footprint": {"width": PROBE_WIDTH, "depth": PROBE_DEPTH, "height": 1, "unit": "metre"}},
	}
	var probe_node: MeshInstance3D = registry.build(probe_cell, primitive)
	var probe_box: BoxMesh = probe_node.mesh
	_ok("a block is drawn at the width its own cell published, not the board's",
		is_equal_approx(probe_box.size.x, PROBE_WIDTH), "%.2f m" % probe_box.size.x)
	_ok("and at its own depth, so width is not being reused for both",
		is_equal_approx(probe_box.size.z, PROBE_DEPTH), "%.2f m" % probe_box.size.z)
	_ok("the probe sizes differ from the fixture's, so passing means the cell was read",
		not is_equal_approx(PROBE_WIDTH, published["width"]),
		"probe %.2f vs fixture %.2f" % [PROBE_WIDTH, published["width"]])

	var real_node: MeshInstance3D = registry.build(loader.cells[ROOM_ID], primitive)
	var real_box: BoxMesh = real_node.mesh
	_ok("a fixture cell is drawn at the size that fixture published",
		is_equal_approx(real_box.size.x, published["width"]) and is_equal_approx(real_box.size.z, published["depth"]),
		"%.2f x %.2f m" % [real_box.size.x, real_box.size.z])

	# -- and a cell that published nothing degrades loudly --
	# push_error() writes to stderr here on purpose; it is the console half of
	# the same report. This asserts the visible half.
	var boardless := {"id": "boardless-345"}
	_ok("a cell with no board reads back as empty, not as some default",
		registry.footprint_metres(boardless).is_empty())
	var marker: MeshInstance3D = registry.build(boardless, primitive)
	var marker_box: BoxMesh = marker.mesh
	_ok("it is drawn at the missing-footprint marker size",
		is_equal_approx(marker_box.size.x, registry.MISSING_FOOTPRINT_MARKER_METRES)
			and is_equal_approx(marker_box.size.z, registry.MISSING_FOOTPRINT_MARKER_METRES),
		"%.2f x %.2f m" % [marker_box.size.x, marker_box.size.z])
	_ok("which is not a plausible block, so the failure cannot pass for a room",
		not is_equal_approx(marker_box.size.x, published["width"]),
		"marker %.2f vs block %.2f" % [marker_box.size.x, published["width"]])
	var marker_material: StandardMaterial3D = marker.material_override
	_ok("and it is not painted like an ordinary placeholder either",
		marker_material.albedo_color == registry.MISSING_FOOTPRINT_MARKER_COLOR,
		str(marker_material.albedo_color))

	probe_node.free()
	real_node.free()
	marker.free()

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s %s" % [label, detail])
	else:
		_failed += 1
		print("FAIL %s %s" % [label, detail])
