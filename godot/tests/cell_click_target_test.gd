extends SceneTree
## A click lands on the box the cell published, and on nothing beside it.
##
## Written for issue #366. `world_root.gd` built every cell's click target from
## a hand-typed `box.size = Vector3(4.5, 1.0, 4.5)` while all 19 cells published
## `board.selectionBounds` - 4.4 x 4.4, one metre tall for a room and three for
## an interior cutaway. Two consequences, and neither could be seen by reading:
##
##   - 5 cm of overhang on every side, so a click in the gutter between two
##     rooms picked one of them. `src/lib/isometric-board-layout.mjs` says why
##     that matters: "a selection box larger than the thing drawn means clicking
##     the gap between two rooms silently picks one of them, which makes an exit
##     hard to hit as well as hard to see";
##   - a 1 m box on a 3 m block, so two thirds of an interior cutaway was not
##     clickable at all.
##
## Both are measured here rather than argued, by casting a real ray into a real
## physics space against the bodies `_prepare_all_cells()` actually builds. The
## numbers below were taken from the unfixed code before it was touched: a ray
## down the centre of `1-14` reported its hit at y = 0.50, and a ray 2.25 m off
## that centre still hit the cell.
##
## # Where the wrong answer is available
##
## A chooser tested where only the right answer exists tests nothing, so three
## wrong answers are reachable throughout:
##
##   - `PROBE_ID` publishes a `selectionBounds` that is neither the board's nor
##     its own `footprint`, so a click box built from a constant, or from
##     `block_size_metres()`, lands somewhere this file can measure;
##   - `ROOM_ID` and `TALL_ROOM_ID` publish different heights, so one number for
##     the whole board gets one of them right and cannot get both;
##   - every miss is checked to be inside the superseded 4.5 m box, so "nothing
##     was hit" means the change did it, not that the ray was thrown into empty
##     space.
##
## # Harness constraints, both engine rather than choice
##
##   - `world_root.gd` names autoloads at compile time, so it is `load()`ed
##     inside `_initialize` rather than `preload`ed: a preload compiles before
##     the SceneTree's autoloads exist ("Identifier not found: BridgeClient").
##     `live_status_states_test.gd` records the same constraint.
##   - The viewer stays out of the tree - entering it runs `_ready` against
##     eight sibling nodes only `WorldRoot.tscn` supplies - so `cell_root` is
##     handed to it directly and that node is what gets added.
##   - Collision shapes are not in the physics space until a physics frame has
##     run. Without the `await`s below every ray in this file misses, which is
##     indistinguishable from a click box that is not there at all - measured,
##     and the reason the awaits are not tidy-uppable.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"

## An ordinary room (height 1) and an interior cutaway (height 3).
const ROOM_ID := "1-14"
const TALL_ROOM_ID := "1-16"

## A cell of this file's own, injected into the loaded manifest before the
## viewer builds anything, and parked far from every real one so a ray near it
## can only hit it.
const PROBE_ID := "probe-366"
const PROBE_X := 5000.0

## Its click box: not square, not the board's 4.4, and not a whole number of
## anything. A box that came back at any of those is not reading the cell.
const PROBE_SELECTION_WIDTH := 2.6
const PROBE_SELECTION_DEPTH := 6.4
const PROBE_SELECTION_HEIGHT := 5.5

## And a *different* footprint on the same cell, which is the point of the pair:
## `selectionBounds` and `footprint` are equal on every real cell today, so a
## click box wired to the wrong one of the two would pass every other check in
## this repository.
const PROBE_FOOTPRINT_WIDTH := 7.5
const PROBE_FOOTPRINT_DEPTH := 6.25
const PROBE_FOOTPRINT_HEIGHT := 2.25

## A cell that publishes no selection box at all, parked equally far away.
const BOARDLESS_ID := "boardless-366"
const BOARDLESS_X := 6000.0

## How far outside an edge to aim the miss. The issue's own number: at 4.5
## against a 4.4 block the overhang is 5 cm a side.
const OUTSIDE_MARGIN := 0.05

## What `world_root.gd` typed until this change. Here so the misses below can be
## shown to be *inside* it: a ray that missed both the old box and the new one
## would prove nothing about either.
const SUPERSEDED_CLICK_BOX_METRES := 4.5
const SUPERSEDED_CLICK_BOX_HEIGHT := 1.0

const RAY_HEIGHT := 40.0

## The real count when nothing aborts is 19. A GDScript runtime error abandons
## the function and still lets the summary print, so without a floor a crash on
## the first line would read as "0 checked, 0 failed" and pass.
const MIN_EXPECTED_CHECKS := 15

var _checked := 0
var _failed := 0

func _initialize() -> void:
	_run()

func _run() -> void:
	print("-- the click target is the box the cell published --")
	var registry: Node = root.get_node("ContentRegistry")
	var loader: Node = root.get_node("WorldManifestLoader")
	_ok("the mock fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))
	_ok("the fixture is non-trivial (a floor, so an empty load cannot pass the count below)",
		loader.cells.size() >= 10, "%d cells" % loader.cells.size())

	# The denominator. `board.selectionBounds` had no consumer in any .gd file
	# when this was written: one producer, zero readers, which is an absence
	# with more steps.
	var with_bounds := 0
	for cell_id in loader.cells.keys():
		if not registry.selection_bounds_metres(loader.cells[cell_id]).is_empty():
			with_bounds += 1
	_ok("every cell publishes a complete board.selectionBounds",
		with_bounds == loader.cells.size(), "%d of %d cells" % [with_bounds, loader.cells.size()])

	loader.cells[PROBE_ID] = {
		"id": PROBE_ID,
		"position": {"x": PROBE_X, "y": 0.0, "z": 0.0},
		"exits": [],
		"board": {
			"footprint": {"width": PROBE_FOOTPRINT_WIDTH, "depth": PROBE_FOOTPRINT_DEPTH, "height": PROBE_FOOTPRINT_HEIGHT, "unit": "metre"},
			"selectionBounds": {"width": PROBE_SELECTION_WIDTH, "depth": PROBE_SELECTION_DEPTH, "height": PROBE_SELECTION_HEIGHT},
		},
	}
	# push_error on the console is the other half of this cell's report; the
	# visible half is asserted below.
	loader.cells[BOARDLESS_ID] = {
		"id": BOARDLESS_ID,
		"position": {"x": BOARDLESS_X, "y": 0.0, "z": 0.0},
		"exits": [],
	}

	var world = load("res://scripts/world_root.gd").new()
	var cell_root := Node3D.new()
	root.add_child(cell_root)
	world.cell_root = cell_root
	world._prepare_all_cells()
	_ok("the viewer built a click target for every cell",
		cell_root.get_child_count() == loader.cells.size(),
		"%d holders for %d cells" % [cell_root.get_child_count(), loader.cells.size()])

	await physics_frame
	await physics_frame
	var space := root.world_3d.direct_space_state

	# -- the probe: the box is selectionBounds, and not the footprint beside it --
	_ok("the probe's two boxes differ, so reading the wrong one is detectable",
		not is_equal_approx(PROBE_SELECTION_WIDTH, PROBE_FOOTPRINT_WIDTH)
			and not is_equal_approx(PROBE_SELECTION_HEIGHT, PROBE_FOOTPRINT_HEIGHT),
		"selection %.2f x %.2f, footprint %.2f x %.2f" % [PROBE_SELECTION_WIDTH, PROBE_SELECTION_HEIGHT, PROBE_FOOTPRINT_WIDTH, PROBE_FOOTPRINT_HEIGHT])

	var probe_centre := Vector3(PROBE_X, 0.0, 0.0)
	var centre_hit := _ray_down(space, probe_centre)
	_ok("a click on the middle of the probe resolves to the probe",
		_cell_of(centre_hit) == PROBE_ID, _describe(centre_hit))
	_ok("and lands on the top face of the box it published, not the one beside it",
		not centre_hit.is_empty() and is_equal_approx(centre_hit["position"].y, PROBE_SELECTION_HEIGHT * 0.5),
		"y = %.3f m, published half-height %.3f, footprint would be %.3f, the superseded box %.3f"
			% [_hit_y(centre_hit), PROBE_SELECTION_HEIGHT * 0.5, PROBE_FOOTPRINT_HEIGHT * 0.5, SUPERSEDED_CLICK_BOX_HEIGHT * 0.5])

	var inside := probe_centre + Vector3(PROBE_SELECTION_WIDTH * 0.5 - OUTSIDE_MARGIN, 0.0, 0.0)
	_ok("a click just inside its edge still resolves to it",
		_cell_of(_ray_down(space, inside)) == PROBE_ID,
		"%.2f m from centre" % (PROBE_SELECTION_WIDTH * 0.5 - OUTSIDE_MARGIN))

	var outside := probe_centre + Vector3(PROBE_SELECTION_WIDTH * 0.5 + OUTSIDE_MARGIN, 0.0, 0.0)
	_ok("and %.2f m outside it resolves to nothing" % OUTSIDE_MARGIN,
		_ray_down(space, outside).is_empty(), _describe(_ray_down(space, outside)))
	_ok("that miss is inside the superseded box, so it is the change that made it miss",
		PROBE_SELECTION_WIDTH * 0.5 + OUTSIDE_MARGIN < SUPERSEDED_CLICK_BOX_METRES * 0.5,
		"%.2f m out, against the old %.2f m half-width" % [PROBE_SELECTION_WIDTH * 0.5 + OUTSIDE_MARGIN, SUPERSEDED_CLICK_BOX_METRES * 0.5])

	# -- and on the real board, at the 5 cm the issue is about --
	var room_bounds: Dictionary = registry.selection_bounds_metres(loader.cells[ROOM_ID])
	var room_centre := _position_of(loader.cells[ROOM_ID])
	_ok("a click on a real room resolves to that room",
		_cell_of(_ray_down(space, room_centre)) == ROOM_ID, _describe(_ray_down(space, room_centre)))

	var gutter := room_centre + Vector3(room_bounds["width"] * 0.5 + OUTSIDE_MARGIN, 0.0, 0.0)
	_ok("a click %.2f m past its edge - in the gutter - resolves to nothing" % OUTSIDE_MARGIN,
		_ray_down(space, gutter).is_empty(),
		"%.2f m from centre; the same ray hit this cell before the fix" % (room_bounds["width"] * 0.5 + OUTSIDE_MARGIN))
	_ok("and that gutter point is inside the box this replaced, so the miss is earned",
		room_bounds["width"] * 0.5 + OUTSIDE_MARGIN <= SUPERSEDED_CLICK_BOX_METRES * 0.5,
		"%.2f m out, against the old %.2f m half-width" % [room_bounds["width"] * 0.5 + OUTSIDE_MARGIN, SUPERSEDED_CLICK_BOX_METRES * 0.5])

	# -- two rooms at two heights, so one number cannot serve both --
	var tall_bounds: Dictionary = registry.selection_bounds_metres(loader.cells[TALL_ROOM_ID])
	var tall_hit := _ray_down(space, _position_of(loader.cells[TALL_ROOM_ID]))
	_ok("an interior cutaway is clickable to the top of the block it published",
		_cell_of(tall_hit) == TALL_ROOM_ID and is_equal_approx(_hit_y(tall_hit), tall_bounds["height"] * 0.5),
		"y = %.2f m of a %.2f m box" % [_hit_y(tall_hit), tall_bounds["height"]])
	_ok("which is above where the room next door is clickable, so one height cannot serve both",
		tall_bounds["height"] > room_bounds["height"],
		"%s %.2f m vs %s %.2f m" % [TALL_ROOM_ID, tall_bounds["height"], ROOM_ID, room_bounds["height"]])
	_ok("and the superseded box would have buried it",
		SUPERSEDED_CLICK_BOX_HEIGHT < tall_bounds["height"],
		"%.2f m of clickable block on a %.2f m room" % [SUPERSEDED_CLICK_BOX_HEIGHT, tall_bounds["height"]])

	# -- and a cell that published no box degrades loudly rather than plausibly --
	var boardless_centre := Vector3(BOARDLESS_X, 0.0, 0.0)
	_ok("a cell with no selection box reads back as empty, not as some default",
		registry.selection_bounds_metres(loader.cells[BOARDLESS_ID]).is_empty())
	var marker: float = registry.MISSING_FOOTPRINT_MARKER_METRES
	_ok("it is still clickable at the marker size, so the failure is visible rather than silent",
		_cell_of(_ray_down(space, boardless_centre)) == BOARDLESS_ID,
		_describe(_ray_down(space, boardless_centre)))
	_ok("but not out to where a room would have been, so it cannot pass for one",
		_ray_down(space, boardless_centre + Vector3(marker * 0.5 + OUTSIDE_MARGIN, 0.0, 0.0)).is_empty(),
		"%.2f m from centre of a %.2f m marker" % [marker * 0.5 + OUTSIDE_MARGIN, marker])

	cell_root.queue_free()
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

func _ray_down(space: PhysicsDirectSpaceState3D, at: Vector3) -> Dictionary:
	var query := PhysicsRayQueryParameters3D.create(at + Vector3(0.0, RAY_HEIGHT, 0.0), at - Vector3(0.0, RAY_HEIGHT, 0.0))
	return space.intersect_ray(query)

## The cell a hit belongs to, or "" for a miss. Read off the holder the viewer
## named, which is the same route `_on_cell_clicked` takes to its cell id.
func _cell_of(hit: Dictionary) -> String:
	if hit.is_empty():
		return ""
	var collider: Node = hit["collider"]
	return String(collider.get_parent().name).trim_prefix("Cell_")

func _hit_y(hit: Dictionary) -> float:
	return -1.0 if hit.is_empty() else float(hit["position"].y)

func _describe(hit: Dictionary) -> String:
	return "nothing was hit" if hit.is_empty() else "hit %s at y = %.3f" % [_cell_of(hit), _hit_y(hit)]

func _position_of(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s %s" % [label, detail])
	else:
		_failed += 1
		print("FAIL %s %s" % [label, detail])
