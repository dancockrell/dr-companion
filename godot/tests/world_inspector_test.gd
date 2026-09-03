extends SceneTree
## Current-room inspector gate: only confirmed entries in the confirmed room
## are exposed as accessible inspect requests.

const WorldInspector := preload("res://scripts/world_inspector.gd")

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var inspector: CanvasLayer = WorldInspector.new()
	var entity_requests: Array = []
	var item_requests: Array = []
	inspector.inspect_entity_requested.connect(func(id): entity_requests.append(id))
	inspector.inspect_ground_item_requested.connect(func(id): item_requests.append(id))
	inspector.render_snapshot({
		"currentRoomId": "1-14",
		"activeRoom": {"title": "The Crossing, Town Green North"},
		"entities": [
			{"id": "person-1", "roomId": "1-14", "name": "Veyga", "tactical": {"range": "missile", "relation": "across the room", "target": "a goblin", "balance": "solid", "offBalance": false, "disengaged": false, "dead": false, "statuses": [], "conditions": [], "enrichedAgeSeconds": 14}},
			{"id": "elsewhere", "roomId": "1-15", "name": "Not here"},
			{"id": "", "roomId": "1-14", "name": "Missing id"},
		],
		"groundItems": [
			{"id": "item-1", "roomId": "1-14", "name": "a rusty dagger"},
			{"id": "elsewhere-item", "roomId": "1-15", "name": "not here"},
		],
		"player": {"cannotAct": true, "roundtime": 5, "health": 0.62, "situation": ["in_combat", "webbed"]},
	})
	_ok("only a confirmed current-room entity is listed", inspector.visible_entity_ids() == ["person-1"])
	_ok("only a confirmed current-room item is listed", inspector.visible_item_ids() == ["item-1"])
	_ok("a visible entity can request its exact stable id", inspector.request_visible_entity("person-1"))
	_ok("a visible item can request its exact stable id", inspector.request_visible_item("item-1"))
	_ok("the emitted inspect ids remain exact", entity_requests == ["person-1"] and item_requests == ["item-1"])
	_ok("an entity outside the room cannot be inspected", not inspector.request_visible_entity("elsewhere"))
	_ok("an arbitrary item cannot be inspected", not inspector.request_visible_item("imaginary"))
	_ok("current-room entity exposes the shared tactical summary", inspector.entity_summary("person-1").contains("missile"))
	_ok("entity detail retains exact assessed relation and target", inspector.entity_tooltip("person-1").contains("Position: across the room") and inspector.entity_tooltip("person-1").contains("Engaging: a goblin"))
	var player: Dictionary = inspector.player_view()
	_ok("player urgency, health, roundtime, and flags are retained", player.state == "CANNOT ACT" and player.healthPercent == 62.0 and player.roundtime == 5.0 and player.flags == ["in_combat", "webbed"])
	inspector.render_snapshot({"currentRoomId": "1-15", "activeRoom": {}, "entities": [], "groundItems": []})
	_ok("a new snapshot clears stale accessible tokens", inspector.visible_entity_ids().is_empty() and inspector.visible_item_ids().is_empty())
	_ok("a snapshot without player state clears the old combat state", not inspector.player_view().known)
	inspector.free()
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
