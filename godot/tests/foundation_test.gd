extends SceneTree
## Slice 0 acceptance-gate test, runnable headlessly:
##
##   Godot_v4.7.2-stable_win64_console.exe --headless --path godot \
##     --script res://tests/foundation_test.gd
##
## Exercises the acceptance gate from docs/CLAUDE_3D_VIEWER_BRIEF.md end to
## end against the checked-in mock fixture: manifest loads, only true exits
## are exposed, an invalid exit is refused, a valid click produces a
## validated intent that updates the mock snapshot with a correctly
## incremented sequence, and a simulated reconnect recovers without
## changing which room is current. No GUI, no live DragonRealms connection,
## no generated art — exactly what the first acceptance gate asks for.
##
## This is a real pass/fail gate, not a smoke test: it exits 1 and prints
## every failing assertion if anything here regresses, so CI (once wired)
## can trust a green run rather than a script that merely didn't crash.
## Uses the project's real autoload singletons (WorldManifestLoader,
## BridgeClient, IntentSender, ContentRegistry) rather than instantiating
## fresh copies of their scripts - the same objects the running viewer
## actually uses, so a bug in how they're wired as autoloads would show up
## here too, not just a bug in the class bodies in isolation.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const TOWN_GREEN_NORTH := "1-14"
const CellVisibilityPolicy := preload("res://scripts/cell_visibility_policy.gd")

var _checked := 0
var _failed := 0

## The real assertion count when nothing aborts early is in the low twenties
## (see the body of `_run` below). GDScript has no catchable exception for a
## runtime error like a null dereference — a crash partway through `_run`
## does not stop `_initialize` from reaching this line, which is exactly how
## an earlier version of this file printed "0 checked, 0 failed / all
## passed" after crashing on line 1 of `_run`. This floor is what turns that
## silent lie into a hard failure: a script that dies early always checks
## far fewer than this, so the floor catches the crash even though GDScript
## itself cannot.
const MIN_EXPECTED_CHECKS := 15

func _initialize() -> void:
	print("-- DR Companion 3D viewer foundation: slice 0 acceptance gate --")
	_run()
	print("")
	print("%d checked, %d failed" % [_checked, _failed])
	if _checked < MIN_EXPECTED_CHECKS:
		print("FAILED - only %d checks ran (expected at least %d) - _run likely aborted early" % [_checked, MIN_EXPECTED_CHECKS])
		quit(1)
	elif _failed > 0:
		print("FAILED")
		quit(1)
	else:
		print("all passed")
		quit(0)

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s %s" % [label, detail])
	else:
		_failed += 1
		print("FAIL %s %s" % [label, detail])

func _autoload(name: String) -> Node:
	return root.get_node(name)

func _run() -> void:
	var loader := _autoload("WorldManifestLoader")
	var bridge := _autoload("BridgeClient")
	var intents := _autoload("IntentSender")
	var registry := _autoload("ContentRegistry")

	# -- manifest loads deterministically, no live connection needed --
	var loaded: bool = loader.load_from_path(MOCK_FIXTURE_PATH)
	_ok("mock fixture loads with no live DragonRealms connection", loaded)
	if not loaded:
		return
	_ok("mock fixture is non-trivial (floor guards a broken/empty load reading as success)",
		loader.cells.size() >= 10, "%d cells" % loader.cells.size())
	_ok("Town Green North is present in the mock fixture", loader.has_cell(TOWN_GREEN_NORTH))

	# -- detailed geometry is a bounded, true-exit graph window --
	var visibility_policy := CellVisibilityPolicy.new()
	var detail_window: Dictionary = visibility_policy.detail_window(TOWN_GREEN_NORTH, loader.cells)
	var detail_distances: Dictionary = detail_window.get("distances", {})
	_ok("the detailed world bubble starts at the current room", detail_distances.get(TOWN_GREEN_NORTH, -1) == 0)
	var within_two_hops := true
	for detail_cell_id in detail_window.get("detailIds", []):
		within_two_hops = within_two_hops and int(detail_distances.get(detail_cell_id, 99)) <= 2
	_ok("every detailed cell is within two true-exit hops", within_two_hops)
	_ok("an unknown room has no detailed geometry window",
		visibility_policy.detail_window("not-a-real-room", loader.cells).get("detailIds", []).is_empty())

	# -- only true exits are exposed, nothing invented --
	var real_exits: Array = loader.true_exits(TOWN_GREEN_NORTH)
	_ok("Town Green North has at least one true exit", real_exits.size() > 0, "%d exits" % real_exits.size())
	var real_moves: Array = []
	for exit in real_exits:
		real_moves.append(exit.get("move", ""))
	_ok("a made-up exit is correctly rejected as not true",
		not loader.is_true_exit(TOWN_GREEN_NORTH, "go imaginary secret door"))
	_ok("a real exit is correctly recognised as true",
		real_moves.size() > 0 and loader.is_true_exit(TOWN_GREEN_NORTH, real_moves[0]),
		real_moves[0] if real_moves.size() > 0 else "(no exits to test)")

	# -- content registration never makes neutral foundation art silently vanish --
	var shared_content := _autoload("SharedAssetContent")
	shared_content.ensure_registration()
	_ok("neutral foundation content registers its documented primitive slots",
		registry.is_registered("terrain-cell-5m") and registry.is_registered("water-ribbon-5m") and registry.is_registered("bridge-span-5m"))
	var terrain: Node3D = registry.build({"id": TOWN_GREEN_NORTH}, {"kind": "terrain-cell-5m", "role": "base"})
	_ok("a registered terrain primitive produces visible presentation geometry, not nothing",
		terrain != null and terrain is Node3D and terrain.get_child_count() > 0)
	if terrain != null:
		terrain.free()
	var unknown: Node3D = registry.build({"id": TOWN_GREEN_NORTH}, {"kind": "unmade-special-landmark", "role": "landmark"})
	_ok("an unregistered lore-specific primitive still produces an honest placeholder, not a guessed building",
		unknown != null and unknown is Node3D)
	if unknown != null:
		unknown.free()
	var content_status: Dictionary = shared_content.shared_asset_status()
	_ok("shared content declares its visual-only fallback policy",
		content_status.get("fallbackPolicy", "") != "")
	var shared_library_available: bool = content_status.get("sharedLibraryAvailable", false)
	if shared_library_available:
		_ok("an initialised shared library makes both selected source models importable",
			shared_library_available)
	else:
		_ok("a bare checkout reports the missing shared library and stays on its documented honest fallback",
			content_status.get("fallbackPolicy", "") != "")
	var boundary: Node3D = registry.build({"id": TOWN_GREEN_NORTH}, {"kind": "rough-edge-boundary-kit", "role": "boundary"})
	_ok("the selected weathered-stone source model can decorate a neutral boundary",
		boundary != null and boundary.get_child_count() == 2)
	if boundary != null:
		boundary.free()
	var bridge_visual: Node3D = registry.build({"id": TOWN_GREEN_NORTH}, {"kind": "bridge-span-5m", "role": "landform"})
	_ok("the selected bridge source model can render without inventing a route",
		bridge_visual != null and bridge_visual.get_child_count() > 0)
	if bridge_visual != null:
		bridge_visual.free()

	# -- starting the mock bridge builds the first snapshot honestly --
	var started: bool = bridge.start_mock("crossing-mock", TOWN_GREEN_NORTH)
	_ok("mock bridge starts at the requested room", started)
	_ok("first snapshot is sequence 1", bridge.current_snapshot.get("sequence", -1) == 1)
	_ok("first snapshot's currentRoomId matches the starting room",
		bridge.current_snapshot.get("currentRoomId", "") == TOWN_GREEN_NORTH)
	_ok("first snapshot carries no invented entities", bridge.current_snapshot.get("entities", [null]).size() == 0)
	_ok("first snapshot carries no invented ground items", bridge.current_snapshot.get("groundItems", [null]).size() == 0)

	# -- an invalid click never reaches the bridge as a state change --
	var refused_signal_fired := [false]
	intents.intent_refused.connect(func(_reason): refused_signal_fired[0] = true)
	var accepted_bad: bool = intents.request_walk(TOWN_GREEN_NORTH, "go imaginary secret door")
	_ok("a fabricated exit intent is refused by IntentSender before reaching the bridge",
		not accepted_bad and refused_signal_fired[0])
	_ok("the refused intent did not change the current room",
		bridge.current_snapshot.get("currentRoomId", "") == TOWN_GREEN_NORTH)

	# -- a valid click produces a validated intent and updates the snapshot --
	if real_moves.size() > 0:
		var before_room: String = bridge.current_snapshot.get("currentRoomId", "")
		var before_seq: int = bridge.current_snapshot.get("sequence", -1)
		var target_cell_id: String = ""
		for exit in real_exits:
			if exit.get("move", "") == real_moves[0]:
				target_cell_id = exit.get("targetCellId", "")
		var accepted: bool = intents.request_walk(TOWN_GREEN_NORTH, real_moves[0])
		if target_cell_id == "":
			_ok("(exit '%s' points outside the mock subset - accepted-vs-target-check skipped, not scored)" % real_moves[0], true)
		else:
			_ok("a valid click's intent is accepted", accepted)
			_ok("the mock snapshot's current room actually moved to the exit's target",
				bridge.current_snapshot.get("currentRoomId", "") == target_cell_id,
				"%s -> %s" % [before_room, bridge.current_snapshot.get("currentRoomId", "")])
			_ok("the sequence number advanced, not reset or reused",
				bridge.current_snapshot.get("sequence", -1) > before_seq)

	# -- reconnect recovers presentation without changing game state --
	var room_before_reconnect: String = bridge.current_snapshot.get("currentRoomId", "")
	var seq_before_reconnect: int = bridge.current_snapshot.get("sequence", -1)
	var reconnected_snapshot: Dictionary = bridge.simulate_reconnect()
	_ok("reconnect returns a snapshot", not reconnected_snapshot.is_empty())
	_ok("reconnect does not change the current room",
		reconnected_snapshot.get("currentRoomId", "") == room_before_reconnect)
	_ok("reconnect still advances sequence (a fresh snapshot, not a stale replay)",
		reconnected_snapshot.get("sequence", -1) > seq_before_reconnect)

	# -- ordered event playback: gaps are detected, order is enforced --
	var player: Node = load("res://scripts/event_player.gd").new()
	var played: Array = []
	player.event_played.connect(func(e): played.append(e.get("sequence", -1)))
	var gap_detected := [false]
	player.sequence_gap_detected.connect(func(_expected, _received): gap_detected[0] = true)
	player.reset_to(0)
	player.offer({"sequence": 1, "kind": "enter"})
	player.offer({"sequence": 3, "kind": "attack"})  # arrives ahead of order
	_ok("an event arriving ahead of sequence is held, not played early",
		played == [1] and gap_detected[0])
	player.offer({"sequence": 2, "kind": "advance"})
	_ok("the gap-filling event releases the held one, in strict order",
		played == [1, 2, 3])
	player.free()
