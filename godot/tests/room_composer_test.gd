extends SceneTree
## `RoomComposer` against hand-written specs, in the engine, headlessly.
##
##   Godot_v4.3-stable_win64_console.exe --headless --path godot \
##       --script res://tests/room_composer_test.gd
##
## or through `node tools/godot-tests.mjs` with the rest of the suite.
##
## This is the unit half. The end-to-end half is `python/test_room_player.py`,
## which drives a real room out of Lich's map database through the TCP API and
## into this same composer; the two exist for different reasons and neither
## replaces the other. This one can state the arithmetic exactly - 81 ground
## tiles, 32 perimeter cells, three cells cleared per opening - because it
## chooses the input. That one proves the arithmetic survives a real room, a
## socket and a JSON round trip.
##
## Every case asserts a property rather than a mechanism, because a test
## asserting the mechanism is a test that has to be edited to make a fix pass.

const RoomComposer := preload("res://scripts/room_composer.gd")
const RoomPrimitives := preload("res://scripts/room_primitives.gd")

var _checked := 0
var _failed := 0

## The real count is in the high thirties. Far enough below that adding a case
## never touches it, high enough that a run which died on line one of `_run`
## cannot reach "all passed" - GDScript has no catchable runtime error, so
## `_initialize` keeps going after a crash inside `_run` and would otherwise
## print `0 checked, 0 failed`.
const MIN_EXPECTED_CHECKS := 25


func _initialize() -> void:
	_run()
	print("%d checked, %d failed" % [_checked, _failed])
	if _checked < MIN_EXPECTED_CHECKS:
		print("FAIL denominator: only %d checks ran, floor is %d; something aborted early"
			% [_checked, MIN_EXPECTED_CHECKS])
		_failed += 1
	if _failed == 0:
		print("all passed")
	quit(1 if _failed > 0 else 0)


func _ok(label: String, condition: bool, detail: String = "") -> bool:
	_checked += 1
	if not condition:
		_failed += 1
		print("FAIL %s%s" % [label, (": " + detail) if detail != "" else ""])
	return condition


func _eq(label: String, got, want) -> bool:
	return _ok(label, got == want, "got %s, wanted %s" % [str(got), str(want)])


## A minimal well-formed spec, in the shape `forge.compose.Scene.to_dict()`
## produces. Anything a case wants to vary it overrides.
func _spec(overrides: Dictionary = {}) -> Dictionary:
	var base := {
		"room_id": 4242,
		"archetype": "interior",
		"ground": "wood-floor",
		"ground_source": "text",
		"boundary": "wall",
		"canopy": "ceiling",
		"openings": ["north"],
		"placements": [],
		"light": null,
		"palette": null,
		"varied": [],
		"unplaced": 0,
	}
	for key in overrides:
		base[key] = overrides[key]
	return base


func _rows(report: Dictionary, role: String) -> Array:
	var out := []
	for row in report["nodes"]:
		if row["role"] == role:
			out.append(row)
	return out


func _run() -> void:
	_projection()
	_perimeter()
	_ground_and_boundary()
	_openings()
	_placements()
	_unknown_kinds()
	_bad_spec()


# ---------------------------------------------------------------------------


func _projection() -> void:
	# The one formula the whole layout hangs on, asserted as numbers rather
	# than re-derived from the constants it is testing.
	_eq("iso origin", RoomComposer.iso(0.0, 0.0), Vector2(0.0, 0.0))
	_eq("iso +x is down-right", RoomComposer.iso(1.0, 0.0), Vector2(32.0, 16.0))
	_eq("iso +y is down-left", RoomComposer.iso(0.0, 1.0), Vector2(-32.0, 16.0))
	_eq("iso is linear", RoomComposer.iso(2.0, 2.0), Vector2(0.0, 64.0))

	# Compass words have to land where a player would look for them, or the
	# room is unnavigable however pretty it is.
	var north := RoomComposer.iso(
		float(RoomComposer.RING["north"].x), float(RoomComposer.RING["north"].y))
	var south := RoomComposer.iso(
		float(RoomComposer.RING["south"].x), float(RoomComposer.RING["south"].y))
	var east := RoomComposer.iso(
		float(RoomComposer.RING["east"].x), float(RoomComposer.RING["east"].y))
	var west := RoomComposer.iso(
		float(RoomComposer.RING["west"].x), float(RoomComposer.RING["west"].y))
	_ok("north is up the screen", north.y < 0.0 and is_equal_approx(north.x, 0.0), str(north))
	_ok("south is down the screen", south.y > 0.0 and is_equal_approx(south.x, 0.0), str(south))
	_ok("east is right of centre", east.x > 0.0 and is_equal_approx(east.y, 0.0), str(east))
	_ok("west is left of centre", west.x < 0.0 and is_equal_approx(west.y, 0.0), str(west))


func _perimeter() -> void:
	var ring := RoomComposer.perimeter()
	_eq("perimeter is 8*RADIUS cells", ring.size(), RoomComposer.RADIUS * 8)

	var seen := {}
	for cell in ring:
		seen[cell] = true
	_eq("perimeter has no repeated cell", seen.size(), ring.size())

	# The eight compass cells are on it, evenly spaced. This is what lets an
	# opening's gap be checked by arithmetic instead of by eye.
	var spacing_ok := true
	for dir in RoomComposer.RING:
		var at := ring.find(RoomComposer.RING[dir])
		if at < 0 or at % RoomComposer.RADIUS != 0:
			spacing_ok = false
	_ok("every compass point is on the perimeter at a multiple of RADIUS", spacing_ok)


func _ground_and_boundary() -> void:
	var root: Node2D = RoomComposer.compose(_spec({"openings": []}))
	var report: Dictionary = RoomComposer.report(root)
	var side := RoomComposer.RADIUS * 2 + 1

	_eq("ground fills the square grid", int(report["counts"]["ground"]), side * side)
	_eq("with no openings the boundary is the whole perimeter",
		int(report["counts"]["boundary"]), RoomComposer.RADIUS * 8)
	_eq("exactly one canopy", int(report["counts"]["canopy"]), 1)
	_eq("a well-formed spec produces no problems",
		(report["room"]["problems"] as Array).size(), 0)

	# The report must describe the tree, so its own tally has to agree with
	# what the walk found. A report assembled from the spec would pass every
	# other case in this file while the composer built nothing.
	var tagged := int(report["counts"]["ground"]) + int(report["counts"]["boundary"]) \
		+ int(report["counts"]["opening"]) + int(report["counts"]["canopy"]) \
		+ int(report["counts"]["placement"])
	_eq("counts add up to the tagged nodes walked", int(report["counts"]["tagged"]), tagged)
	_ok("there are more nodes than tagged holders (shapes and labels exist)",
		int(report["counts"]["node_total"]) > tagged)

	# Painter's order: something at the south of the room must draw over
	# something at the north, or the room renders inside out.
	var north_z := 0
	var south_z := 0
	for row in _rows(report, "ground"):
		if row["grid"] == [-RoomComposer.RADIUS, -RoomComposer.RADIUS]:
			north_z = int(row["z"])
		if row["grid"] == [RoomComposer.RADIUS, RoomComposer.RADIUS]:
			south_z = int(row["z"])
	_ok("the near (south) corner draws after the far (north) one",
		south_z > north_z, "north z=%d south z=%d" % [north_z, south_z])

	# An outdoor room has nothing built at its edge. That is an answer, and it
	# has to be distinguishable from a boundary that failed to compose.
	root.free()
	var outdoor: Node2D = RoomComposer.compose(
		_spec({"archetype": "outdoor", "boundary": "open", "canopy": "sky", "openings": []}))
	var outdoor_report: Dictionary = RoomComposer.report(outdoor)
	_eq("an open boundary still occupies the perimeter",
		int(outdoor_report["counts"]["boundary"]), RoomComposer.RADIUS * 8)
	_eq("and says it is not built", outdoor_report["room"]["boundary_built"], false)
	var any_visible := false
	for row in _rows(outdoor_report, "boundary"):
		if row["visible"]:
			any_visible = true
	_ok("and draws none of it", not any_visible)
	outdoor.free()


func _openings() -> void:
	var dirs := ["north", "east", "southwest"]
	var root: Node2D = RoomComposer.compose(_spec({"openings": dirs}))
	var report: Dictionary = RoomComposer.report(root)

	_eq("one opening node per opening in the spec", int(report["counts"]["opening"]), dirs.size())
	var got := []
	for row in report["openings"]:
		got.append(row["dir"])
	got.sort()
	var want := dirs.duplicate()
	want.sort()
	_eq("and they are the ones asked for", got, want)

	# Each opening clears itself and one cell either side, so a doorway reads
	# as a gap. Asserting the property (a gap of the declared width exists)
	# rather than the loop that makes it.
	var cleared := dirs.size() * (RoomComposer.OPENING_HALF_GAP * 2 + 1)
	_eq("each opening clears a gap of the declared width",
		int(report["counts"]["boundary"]), RoomComposer.RADIUS * 8 - cleared)

	var boundary_cells := {}
	for row in _rows(report, "boundary"):
		boundary_cells[str(row["grid"])] = true
	var all_clear := true
	for dir in dirs:
		var cell: Vector2i = RoomComposer.RING[dir]
		if boundary_cells.has(str([cell.x, cell.y])):
			all_clear = false
	_ok("no boundary segment sits in an opening", all_clear)

	for row in report["openings"]:
		_ok("opening %s is on the boundary" % row["dir"], row["on_boundary"])
	root.free()

	# `up` and `out` are real exits with no bearing on the floor. They must
	# still appear, and must not claim a compass position they never had.
	var vertical: Node2D = RoomComposer.compose(_spec({"openings": ["up", "out"]}))
	var vertical_report: Dictionary = RoomComposer.report(vertical)
	_eq("a non-compass exit is still an opening", int(vertical_report["counts"]["opening"]), 2)
	_eq("and clears no boundary", int(vertical_report["counts"]["boundary"]), RoomComposer.RADIUS * 8)
	var off_boundary := true
	for row in vertical_report["openings"]:
		if row["on_boundary"]:
			off_boundary = false
	_ok("and says it is not on the boundary", off_boundary)
	vertical.free()


func _placements() -> void:
	var placements := [
		{"kind": "door", "where": "edge", "source": "text", "term": "go dark forge"},
		{"kind": "door", "where": "edge", "source": "text", "term": "go white building"},
		{"kind": "tree-broadleaf", "where": "north", "source": "rule", "term": "oak",
			"scale": "huge", "tint": "green"},
		{"kind": "well", "where": "center", "source": "text", "term": "fountain"},
		{"kind": "vine", "where": "canopy", "source": "text", "term": "ivy"},
	]
	var root: Node2D = RoomComposer.compose(_spec({"placements": placements}))
	var report: Dictionary = RoomComposer.report(root)

	_eq("every placement in the spec is in the tree",
		int(report["counts"]["placement"]), placements.size())

	# Not just the right *number*: the right ones, each traceable back to the
	# index it came from. A composer that emitted five copies of the first
	# placement passes a count and fails this.
	var by_index := {}
	for row in _rows(report, "placement"):
		by_index[int(row["spec_index"])] = row
	_eq("each placement is traceable to its spec index", by_index.size(), placements.size())
	var kinds_match := true
	for i in range(placements.size()):
		if not by_index.has(i) or by_index[i]["kind"] != placements[i]["kind"]:
			kinds_match = false
	_ok("and carries the kind that spec entry asked for", kinds_match)

	# Edge doors are spread, not stacked: two doors must not share a cell.
	var edge_cells := []
	for i in [0, 1]:
		edge_cells.append(str(by_index[i]["grid"]))
	_ok("two edge doors land on different perimeter cells", edge_cells[0] != edge_cells[1],
		str(edge_cells))

	var tree_row: Dictionary = by_index[2]
	_eq("a compass placement lands on its ring cell", tree_row["grid"],
		[RoomComposer.RING["north"].x, RoomComposer.RING["north"].y])
	_ok("a recognised scale word is applied", tree_row["scale_applied"])
	_ok("a recognised tint word is applied", tree_row["tint_applied"])
	_eq("a `center` placement is at the origin cell", by_index[3]["grid"], [0, 0])

	# The projection has to be honoured by the node that was actually built,
	# not merely by the helper. Same claim, checked from the tree.
	#
	# The stack offset is in the arithmetic on purpose. This case first failed
	# by six pixels because an edge door had already taken the north cell, so
	# the tree was nudged clear of it - a real behaviour that the report was
	# applying and not recording. Adding `stack_offset` to the report made the
	# difference explainable instead of making the assertion looser.
	var expected := RoomComposer.iso(float(tree_row["grid"][0]), float(tree_row["grid"][1]))
	_eq("the node sits where the projection plus its recorded nudge says",
		tree_row["pos"], [expected.x, expected.y + float(tree_row["stack_offset"])])
	_ok("nothing moves without the report saying so",
		int(tree_row["stack"]) > 0 or is_equal_approx(float(tree_row["stack_offset"]), 0.0))
	root.free()


func _unknown_kinds() -> void:
	# A kind the primitive table has never heard of must be loud. A silent
	# grey default would make a forge emitting `tree-brodleaf` look exactly
	# like one emitting `tree-broadleaf`.
	var root: Node2D = RoomComposer.compose(_spec({
		"placements": [{"kind": "tree-brodleaf", "where": "north", "source": "rule"}],
	}))
	var report: Dictionary = RoomComposer.report(root)
	_eq("an unrecognised kind is reported", report["unknown_kinds"], ["tree-brodleaf"])
	_eq("and is still placed rather than dropped", int(report["counts"]["placement"]), 1)
	root.free()

	_ok("a known kind is not reported as unknown",
		not bool(RoomPrimitives.of("tree-broadleaf")["unknown"]))
	_ok("an unknown scale word is not silently applied",
		not RoomPrimitives.scale_known("gargantuan"))
	_eq("and leaves the size alone", RoomPrimitives.scale_of("gargantuan"), 1.0)


func _bad_spec() -> void:
	# A spec this cannot read still produces a root carrying the reasons.
	# Returning null would make "refused" and "built nothing" identical.
	var root: Node2D = RoomComposer.compose({})
	var report: Dictionary = RoomComposer.report(root)
	var problems: Array = report["room"]["problems"]
	_ok("an empty spec is refused with reasons, not silently", problems.size() >= 4,
		str(problems))
	_eq("and nothing is placed", int(report["counts"]["placement"]), 0)
	root.free()

	var odd: Node2D = RoomComposer.compose(_spec({
		"openings": ["widdershins"],
		"placements": [{"kind": "well", "where": "somewhere", "source": "rule"}],
	}))
	var odd_report: Dictionary = RoomComposer.report(odd)
	var odd_problems: Array = odd_report["room"]["problems"]
	var named_direction := false
	var named_position := false
	for problem in odd_problems:
		if str(problem).contains("widdershins"):
			named_direction = true
		if str(problem).contains("somewhere"):
			named_position = true
	_ok("an unknown direction is named in the problems", named_direction, str(odd_problems))
	_ok("an unknown position is named in the problems", named_position, str(odd_problems))
	_eq("and the placement is still built, anchored at centre",
		int(odd_report["counts"]["placement"]), 1)
	odd.free()
