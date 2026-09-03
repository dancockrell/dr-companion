extends SceneTree
## Decoder/configuration gate for the authenticated Tauri presentation bridge.

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var loader: Node = root.get_node("WorldManifestLoader")
	var bridge: Node = root.get_node("BridgeClient")
	bridge.mock_mode = false
	bridge._live_started = true
	bridge._authenticated = true
	var snapshots: Array = []
	bridge.snapshot_updated.connect(func(snapshot): snapshots.append(snapshot))
	var snapshot := {
		"type": "snapshot", "protocol": 1, "sequence": 9,
		"worldId": "crossing-live", "currentRoomId": "1-14",
		"cells": [{
			"id": "1-14", "title": "The Crossing, Town Green North",
			"position": {"x": 0.0, "y": 0.0, "z": 0.0},
			"exits": [{"move": "north", "direction": "north", "targetRoomId": 13, "targetCellId": null}],
		}],
		"activeRoom": {"title": "The Crossing, Town Green North"},
		"entities": [{"id": "person-1", "roomId": "1-14", "name": "Veyga"}], "groundItems": [],
	}
	bridge._accept_live_message(snapshot)
	_ok("an authenticated protocol-1 snapshot is admitted", snapshots.size() == 1)
	_ok("the live room becomes the current authoritative room", bridge.current_snapshot.get("currentRoomId", "") == "1-14")
	_ok("live topology replaces rather than supplements stale manifest cells", loader.cells.keys() == ["1-14"])
	_ok("the exact live exit remains the only legal exit", loader.is_true_exit("1-14", "north") and not loader.is_true_exit("1-14", "south"))

	var before: Dictionary = bridge.current_snapshot.duplicate(true)
	bridge._authenticated = false
	bridge._accept_live_message(snapshot.merged({"currentRoomId": "1-99"}, true))
	_ok("a snapshot received before authentication cannot replace state", bridge.current_snapshot == before)

	var refused: Array = []
	bridge.intent_rejected.connect(func(_intent, reason): refused.append(reason))
	bridge.send_intent({"kind": "walk", "fromRoomId": "1-14", "exitMove": "north"})
	_ok("live intents are refused until the bridge is authenticated", refused.size() == 1)

	bridge._authenticated = true
	var event_rejections: Array = []
	var played_events: Array = []
	bridge.live_event_rejected.connect(func(_event, reason): event_rejections.append(reason))
	var player: Node = root.get_node("EventPlayer")
	player.event_played.connect(func(event): played_events.append(event))
	bridge._accept_live_message({"type": "event", "protocol": 1, "sequence": 10, "roomId": "1-99", "kind": "attack", "sourceEntityId": "person-1", "authoritativeText": "bad room"})
	bridge._accept_live_message({"type": "event", "protocol": 1, "sequence": 10, "roomId": "1-14", "kind": "attack", "sourceEntityId": "missing", "authoritativeText": "bad entity"})
	bridge._accept_live_message({"type": "event", "protocol": 1, "sequence": 10, "roomId": "1-14", "kind": "attack", "sourceEntityId": "person-1", "authoritativeText": "confirmed attack"})
	_ok("events naming an unknown room or entity are rejected", event_rejections.size() == 2)
	_ok("only the fully snapshot-grounded event reaches ordered playback", played_events.size() == 1 and played_events[0].get("authoritativeText", "") == "confirmed attack")
	bridge.disconnect_live()
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
