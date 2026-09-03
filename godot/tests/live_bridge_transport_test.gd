extends SceneTree
## Real-socket gate for Godot's side of the authenticated presentation bridge.

var _checked := 0
var _failed := 0

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var server := TCPServer.new()
	var port := 0
	for candidate in range(39731, 39761):
		if server.listen(candidate, "127.0.0.1") == OK:
			port = candidate
			break
	_ok("a loopback test listener starts", port > 0)
	if port == 0:
		_finish()
		return

	var config_dir := OS.get_temp_dir().path_join("drc-godot-live-bridge-%d" % Time.get_ticks_msec())
	DirAccess.make_dir_recursive_absolute(config_dir)
	var token := "a".repeat(64)
	_write_text(config_dir.path_join("presentation-bridge.port"), str(port))
	_write_text(config_dir.path_join("presentation-bridge.token"), token)

	var bridge: Node = root.get_node("BridgeClient")
	var snapshots: Array = []
	var recovered_snapshots: Array = []
	var connection_states: Array = []
	bridge.snapshot_updated.connect(func(snapshot): snapshots.append(snapshot))
	bridge.reconnected.connect(func(snapshot): recovered_snapshots.append(snapshot))
	bridge.live_connection_changed.connect(func(state): connection_states.append(state))
	_ok("Godot accepts valid guarded bridge configuration", bridge.start_live(config_dir))

	var client: StreamPeerTCP = null
	var deadline := Time.get_ticks_msec() + 3000
	while client == null and Time.get_ticks_msec() < deadline:
		if server.is_connection_available():
			client = server.take_connection()
		else:
			await process_frame
	_ok("Godot connects to the configured loopback port", client != null)
	if client == null:
		bridge.disconnect_live()
		_cleanup(config_dir)
		server.stop()
		_finish()
		return

	_send(client, {"type": "hello", "protocol": 1})
	var auth := await _read_frame(client, 3000)
	_ok("Godot answers hello with auth as its first frame", auth.get("type", "") == "auth")
	_ok("Godot presents the exact launch token", auth.get("token", "") == token)
	_send(client, {"type": "auth_ok"})
	_send(client, {
		"type": "snapshot", "protocol": 1, "sequence": 4,
		"worldId": "transport-test", "currentRoomId": "1-14",
		"cells": [{"id": "1-14", "title": "Town Green North", "position": {"x": 0, "y": 0, "z": 0},
			"exits": [{"move": "north", "direction": "north", "targetRoomId": 13, "targetCellId": null}]}],
		"activeRoom": {"title": "Town Green North"}, "entities": [], "groundItems": [],
	})
	deadline = Time.get_ticks_msec() + 3000
	while snapshots.is_empty() and Time.get_ticks_msec() < deadline:
		await process_frame
	_ok("an authenticated socket snapshot reaches the viewer", snapshots.size() == 1)

	bridge.send_intent({"kind": "walk", "fromRoomId": "1-14", "exitMove": "north"})
	var intent := await _read_frame(client, 3000)
	_ok("a live intent uses the documented wire shape", intent == {"kind": "walk", "fromRoomId": "1-14", "exitMove": "north"})

	client.disconnect_from_host()
	deadline = Time.get_ticks_msec() + 3000
	while not _has_state_prefix(connection_states, "reconnecting-") and Time.get_ticks_msec() < deadline:
		await process_frame
	_ok("a dropped socket enters bounded reconnect recovery", _has_state_prefix(connection_states, "reconnecting-"))
	_ok("the last confirmed room remains available during recovery", bridge.current_snapshot.get("currentRoomId", "") == "1-14")

	var reconnected_client: StreamPeerTCP = null
	deadline = Time.get_ticks_msec() + 5000
	while reconnected_client == null and Time.get_ticks_msec() < deadline:
		if server.is_connection_available():
			reconnected_client = server.take_connection()
		else:
			await process_frame
	_ok("Godot reconnects to the same guarded loopback endpoint", reconnected_client != null)
	if reconnected_client != null:
		_send(reconnected_client, {"type": "hello", "protocol": 1})
		var reconnect_auth := await _read_frame(reconnected_client, 3000)
		_ok("a recovered socket performs a fresh authentication", reconnect_auth == {"type": "auth", "token": token})
		_send(reconnected_client, {"type": "auth_ok"})
		_send(reconnected_client, {
			"type": "snapshot", "protocol": 1, "sequence": 5,
			"worldId": "transport-test", "currentRoomId": "1-14",
			"cells": [{"id": "1-14", "title": "Town Green North", "position": {"x": 0, "y": 0, "z": 0},
				"exits": [{"move": "north", "direction": "north", "targetRoomId": 13, "targetCellId": null}]}],
			"activeRoom": {"title": "Town Green North"}, "entities": [], "groundItems": [],
		})
		deadline = Time.get_ticks_msec() + 3000
		while recovered_snapshots.is_empty() and Time.get_ticks_msec() < deadline:
			await process_frame
		_ok("a valid replacement snapshot completes recovery", recovered_snapshots.size() == 1)
		_ok("recovery admits the fresh authoritative sequence", bridge.current_snapshot.get("sequence", -1) == 5)
		var reconnect_count := _count_state_prefix(connection_states, "reconnecting-")
		root.get_node("EventPlayer").offer({"sequence": 7, "kind": "hit"})
		deadline = Time.get_ticks_msec() + 1000
		while _count_state_prefix(connection_states, "reconnecting-") == reconnect_count and Time.get_ticks_msec() < deadline:
			await process_frame
		_ok("an ordered-event gap immediately requests snapshot recovery", _count_state_prefix(connection_states, "reconnecting-") > reconnect_count)
	else:
		_ok("a recovered socket performs a fresh authentication", false)
		_ok("a valid replacement snapshot completes recovery", false)
		_ok("recovery admits the fresh authoritative sequence", false)
		_ok("an ordered-event gap immediately requests snapshot recovery", false)

	bridge.disconnect_live()
	server.stop()
	_cleanup(config_dir)
	_finish()

func _read_frame(peer: StreamPeerTCP, timeout_ms: int) -> Dictionary:
	var incoming := ""
	var deadline := Time.get_ticks_msec() + timeout_ms
	while Time.get_ticks_msec() < deadline:
		peer.poll()
		var available := peer.get_available_bytes()
		if available > 0:
			incoming += peer.get_utf8_string(available)
			var newline := incoming.find("\n")
			if newline >= 0:
				var parsed = JSON.parse_string(incoming.substr(0, newline))
				return parsed if typeof(parsed) == TYPE_DICTIONARY else {}
		await process_frame
	return {}

func _send(peer: StreamPeerTCP, message: Dictionary) -> void:
	peer.put_data((JSON.stringify(message) + "\n").to_utf8_buffer())

func _has_state_prefix(states: Array, prefix: String) -> bool:
	return _count_state_prefix(states, prefix) > 0

func _count_state_prefix(states: Array, prefix: String) -> int:
	var count := 0
	for state in states:
		if str(state).begins_with(prefix):
			count += 1
	return count

func _write_text(path: String, value: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file != null:
		file.store_string(value)
		file.close()

func _cleanup(directory: String) -> void:
	DirAccess.remove_absolute(directory.path_join("presentation-bridge.port"))
	DirAccess.remove_absolute(directory.path_join("presentation-bridge.token"))
	DirAccess.remove_absolute(directory)

func _finish() -> void:
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
