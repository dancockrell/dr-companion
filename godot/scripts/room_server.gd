extends SceneTree
## The headless control API: one long-lived Godot, driven over TCP with
## newline-delimited JSON.
##
##   DRC_ROOM_PORT=11731 Godot_v4.3-stable_win64_console.exe --headless \
##       --path godot --script res://scripts/room_server.gd
##
## The port arrives in the environment rather than on the command line, and
## that is an invariant rather than a taste: `src-tauri/src/viewer.rs` requires
## that **exactly one** script under `godot/scripts` reads Godot's user
## arguments, because the script that reads them is the script that decides
## whether the viewer shows the player's world or a mock of it, and two of them
## deciding is the bug. `room_scene.gd` owns that read; this file owns none.
##
## Note for anyone editing the paragraph above: that Rust test locates readers
## by a plain substring search over the source, so it counts a *comment* naming
## the call exactly as it counts a call. Spelling the function's name out here
## is what made this file read as a second reader, and the failure said "two
## scripts decide the launch mode" while this one decided nothing.
##
## then, per request, one JSON object on one line, and one JSON object back on
## one line.
##
## # Why TCP and JSON lines
##
## The client is a Python bot and the engine is headless, so the two real
## candidates were "a request per process" and "one process, many requests".
##
## A process per request is out on this machine before any technical argument:
## a Godot-driven crash took the whole box down twice, so the rule here is one
## instance, started once, reused, and killed by the exact pid that started it.
## A launch-per-case loop is the shape that rule forbids. It is also ~1.5s of
## engine start per room against 16,074 composable rooms.
##
## Given one long-lived process, the transport has to be something Godot can
## serve without a window and Python can speak without a dependency. `TCPServer`
## is core Godot and works under `--headless`; `socket` plus `json` is core
## Python. Newline-delimited JSON needs no framing library on either side and
## stays readable in a packet dump, which matters when the thing being debugged
## is the report itself.
##
## Rejected, and why, so nobody re-litigates it: stdin/stdout pipes (Godot's
## stdin has no non-blocking read, and `print()` shares the stream with every
## engine warning, so the protocol would be mixed in with the noise); an HTTP
## server (Godot has no core one, and this needs no routing, caching or
## content negotiation); a file drop-box (polling, and no way to tell "still
## working" from "died").
##
## # What comes back is the tree, not the request
##
## `--headless` has no renderer. That is fine and it is the point: the question
## a bot asks is *what got placed where*, and `RoomComposer.report()` answers it
## by walking the composed nodes. See `render` below for the honest state of
## the picture-taking mode that does not exist yet.
##
## # Protocol
##
##   -> {"cmd":"ping"}
##   <- {"ok":true,"pong":true,"godot":"4.3-stable (official)",
##       "project":"C:/.../godot/","composer_radius":4,"served":1}
##
##   -> {"cmd":"compose","scene":{...forge Scene.to_dict()...}}
##   <- {"ok":true,"report":{...},"us":8650,"project":"C:/.../godot/"}
##
##   -> {"cmd":"render","scene":{...}}
##   <- {"ok":false,"rendered":false,"why":"...","what_to_do":"..."}
##
##   -> {"cmd":"shutdown"}
##   <- {"ok":true,"bye":true,"served":4}
##
## Every reply carries `ok`. A refusal carries a reason: `error` when the
## request was wrong, `why` when the request was fine and this instance cannot
## serve it - which is `render`'s permanent state under `--headless` and is
## nobody's mistake, so it is not called an error.
##
## `project` is on both `ping` and `compose` so a caller can prove which
## checkout composed its room. `tools/room-player-break-check.py` runs the
## suite against a deliberately damaged copy of `godot/`, and without that
## field a sabotage the server never loaded would look exactly like code that
## survived it.

const RoomComposer := preload("res://scripts/room_composer.gd")

const DEFAULT_PORT := 11731
const READY_LINE := "room-server listening on port "

## A forgotten background fixture holding a port is its own hazard on this
## machine, so the server dies on its own if nobody talks to it. Generous
## enough that a slow test run never trips it.
const IDLE_TIMEOUT_MS := 180_000

var _server := TCPServer.new()
var _port := DEFAULT_PORT
var _peers: Array[StreamPeerTCP] = []
var _buffers: Array[PackedByteArray] = []
var _served := 0


func _initialize() -> void:
	_port = _resolve_port()

	# 127.0.0.1, never 0.0.0.0. This composes rooms; it has no business being
	# reachable from another machine.
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		printerr("FAILED: could not listen on 127.0.0.1:%d (error %d)" % [_port, err])
		printerr("  Nothing is serving. A client that connects anyway is talking to something else.")
		quit(1)
		return

	print("%s%d" % [READY_LINE, _port])
	print("  engine %s, project %s" % [
		Engine.get_version_info()["string"],
		ProjectSettings.globalize_path("res://"),
	])

	var last_activity := Time.get_ticks_msec()
	var running := true

	while running:
		if _server.is_connection_available():
			var peer := _server.take_connection()
			peer.set_no_delay(true)
			_peers.append(peer)
			_buffers.append(PackedByteArray())
			last_activity = Time.get_ticks_msec()

		var index := _peers.size() - 1
		while index >= 0:
			var peer: StreamPeerTCP = _peers[index]
			peer.poll()
			if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
				_peers.remove_at(index)
				_buffers.remove_at(index)
				index -= 1
				continue
			var available := peer.get_available_bytes()
			if available > 0:
				last_activity = Time.get_ticks_msec()
				var chunk: Array = peer.get_data(available)
				if int(chunk[0]) == OK:
					_buffers[index].append_array(chunk[1] as PackedByteArray)
				for line in _take_lines(index):
					var reply := _handle(line)
					if reply.get("__quit", false):
						reply.erase("__quit")
						_send(peer, reply)
						running = false
					else:
						_send(peer, reply)
			index -= 1

		if Time.get_ticks_msec() - last_activity > IDLE_TIMEOUT_MS:
			print("idle for %dms with no request; shutting down rather than holding port %d"
				% [IDLE_TIMEOUT_MS, _port])
			running = false

		# 1ms rather than a busy spin. The composer is the expensive part; this
		# loop costs nothing measurable beside it.
		OS.delay_msec(1)

	for peer in _peers:
		peer.disconnect_from_host()
	_server.stop()
	print("room-server served %d request(s) and stopped" % _served)
	quit(0)


## `DRC_ROOM_PORT`, else the default. Not a command-line flag; see the note in
## the class comment about who owns the user arguments.
##
## Port 11024 is a live DragonRealms session owned by another process on this
## machine and is refused outright rather than merely discouraged.
func _resolve_port() -> int:
	var chosen := DEFAULT_PORT
	if OS.has_environment("DRC_ROOM_PORT"):
		chosen = int(OS.get_environment("DRC_ROOM_PORT"))
	if chosen == 11024:
		printerr("refusing port 11024: that is the live game bridge, owned elsewhere")
		return DEFAULT_PORT
	if chosen <= 0 or chosen > 65535:
		printerr("port %d is not a port; using %d" % [chosen, DEFAULT_PORT])
		return DEFAULT_PORT
	return chosen


## Complete lines out of the accumulated bytes, leaving any partial tail.
func _take_lines(index: int) -> Array:
	var lines := []
	var buffer: PackedByteArray = _buffers[index]
	while true:
		var at := buffer.find(10)  # '\n'
		if at < 0:
			break
		lines.append(buffer.slice(0, at).get_string_from_utf8())
		buffer = buffer.slice(at + 1)
	_buffers[index] = buffer
	return lines


func _send(peer: StreamPeerTCP, payload: Dictionary) -> void:
	var line := JSON.stringify(payload) + "\n"
	peer.put_data(line.to_utf8_buffer())
	peer.poll()


func _handle(line: String) -> Dictionary:
	var trimmed := line.strip_edges()
	if trimmed == "":
		return {"ok": false, "error": "empty request line"}

	var parsed = JSON.parse_string(trimmed)
	if not (parsed is Dictionary):
		return {"ok": false, "error": "request is not a JSON object"}

	_served += 1
	var cmd := str(parsed.get("cmd", ""))
	match cmd:
		"ping":
			return {
				"ok": true,
				"pong": true,
				"godot": Engine.get_version_info()["string"],
				"project": ProjectSettings.globalize_path("res://"),
				"composer_radius": RoomComposer.RADIUS,
				"served": _served,
			}
		"compose":
			return _compose(parsed)
		"render":
			# The honest third state. Godot's `--headless` has no rendering
			# device at all, so there is no picture to take and no amount of
			# retrying produces one. A later mode gets a real window (or
			# `--display-driver` with an offscreen device), calls the same
			# `RoomComposer.compose`, and adds a viewport capture; the report
			# path above does not change when it lands, which is why it is not
			# blocking anything now.
			return {
				"ok": false,
				"rendered": false,
				"why": "this instance is headless: RenderingServer has no device, so there are no pixels to capture",
				"what_to_do": "structure is in `compose`; a PNG needs an instance started without --headless",
			}
		"shutdown":
			return {"ok": true, "bye": true, "served": _served, "__quit": true}
		_:
			return {"ok": false, "error": "unknown cmd '%s'; known: ping, compose, render, shutdown" % cmd}


func _compose(request: Dictionary) -> Dictionary:
	var scene = request.get("scene")
	if not (scene is Dictionary):
		return {"ok": false, "error": "compose needs a `scene` object (forge Scene.to_dict())"}

	var started := Time.get_ticks_usec()
	var root: Node2D = RoomComposer.compose(scene)
	var report: Dictionary = RoomComposer.report(root)
	var elapsed := Time.get_ticks_usec() - started
	root.free()

	return {
		"ok": true,
		"report": report,
		"us": elapsed,
		"project": ProjectSettings.globalize_path("res://"),
	}
