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
	bridge.snapshot_updated.connect(func(snapshot): snapshots.append(snapshot))
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

	bridge.disconnect_live()
	client.disconnect_from_host()
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
