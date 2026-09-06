extends SceneTree
## Clicking a tile is how you travel. Issue #444.
##
## Dan, 6 September 2026: "remove the route markers. you travel by clicking on
## another tile or by clicking on the words in the interface or by hotkey."
## The chevrons that used to carry the click are gone, so the per-cell click
## target in `world_root.gd` is now the whole of the board half of that
## sentence, and this file is what says it works.
##
## # Where the wrong answer is available
##
## A chooser tested where only the right answer exists tests nothing, so every
## case here is run against a board where a *different* answer was reachable:
##
##   - the current room is a cell like any other, with a click target of its
##     own and neighbours all around it, so "sends nothing" is a decision this
##     code makes and not an absence of anything to send;
##   - the neighbour and the distant room are both loaded cells of the same
##     manifest, so picking the wrong branch produces an intent that exists and
##     names the wrong thing rather than no intent at all - and both branches
##     are asserted by `kind`, so a handler that emitted `walk` for everything
##     would fail on the distant case and vice versa;
##   - the exit the neighbour case must name is read out of the manifest rather
##     than typed here, and the distant room is chosen by *not* being any
##     neighbour, so neither can quietly become the other if the fixture moves;
##   - a right-click and a mouse-up are pushed through the same handler, so
##     "any mouse event travels" is a wrong answer that is available.
##
## # Harness constraints, both engine rather than choice
##
##   - `world_root.gd` names autoloads at compile time, so it is `load()`ed
##     inside `_initialize` rather than `preload`ed. `cell_click_target_test.gd`
##     records the same constraint.
##   - `_on_cell_clicked` touches no scene node, so the viewer stays out of the
##     tree entirely: entering it would run `_ready` against sibling nodes only
##     `WorldRoot.tscn` supplies.
##
## Intents are counted at `IntentSender.intent_created`, which is upstream of
## the bridge, so this measures what the click asked for rather than what a
## mock bridge decided to do about it.

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const MOCK_WORLD_ID := "crossing-mock"
const ROOM_ID := "1-14"

## The real count when nothing aborts. A GDScript runtime error abandons the
## function and still lets the summary print, so without a floor a crash on the
## first line would read as "0 checked, 0 failed" and pass.
const MIN_EXPECTED_CHECKS := 16

var _checked := 0
var _failed := 0
var _intents: Array = []

func _initialize() -> void:
	_run()

func _run() -> void:
	print("-- a click on a tile is how you travel --")
	var loader: Node = root.get_node("WorldManifestLoader")
	var bridge: Node = root.get_node("BridgeClient")
	var sender: Node = root.get_node("IntentSender")
	var world = load("res://scripts/world_root.gd").new()

	_ok("the mock fixture loads", loader.load_from_path(MOCK_FIXTURE_PATH))
	_ok("the fixture is non-trivial (a floor, so an empty load cannot pass what follows)",
		loader.cells.size() >= 10, "%d cells" % loader.cells.size())
	_ok("the mock bridge starts in %s" % ROOM_ID, bridge.start_mock(MOCK_WORLD_ID, ROOM_ID))
	_ok("so the snapshot says that is the current room",
		String(bridge.current_snapshot.get("currentRoomId", "")) == ROOM_ID,
		String(bridge.current_snapshot.get("currentRoomId", "")))

	sender.intent_created.connect(_record)

	# The two destinations, both read off the manifest rather than typed.
	var neighbour_id := ""
	var neighbour_move := ""
	var neighbours: Dictionary = {}
	for exit in loader.true_exits(ROOM_ID):
		var target = exit.get("targetCellId")
		if target is String and loader.has_cell(target):
			neighbours[target] = true
			if neighbour_id.is_empty():
				neighbour_id = target
				neighbour_move = String(exit.get("move", ""))
	var distant_id := ""
	for cell_id in loader.cells.keys():
		var candidate := String(cell_id)
		if candidate != ROOM_ID and not neighbours.has(candidate):
			distant_id = candidate
			break

	_ok("the fixture gives this room a loaded neighbour to click",
		not neighbour_id.is_empty() and not neighbour_move.is_empty(),
		"%s via '%s'" % [neighbour_id, neighbour_move])
	_ok("and a loaded room that is not one of its exits, so the two branches are both reachable",
		not distant_id.is_empty() and distant_id != neighbour_id,
		"%s, against %d neighbour(s)" % [distant_id, neighbours.size()])

	# -- the tile you are standing on --
	_intents.clear()
	world._on_cell_clicked(null, _left_press(), Vector3.ZERO, Vector3.ZERO, 0, ROOM_ID)
	_ok("clicking the room you are already in sends nothing at all",
		_intents.is_empty(), _describe())

	# -- a mouse event that is not a left press --
	_intents.clear()
	world._on_cell_clicked(null, _right_press(), Vector3.ZERO, Vector3.ZERO, 0, distant_id)
	_ok("a right click travels nowhere", _intents.is_empty(), _describe())
	_intents.clear()
	world._on_cell_clicked(null, _left_release(), Vector3.ZERO, Vector3.ZERO, 0, distant_id)
	_ok("nor does releasing the left button", _intents.is_empty(), _describe())

	# -- a distant tile: one travel request, naming that room --
	_intents.clear()
	world._on_cell_clicked(null, _left_press(), Vector3.ZERO, Vector3.ZERO, 0, distant_id)
	_ok("clicking a room that is not a neighbour sends exactly one intent",
		_intents.size() == 1, _describe())
	_ok("and it is a travel request, not a walk",
		_intents.size() == 1 and String(_intents[0].get("kind", "")) == "travel-to-room",
		_describe())
	_ok("naming the room that was clicked",
		_intents.size() == 1 and String(_intents[0].get("roomId", "")) == distant_id,
		_describe())
	_ok("and carrying no exit move, because it has no exit to name",
		_intents.size() == 1 and not _intents[0].has("exitMove"), _describe())
	_ok("the current room did not change: this client does not walk itself there",
		String(bridge.current_snapshot.get("currentRoomId", "")) == ROOM_ID,
		String(bridge.current_snapshot.get("currentRoomId", "")))

	# -- a room the board does not have --
	_intents.clear()
	world._on_cell_clicked(null, _left_press(), Vector3.ZERO, Vector3.ZERO, 0, "not-a-cell-444")
	_ok("a room the manifest does not have is refused rather than sent",
		_intents.is_empty(), _describe())

	# -- a neighbour: one walk, naming that exit. Last, because it moves. --
	_intents.clear()
	world._on_cell_clicked(null, _left_press(), Vector3.ZERO, Vector3.ZERO, 0, neighbour_id)
	_ok("clicking a neighbour sends exactly one intent", _intents.size() == 1, _describe())
	_ok("and it is a walk, not a travel request",
		_intents.size() == 1 and String(_intents[0].get("kind", "")) == "walk", _describe())
	_ok("naming the exact exit the manifest gives for that neighbour",
		_intents.size() == 1 and String(_intents[0].get("exitMove", "")) == neighbour_move,
		"%s, expected '%s'" % [_describe(), neighbour_move])
	_ok("out of the room the player was actually in",
		_intents.size() == 1 and String(_intents[0].get("fromRoomId", "")) == ROOM_ID, _describe())

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

func _record(intent: Dictionary) -> void:
	_intents.append(intent)

func _left_press() -> InputEventMouseButton:
	var event := InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = true
	return event

func _left_release() -> InputEventMouseButton:
	var event := _left_press()
	event.pressed = false
	return event

func _right_press() -> InputEventMouseButton:
	var event := _left_press()
	event.button_index = MOUSE_BUTTON_RIGHT
	return event

func _describe() -> String:
	if _intents.is_empty():
		return "no intent was created"
	var parts: Array = []
	for intent in _intents:
		parts.append(str(intent))
	return "%d intent(s): %s" % [_intents.size(), ", ".join(parts)]

func _ok(label: String, condition: bool, detail: String = "") -> void:
	_checked += 1
	if condition:
		print("OK   %s %s" % [label, detail])
	else:
		_failed += 1
		print("FAIL %s %s" % [label, detail])
