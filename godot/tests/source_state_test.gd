extends SceneTree
var checks := 0
var failures := 0
func _initialize() -> void:
	var bridge = root.get_node("BridgeClient")
	var loader = root.get_node("WorldManifestLoader")
	bridge.mock_mode = false
	bridge._authenticated = true
	bridge.current_snapshot = {"source": {"kind": "live", "connected": true}}
	_ok("authenticated connected live source permits intents", bridge.can_send_live_intents())
	bridge.current_snapshot.source.connected = false
	_ok("source disconnect refuses intents despite authenticated transport", not bridge.can_send_live_intents())
	bridge.current_snapshot.source = {"kind": "demo", "connected": true}
	_ok("demo source cannot drive real game intents", not bridge.can_send_live_intents())
	bridge.current_snapshot = {}
	_ok("old source-less snapshots cannot silently claim live authority", not bridge.can_send_live_intents())
	var empty := {"protocol": 1, "sequence": 1, "worldId": "", "currentRoomId": "", "cells": [], "source": {"kind": "live", "connected": false}}
	_ok("explicit unavailable snapshot clears previous world", loader.load_from_snapshot(empty) and loader.cells.is_empty())
	empty.source.connected = true
	_ok("empty world cannot claim live readiness", not loader.load_from_snapshot(empty))
	empty.source = null
	_ok("unqualified empty snapshot still fails validation", not loader.load_from_snapshot(empty))
	bridge._authenticated = false
	bridge.current_snapshot = {"source": {"kind": "live", "connected": true}}
	_ok("ready source never bypasses transport authentication", not bridge.can_send_live_intents())
	print("source state: %d checked, %d failed" % [checks, failures])
	quit(1 if failures else 0)
func _ok(label: String, value: bool) -> void:
	checks += 1
	if not value: failures += 1
	print("%s %s" % ["OK" if value else "FAIL", label])
