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

## And a height no board publishes. The manifest publishes 1 for a room and 3
## for an interior cutaway, and a slab of 0.3 was typed into content_registry.gd
## until issue #362 - so each of those three is an answer a block that had
## stopped reading its cell could still give. 6.25 is none of them.
const PROBE_HEIGHT := 6.25

## An interior cutaway: the fixture publishes height 3 for this cell and 1 for
## ROOM_ID. The pair is the point - one cell alone cannot show that the height
## on screen came from the cell rather than from a constant that happens to
## agree with it.
const TALL_ROOM_ID := "1-16"

## A ground square no board publishes either, and not square, so a plane that
## came back at the pitch, at the block, or with one dimension used for both is
## caught.
const PROBE_GROUND_WIDTH := 8.75
const PROBE_GROUND_DEPTH := 1.5

## An unregistered primitive kind, so build() must reach _placeholder rather
## than a content pack's factory. Checked below, not assumed.
const UNREGISTERED_KIND := "not-a-registered-kind-345"

## A registered one, so the ground checks exercise the content pack's real
## factory rather than the placeholder.
const TERRAIN_KIND := "terrain-cell-5m"

## The real count when nothing aborts is 27. A GDScript runtime error does not
## stop _initialize reaching the summary, so without this floor a crash on the
## first line would print "0 checked, 0 failed" and read as a pass.
const MIN_EXPECTED_CHECKS := 22

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
	_ok("and a height, which is the field #362 found nothing was reading",
		published.has("height"), str(published))

	var probe_cell := {
		"id": "probe-345",
		"board": {"footprint": {"width": PROBE_WIDTH, "depth": PROBE_DEPTH, "height": PROBE_HEIGHT, "unit": "metre"}},
	}
	var probe_node: MeshInstance3D = registry.build(probe_cell, primitive)
	var probe_box: BoxMesh = probe_node.mesh
	_ok("a block is drawn at the width its own cell published, not the board's",
		is_equal_approx(probe_box.size.x, PROBE_WIDTH), "%.2f m" % probe_box.size.x)
	_ok("and at its own depth, so width is not being reused for both",
		is_equal_approx(probe_box.size.z, PROBE_DEPTH), "%.2f m" % probe_box.size.z)
	_ok("and at its own height, so the slab constant is not deciding it",
		is_equal_approx(probe_box.size.y, PROBE_HEIGHT), "%.2f m" % probe_box.size.y)
	_ok("the probe sizes differ from the fixture's, so passing means the cell was read",
		not is_equal_approx(PROBE_WIDTH, published["width"]),
		"probe %.2f vs fixture %.2f" % [PROBE_WIDTH, published["width"]])
	_ok("the block's top face is reported at half the height that is drawn",
		is_equal_approx(registry.block_top_y(probe_cell), probe_box.size.y * 0.5),
		"top %.3f m of a %.2f m block" % [registry.block_top_y(probe_cell), probe_box.size.y])

	var real_node: MeshInstance3D = registry.build(loader.cells[ROOM_ID], primitive)
	var real_box: BoxMesh = real_node.mesh
	_ok("a fixture cell is drawn at the size that fixture published",
		is_equal_approx(real_box.size.x, published["width"]) and is_equal_approx(real_box.size.z, published["depth"]),
		"%.2f x %.2f m" % [real_box.size.x, real_box.size.z])
	_ok("including its height",
		is_equal_approx(real_box.size.y, published["height"]), "%.2f m" % real_box.size.y)

	# -- two real cells, published at different heights --
	# The wrong answer is available here: this fixture has both an ordinary room
	# and an interior cutaway, so a viewer drawing one height for the whole board
	# gets one of these two right and cannot get both.
	var tall_published: Dictionary = registry.footprint_metres(loader.cells[TALL_ROOM_ID])
	var tall_node: MeshInstance3D = registry.build(loader.cells[TALL_ROOM_ID], primitive)
	var tall_box: BoxMesh = tall_node.mesh
	_ok("an interior cutaway is drawn at the taller height it published",
		is_equal_approx(tall_box.size.y, tall_published["height"]), "%.2f m" % tall_box.size.y)
	_ok("which is not the height its neighbour published, so one constant cannot serve both",
		not is_equal_approx(tall_box.size.y, real_box.size.y),
		"%s %.2f m vs %s %.2f m" % [TALL_ROOM_ID, tall_box.size.y, ROOM_ID, real_box.size.y])
	_ok("and its top face is reported higher than the shorter room's",
		registry.block_top_y(loader.cells[TALL_ROOM_ID]) > registry.block_top_y(loader.cells[ROOM_ID]),
		"%.2f m vs %.2f m" % [registry.block_top_y(loader.cells[TALL_ROOM_ID]), registry.block_top_y(loader.cells[ROOM_ID])])

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

	# -- and so does a cell that published two thirds of a footprint --
	# A width and a depth with no height is the same broken contract as no board
	# at all. Answering it with a default height would put a block of some
	# invented thickness on the board and say nothing, which is the failure this
	# file is named after.
	var heightless := {
		"id": "heightless-362",
		"board": {"footprint": {"width": PROBE_WIDTH, "depth": PROBE_DEPTH, "unit": "metre"}},
	}
	_ok("a footprint with no height reads back as empty, not as a partial answer",
		registry.footprint_metres(heightless).is_empty())
	var heightless_node: MeshInstance3D = registry.build(heightless, primitive)
	var heightless_box: BoxMesh = heightless_node.mesh
	_ok("so it gets the marker cube rather than a plausible block of invented thickness",
		is_equal_approx(heightless_box.size.y, registry.MISSING_FOOTPRINT_MARKER_METRES)
			and is_equal_approx(heightless_box.size.x, registry.MISSING_FOOTPRINT_MARKER_METRES),
		"%.2f x %.2f m" % [heightless_box.size.x, heightless_box.size.y])

	# -- the ground is the cell's too, and it is bigger than the block --
	# `shared_asset_content.gd` drew every terrain, floor and water plane as a
	# hand-typed `5.0 x 5.0` with the cell argument discarded (issue #362). The
	# size was right and could follow the manifest nowhere.
	# A headless `--script` run reaches _initialize before the content pack's
	# _enter_tree, so ask it to register rather than reading an empty registry
	# and calling the factory absent. foundation_test.gd does the same.
	root.get_node("SharedAssetContent").ensure_registration()
	_ok("the terrain kind is registered, so this exercises the content pack's own factory",
		registry.is_registered(TERRAIN_KIND), TERRAIN_KIND)
	var ground_cell := {
		"id": "ground-probe-362",
		"board": {
			"footprint": {"width": PROBE_WIDTH, "depth": PROBE_DEPTH, "height": PROBE_HEIGHT, "unit": "metre"},
			"ground": {"width": PROBE_GROUND_WIDTH, "depth": PROBE_GROUND_DEPTH, "unit": "metre"},
		},
	}
	var ground_node: Node3D = registry.build(ground_cell, {"kind": TERRAIN_KIND, "role": "base"})
	var ground_plane: PlaneMesh = (ground_node.get_child(0) as MeshInstance3D).mesh
	_ok("a ground plane is drawn at the ground its own cell published",
		is_equal_approx(ground_plane.size.x, PROBE_GROUND_WIDTH) and is_equal_approx(ground_plane.size.y, PROBE_GROUND_DEPTH),
		"%.2f x %.2f m" % [ground_plane.size.x, ground_plane.size.y])
	_ok("which is not that cell's block, so one size is not standing in for both",
		not is_equal_approx(ground_plane.size.x, PROBE_WIDTH),
		"ground %.2f vs block %.2f" % [ground_plane.size.x, PROBE_WIDTH])

	var real_ground: Vector2 = registry.ground_size_metres(loader.cells[ROOM_ID])
	_ok("and on a real cell the ground is wider than the block, which is what draws the gutter",
		real_ground.x > published["width"],
		"ground %.2f vs block %.2f m" % [real_ground.x, published["width"]])
	_ok("a cell that published no ground gets the marker rather than a plausible tile",
		is_equal_approx(registry.ground_size_metres(boardless).x, registry.MISSING_FOOTPRINT_MARKER_METRES),
		"%.2f m" % registry.ground_size_metres(boardless).x)

	probe_node.free()
	real_node.free()
	tall_node.free()
	marker.free()
	heightless_node.free()
	ground_node.free()

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s %s" % [label, detail])
	else:
		_failed += 1
		print("FAIL %s %s" % [label, detail])
