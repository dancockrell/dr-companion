extends SceneTree
## Snapshot-token contract gate, runnable headlessly:
##
##   Godot_v4.7.2-stable_win64_console.exe --headless --path godot \
##     --script res://tests/entity_projection_test.gd
##
## This test deliberately supplies a small fixture instead of pretending the
## mock bridge has a live room population.  It proves the renderer's only
## spatial rule: confirmed entities/items appear under their reported room's
## tether; unknown rooms, missing identifiers, and stale data do not render.

const LAYER_SCRIPT := preload("res://scripts/entity_projection_layer.gd")

var _checked := 0
var _failed := 0

func _initialize() -> void:
	print("-- DR Companion 3D entity projection gate --")
	var world := Node3D.new()
	root.add_child(world)
	var room_one := Node3D.new()
	room_one.name = "Cell_crossing-1"
	world.add_child(room_one)
	var room_two := Node3D.new()
	room_two.name = "Cell_crossing-2"
	world.add_child(room_two)
	var layer: Node3D = LAYER_SCRIPT.new()
	world.add_child(layer)

	var rooms := {"crossing-1": room_one, "crossing-2": room_two}
	var fixture := {
		"currentRoomId": "crossing-1",
		"player": {"cannotAct": true, "roundtime": 4, "health": 0.45, "situation": ["stunned"]},
		"entities": [
			{"id": "creature-1", "roomId": "crossing-1", "name": "a troll", "deck": "hostile", "tactical": {"range": "melee", "statuses": ["stunned"], "conditions": [], "enrichedAgeSeconds": 8}},
			{"id": "person-1", "roomId": "crossing-2", "name": "Kethrai", "deck": "people"},
			{"id": "unknown-room", "roomId": "crossing-404", "name": "nothing", "deck": "hostile"},
			{"id": "", "roomId": "crossing-1", "name": "missing id", "deck": "people"},
		],
		"groundItems": [
			{"id": "item-1", "roomId": "crossing-1", "name": "a rusty dagger"},
			{"id": "unknown-item", "roomId": "crossing-404", "name": "not in this world"},
		]
	}
	layer.project_snapshot(fixture, rooms)
	_ok("confirmed player plus snapshot entries with a known room and stable id render", layer.visible_ids().size() == 4)
	_ok("the player's own token stays at the confirmed current room node", layer.tether_room_for("player:self") == "crossing-1")
	_ok("the player token carries the bridge-decided action lock", layer.token_for("player:self").get_meta("combatState") == "CANNOT ACT")
	_ok("a hostile token stays tethered to its reported room", layer.tether_room_for("creature-1") == "crossing-1")
	_ok("a person token stays tethered to its reported room", layer.tether_room_for("person-1") == "crossing-2")
	_ok("a ground-item token stays tethered to its reported room", layer.tether_room_for("item-1") == "crossing-1")
	_ok("an unknown room never creates an entity token", layer.tether_room_for("unknown-room") == "")
	_ok("each confirmed entity token has an inspect hit target", layer.token_for("creature-1").has_node("InspectTarget"))
	_ok("entity token carries the shared tactical freshness policy", layer.token_for("creature-1").get_meta("assessmentState") == "fresh")
	_ok("entity token visibly carries one assessment-age ring", layer.token_for("creature-1").has_node("AssessmentRing"))
	_ok("entity token carries the exact projected tactical summary", String(layer.token_for("creature-1").get_meta("tacticalSummary")).contains("melee"))
	_ok("unassessed people stay explicitly unassessed", layer.token_for("person-1").get_meta("assessmentState") == "unassessed")
	_ok("each confirmed ground-item token has an inspect hit target", layer.token_for("item-1").has_node("InspectTarget"))
	var first_slot: Vector3 = layer.local_slot_for("creature-1")
	layer.project_snapshot(fixture, rooms)
	_ok("room-local slots are deterministic across equivalent snapshots", first_slot.is_equal_approx(layer.local_slot_for("creature-1")))
	layer.project_snapshot({"entities": [], "groundItems": []}, rooms)
	_ok("a later empty confirmed snapshot clears stale tokens", layer.visible_ids().is_empty())

	world.free()
	print("%d checked, %d failed" % [_checked, _failed])
	if _failed > 0:
		quit(1)
	else:
		print("all passed")
		quit(0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
