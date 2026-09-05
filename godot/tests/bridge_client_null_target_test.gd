extends SceneTree
## A walk through an exit that leaves the loaded subset must be *rejected*,
## and the rejection must say so.
##
## Issue #376's second instance. `bridge_client.gd`'s mock `send_intent` read
## the manifest's nullable `targetCellId` into a typed local:
##
##     var target_id: String = exit.get("targetCellId", "")
##
## A null `targetCellId` is the manifest's documented way of saying an exit
## points outside the loaded subset - `world_manifest_loader.true_exits()`
## calls the null "the whole signal, in both the mock fixture and a live
## snapshot" - and assigning Nil to a typed `String` raises "Trying to assign
## value of type 'Nil' to a variable of type 'String'" and abandons the
## function. The two lines below it exist to reject exactly that case and
## could never run. So walking one of the mock board's thirteen null-targeted
## exits produced no snapshot, no rejection, and no signal at all: the click
## went nowhere and nothing anywhere said why.
##
## The fix shipped in PR #377 with no test. This is it.
##
## # What is asserted, and why in this shape
##
## The property is not "1-40 east is rejected". It is that a null-targeted
## exit is **rejected with the outside-the-manifest reason** - not dropped, not
## raised, and not confused with the different rejection one line above it
## ("not a true exit of the current room", which a null-targeted exit is not:
## it is a perfectly true exit with nowhere local to go).
##
## Three things follow from that, and each is a deliberate guard against a
## test that would pass for the wrong reason:
##
##   - **The chooser is tested where the wrong answer is available.** Nine of
##     the mock's nineteen cells carry a null-targeted exit *and* a resolvable
##     one. Every one of the nine is walked both ways. A change that rejected
##     everything would pass a null-only test and fails this one on the
##     resolvable half; a change that accepted everything fails on the null
##     half. Neither can be got right by accident.
##   - **The reason is read out of `bridge_client.gd`, not retyped here.** A
##     copy of a string is a second thing answering one question, and the two
##     drift. The parse is asserted before it is trusted to condemn anything.
##   - **A third case the fixture cannot supply**: an exit whose target is a
##     real string naming a cell that is not in the manifest. That is the other
##     half of the same `if`, it reaches the same rejection, and no cell in the
##     checked-in world has one - so it is built with
##     `WorldManifestLoader.load_from_snapshot()` and torn down afterwards.
##
## `MIN_EXPECTED_CHECKS` exists because GDScript has no catchable exception: a
## raise aborts the running function and still lets the summary print. That is
## precisely the failure mode of the bug under test, so a floor on the
## denominator is what stops "0 checked, 0 failed" reading as a pass.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const BRIDGE_SOURCE := "res://scripts/bridge_client.gd"
const WORLD_ID := "null-target-test"

## Nine cells carry both kinds of exit today, across thirteen null targets.
## Far enough below that editing the fixture never touches these, high enough
## that a walk which found nothing cannot clear them - the numbers that go to
## zero when the fixture reader breaks, rather than when the viewer is clean.
const MIN_AMBIGUOUS_CELLS := 6
const MIN_NULL_EXITS := 9

## Named so the N-of-N sweeps above cannot pass by being a blanket change: this
## is the cell issue #376 was traced through, and it is asserted by name as
## well as by population.
const NAMED_CELL := "1-40"

## 21 are asserted today.
const MIN_EXPECTED_CHECKS := 16

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var loader: Node = root.get_node("WorldManifestLoader")
	var bridge: Node = root.get_node("BridgeClient")

	_ok("the mock fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))

	# The reason the fix makes reachable, read out of the source that emits it.
	var expected_reason := _rejection_reason()
	_ok("the harness read the outside-the-manifest reason out of %s (%s)" % [BRIDGE_SOURCE, expected_reason],
		expected_reason != "" and expected_reason.contains("manifest"))

	var rejections: Array = []
	var snapshots: Array = []
	bridge.intent_rejected.connect(func(intent, reason): rejections.append({"intent": intent, "reason": reason}))
	bridge.snapshot_updated.connect(func(snapshot): snapshots.append(snapshot))

	# -- the population, before anything is concluded from it --
	var ambiguous := _cells_with_both_kinds(loader)
	_ok("the fixture carries cells with a null-targeted exit AND a resolvable one (%d cells, floor %d)"
		% [ambiguous.size(), MIN_AMBIGUOUS_CELLS], ambiguous.size() >= MIN_AMBIGUOUS_CELLS)
	_ok("and %s, the cell issue #376 was traced through, is one of them" % NAMED_CELL,
		_named_entry(ambiguous, NAMED_CELL) != null)

	# -- N of N, both ways, from every one of those cells --
	var not_rejected: Array = []
	var wrong_reason: Array = []
	var drew_a_snapshot: Array = []
	var room_moved_anyway: Array = []
	var refused_a_real_exit: Array = []
	var did_not_move: Array = []
	var rejected_a_real_exit: Array = []
	var null_walks := 0

	for entry in ambiguous:
		var cell_id: String = entry["cell"]

		for move in entry["null_moves"]:
			null_walks += 1
			_ok_silent(bridge.start_mock(WORLD_ID, cell_id))
			rejections.clear()
			snapshots.clear()
			bridge.send_intent({"kind": "walk", "fromRoomId": cell_id, "exitMove": move})
			var where := "%s via '%s'" % [cell_id, move]
			if rejections.size() != 1:
				not_rejected.append("%s -> %d rejections" % [where, rejections.size()])
			elif str(rejections[0]["reason"]) != expected_reason:
				wrong_reason.append("%s -> '%s'" % [where, str(rejections[0]["reason"])])
			if not snapshots.is_empty():
				drew_a_snapshot.append(where)
			if str(bridge.current_snapshot.get("currentRoomId", "")) != cell_id:
				room_moved_anyway.append("%s -> %s" % [where, str(bridge.current_snapshot.get("currentRoomId", ""))])

		# The wrong answer, available from the same cell in the same run.
		var real_move: String = entry["real_move"]
		var real_target: String = entry["real_target"]
		_ok_silent(bridge.start_mock(WORLD_ID, cell_id))
		rejections.clear()
		snapshots.clear()
		bridge.send_intent({"kind": "walk", "fromRoomId": cell_id, "exitMove": real_move})
		var real_where := "%s via '%s' -> %s" % [cell_id, real_move, real_target]
		if snapshots.size() != 1:
			refused_a_real_exit.append("%s -> %d snapshots" % [real_where, snapshots.size()])
		if not rejections.is_empty():
			rejected_a_real_exit.append("%s -> '%s'" % [real_where, str(rejections[0]["reason"])])
		if str(bridge.current_snapshot.get("currentRoomId", "")) != real_target:
			did_not_move.append("%s -> %s" % [real_where, str(bridge.current_snapshot.get("currentRoomId", ""))])

	_ok("every null-targeted exit walked was rejected exactly once (%d walks, floor %d)" % [null_walks, MIN_NULL_EXITS],
		null_walks >= MIN_NULL_EXITS and not_rejected.is_empty(), str(not_rejected))
	_ok("and rejected as outside the loaded manifest, not as a non-exit",
		wrong_reason.is_empty(), str(wrong_reason))
	_ok("and none of them produced a snapshot", drew_a_snapshot.is_empty(), str(drew_a_snapshot))
	_ok("and none of them moved the player", room_moved_anyway.is_empty(), str(room_moved_anyway))
	_ok("a resolvable exit from those same cells is still accepted (%d cells)" % ambiguous.size(),
		refused_a_real_exit.is_empty(), str(refused_a_real_exit))
	_ok("and is not rejected", rejected_a_real_exit.is_empty(), str(rejected_a_real_exit))
	_ok("and it actually moves the player to the exit's target", did_not_move.is_empty(), str(did_not_move))

	# -- the same thing again, by name, so a sweep cannot pass by being blanket --
	# Untyped on purpose: `_named_entry` returns null when it finds nothing, and
	# `var x: Dictionary = <null>` is the exact coercion this whole file is about.
	var named = _named_entry(ambiguous, NAMED_CELL)
	if named != null:
		var null_move: String = named["null_moves"][0]
		_ok_silent(bridge.start_mock(WORLD_ID, NAMED_CELL))
		rejections.clear()
		snapshots.clear()
		bridge.send_intent({"kind": "walk", "fromRoomId": NAMED_CELL, "exitMove": null_move})
		_ok("%s via '%s' is rejected as outside the loaded manifest" % [NAMED_CELL, null_move],
			rejections.size() == 1 and str(rejections[0]["reason"]) == expected_reason,
			str(rejections))
		_ok("and %s stays where it was" % NAMED_CELL,
			str(bridge.current_snapshot.get("currentRoomId", "")) == NAMED_CELL)
		_ok_silent(bridge.start_mock(WORLD_ID, NAMED_CELL))
		rejections.clear()
		snapshots.clear()
		bridge.send_intent({"kind": "walk", "fromRoomId": NAMED_CELL, "exitMove": named["real_move"]})
		_ok("%s via '%s' still walks to %s" % [NAMED_CELL, named["real_move"], named["real_target"]],
			str(bridge.current_snapshot.get("currentRoomId", "")) == named["real_target"] and snapshots.size() == 1)

	# -- the other half of the same `if`, which no cell in the fixture supplies --
	#
	# A target that is a real String naming a cell the manifest does not carry.
	# The typed read does not raise on this one, so it is not the #376 case; it
	# shares the rejection, and a fix that only special-cased null would leave
	# it unreachable. Built here rather than added to the checked-in fixture,
	# which is a contract subject other tools assert against.
	var synthetic_ok: bool = loader.load_from_snapshot({
		"protocol": 1,
		"worldId": WORLD_ID,
		"currentRoomId": "S-1",
		"cells": [
			{
				"id": "S-1", "title": "Synthetic Origin",
				"position": {"x": 0, "y": 0, "z": 0},
				"exits": [
					{"move": "north", "direction": "north", "targetRoomId": 9001, "targetCellId": "S-404"},
					{"move": "east", "direction": "east", "targetRoomId": 9002, "targetCellId": "S-2"},
				],
			},
			{
				"id": "S-2", "title": "Synthetic Neighbour",
				"position": {"x": 5, "y": 0, "z": 0}, "exits": [],
			},
		],
	})
	_ok("a synthetic manifest with an unresolvable string target loads", synthetic_ok)
	_ok("and S-404 really is absent from it, which is the whole point of the case",
		not loader.has_cell("S-404") and loader.has_cell("S-2"))

	_ok_silent(bridge.start_mock(WORLD_ID, "S-1"))
	rejections.clear()
	snapshots.clear()
	bridge.send_intent({"kind": "walk", "fromRoomId": "S-1", "exitMove": "north"})
	_ok("an exit naming a cell outside the manifest is rejected with the same reason",
		rejections.size() == 1 and str(rejections[0]["reason"]) == expected_reason, str(rejections))
	_ok("and it draws no snapshot and does not move the player",
		snapshots.is_empty() and str(bridge.current_snapshot.get("currentRoomId", "")) == "S-1")

	# The control on the synthetic harness itself: it is not simply refusing
	# everything, which would make the two checks above worthless.
	_ok_silent(bridge.start_mock(WORLD_ID, "S-1"))
	rejections.clear()
	snapshots.clear()
	bridge.send_intent({"kind": "walk", "fromRoomId": "S-1", "exitMove": "east"})
	_ok("and the resolvable exit of that same synthetic cell still walks",
		rejections.is_empty() and snapshots.size() == 1
			and str(bridge.current_snapshot.get("currentRoomId", "")) == "S-2")

	# Leave the loader on the checked-in world, not on a fixture this test made.
	_ok("the checked-in fixture reloads after the synthetic one", loader.load_from_path(MOCK_FIXTURE_PATH))

	_ok("this script asserted at least %d checks" % MIN_EXPECTED_CHECKS, _checked >= MIN_EXPECTED_CHECKS)
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

## Every cell carrying a null-targeted exit *and* a resolvable one, with both
## moves named, so each cell is walked into the wrong answer and the right one.
func _cells_with_both_kinds(loader: Node) -> Array:
	var found: Array = []
	var ids: Array = loader.cells.keys()
	ids.sort()
	for cell_id in ids:
		var null_moves: Array = []
		var real_move := ""
		var real_target := ""
		for exit in loader.true_exits(cell_id):
			var target = exit.get("targetCellId")
			var move := str(exit.get("move", ""))
			if move == "":
				continue
			if not (target is String) or str(target) == "":
				null_moves.append(move)
			elif real_move == "" and loader.has_cell(str(target)):
				real_move = move
				real_target = str(target)
		if not null_moves.is_empty() and real_move != "":
			found.append({"cell": str(cell_id), "null_moves": null_moves, "real_move": real_move, "real_target": real_target})
	return found

func _named_entry(entries: Array, cell_id: String):
	for entry in entries:
		if entry["cell"] == cell_id:
			return entry
	return null

## The reason string `send_intent` emits for a destination outside the loaded
## manifest, read out of the producer rather than retyped here.
func _rejection_reason() -> String:
	var file := FileAccess.open(BRIDGE_SOURCE, FileAccess.READ)
	if file == null:
		return ""
	var source := file.get_as_text()
	file.close()
	var re := RegEx.new()
	re.compile('intent_rejected[.]emit[(]intent,\\s*["]([^"]*manifest[^"]*)["]')
	var hit := re.search(source)
	return hit.get_string(1) if hit != null else ""

## A precondition of the case being set up, not one of the properties under
## test: a `start_mock` that failed would make every check after it vacuous, so
## it aborts loudly rather than quietly asserting against an unmoved bridge.
func _ok_silent(condition: bool) -> void:
	if not condition:
		_failed += 1
		_checked += 1
		print("FAIL the harness could not put the bridge in the room it meant to")

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s  %s" % [label, detail])
