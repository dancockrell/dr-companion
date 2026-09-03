extends Node
## The local Tauri/Rust presentation bridge client, with explicit mock and
## authenticated newline-delimited loopback TCP modes.
##
## Even in mock mode this file enforces the contract the brief is explicit
## about: "Godot must never decide whether an exit exists or is currently
## legal... It simply plays confirmed state and events." A
## `PresentationIntent` is validated here against the loaded manifest before
## it is ever allowed to change `current_snapshot` — the same shape the real
## bridge will use, so swapping mock mode for a live WebSocket later changes
## the transport, not this validation boundary.
##
## `protocol = 1` and every message shape below match
## docs/THREE_D_REBUILD_HANDOFF.md section 4 exactly. A field this file adds
## that is not in that doc is a bug, not an extension.

signal snapshot_updated(snapshot: Dictionary)
signal intent_rejected(intent: Dictionary, reason: String)
signal reconnected(snapshot: Dictionary)
signal live_connection_changed(state: String)
signal live_event_rejected(event: Dictionary, reason: String)

const PROTOCOL: int = 1
const MAX_FRAME_BYTES: int = 8 * 1024 * 1024
const MAX_RECONNECT_ATTEMPTS: int = 5
const RECONNECT_BASE_DELAY_MS: int = 250
const TOKEN_FILE := "presentation-bridge.token"
const PORT_FILE := "presentation-bridge.port"
const EVENT_KINDS := ["enter", "leave", "advance", "retreat", "attack", "hit", "miss", "parry", "evade", "block", "cast", "death", "item-drop"]

## True until a real Tauri/Rust WebSocket bridge is wired in. Nothing outside
## this file should ever need to branch on this — `request_snapshot`/
## `send_intent` behave the same either way from a caller's perspective; this
## flag only decides whether this file talks to a loopback socket or to the
## loaded manifest directly.
var mock_mode: bool = true

var current_snapshot: Dictionary = {}
var _sequence: int = 0
var _current_room_id: String = ""
var _peer := StreamPeerTCP.new()
var _incoming := ""
var _live_started := false
var _authenticated := false
var _auth_sent := false
var _session_token := ""
var _last_peer_status := StreamPeerTCP.STATUS_NONE
var _config_dir := ""
var _retry_at_ms := 0
var _reconnect_attempt := 0
var _recovering := false

func _ready() -> void:
	set_process(false)
	call_deferred("_connect_event_recovery")

func _process(_delta: float) -> void:
	if _retry_at_ms > 0:
		if Time.get_ticks_msec() < _retry_at_ms:
			return
		_retry_at_ms = 0
		if not _begin_live_connection():
			_schedule_reconnect("presentation bridge reconnect failed")
		return
	if not _live_started:
		return
	_peer.poll()
	var status := _peer.get_status()
	if status != _last_peer_status:
		_last_peer_status = status
		if status == StreamPeerTCP.STATUS_CONNECTED:
			live_connection_changed.emit("connected-awaiting-auth")
		elif status == StreamPeerTCP.STATUS_ERROR or status == StreamPeerTCP.STATUS_NONE:
			_schedule_reconnect("presentation bridge disconnected")
			return
	if status != StreamPeerTCP.STATUS_CONNECTED:
		return
	var available := _peer.get_available_bytes()
	if available > 0:
		_incoming += _peer.get_utf8_string(available)
		if _incoming.to_utf8_buffer().size() > MAX_FRAME_BYTES:
			_fail_live("presentation bridge frame exceeded the size limit")
			return
		_drain_live_frames()

## Connects only to the Tauri-owned loopback bridge described by its guarded
## port/token files. The token is shape-checked and is never emitted or logged.
func start_live(config_dir: String = "") -> bool:
	disconnect_live()
	var directory := config_dir
	if directory.is_empty():
		var local_data := OS.get_environment("LOCALAPPDATA")
		if local_data.is_empty():
			live_connection_changed.emit("configuration-unavailable")
			return false
		directory = local_data.path_join("DR Companion Data")
	_config_dir = directory
	mock_mode = false
	return _begin_live_connection()

func _begin_live_connection() -> bool:
	var port_text := _read_small_secret_file(_config_dir.path_join(PORT_FILE), 16)
	var token := _read_small_secret_file(_config_dir.path_join(TOKEN_FILE), 256)
	if not port_text.is_valid_int():
		live_connection_changed.emit("configuration-unavailable")
		return false
	var port := port_text.to_int()
	if port < 1 or port > 65535 or token.length() < 32 or token.length() > 128 or not token.is_valid_hex_number(false):
		live_connection_changed.emit("configuration-invalid")
		return false
	_peer = StreamPeerTCP.new()
	_session_token = token
	var error := _peer.connect_to_host("127.0.0.1", port)
	if error != OK:
		_session_token = ""
		live_connection_changed.emit("connection-failed")
		return false
	_live_started = true
	_last_peer_status = _peer.get_status()
	set_process(true)
	live_connection_changed.emit("connecting")
	return true

func disconnect_live() -> void:
	_close_live_socket()
	_config_dir = ""
	_retry_at_ms = 0
	_reconnect_attempt = 0
	_recovering = false
	set_process(false)

func _close_live_socket() -> void:
	if _peer.get_status() != StreamPeerTCP.STATUS_NONE:
		_peer.disconnect_from_host()
	_live_started = false
	_authenticated = false
	_auth_sent = false
	_session_token = ""
	_incoming = ""
	_last_peer_status = StreamPeerTCP.STATUS_NONE

## Mock-mode entry point: point the bridge at a loaded world/route id and a
## starting room, and build the first snapshot from whatever
## `WorldManifestLoader` currently has loaded. The real bridge's equivalent
## is "connect and receive the first WorldSnapshot from Tauri" — this is the
## same event from the rest of the viewer's point of view, just sourced
## locally instead of over the socket.
func start_mock(world_id: String, starting_room_id: String) -> bool:
	disconnect_live()
	mock_mode = true
	if not WorldManifestLoader.is_loaded():
		push_error("BridgeClient.start_mock called before a manifest was loaded")
		return false
	if not WorldManifestLoader.has_cell(starting_room_id):
		push_error("BridgeClient.start_mock: unknown starting room %s" % starting_room_id)
		return false
	_current_room_id = starting_room_id
	_sequence = 0
	current_snapshot = _build_snapshot(world_id, starting_room_id)
	snapshot_updated.emit(current_snapshot)
	return true

## Simulates a reconnect: request a fresh snapshot for whatever room is
## currently active, without touching game state. This is the "on launch,
## reconnect, dropped event, or renderer crash, request a new snapshot and
## rebuild only presentation state" requirement — the recovery path never
## mutates `_current_room_id` itself, only re-derives a snapshot from it, so
## a reconnect can never be mistaken for a room change.
func simulate_reconnect() -> Dictionary:
	if _current_room_id == "":
		push_error("BridgeClient.simulate_reconnect called before start_mock")
		return {}
	var world_id: String = current_snapshot.get("worldId", "")
	var fresh := _build_snapshot(world_id, _current_room_id)
	current_snapshot = fresh
	reconnected.emit(fresh)
	return fresh

## Accepts a validated `PresentationIntent` (see `IntentSender` — this
## function assumes the intent already passed that validation, it does not
## re-derive legality itself beyond a defensive re-check of the exit table)
## and, in mock mode, applies it directly and returns the updated snapshot.
## The live bridge's equivalent runs the existing command pipeline instead
## of applying anything locally and waits for the game's own confirmation;
## this function's signature and return shape are what stays the same
## across that swap.
func send_intent(intent: Dictionary) -> Dictionary:
	if not mock_mode:
		if not _authenticated:
			intent_rejected.emit(intent, "presentation bridge is not authenticated")
			return current_snapshot
		if not _send_live_json(intent):
			intent_rejected.emit(intent, "presentation bridge write failed")
		return current_snapshot
	if intent.get("kind", "") != "walk":
		# Only `walk` mutates presentation state in this slice; inspect-*
		# and focus-room intents are read-only and are handled by
		# IntentSender directly against the loaded manifest.
		return current_snapshot

	var from_room: String = intent.get("fromRoomId", "")
	var exit_move: String = intent.get("exitMove", "")
	if from_room != _current_room_id:
		intent_rejected.emit(intent, "intent's fromRoomId does not match the current room")
		return current_snapshot
	if not WorldManifestLoader.is_true_exit(from_room, exit_move):
		intent_rejected.emit(intent, "not a true exit of the current room")
		return current_snapshot

	var exit := _find_exit(from_room, exit_move)
	var target_id: String = exit.get("targetCellId", "")
	if target_id == "" or not WorldManifestLoader.has_cell(target_id):
		intent_rejected.emit(intent, "exit's destination is outside the loaded manifest")
		return current_snapshot

	_current_room_id = target_id
	current_snapshot = _build_snapshot(current_snapshot.get("worldId", ""), target_id)
	snapshot_updated.emit(current_snapshot)
	return current_snapshot

func _read_small_secret_file(path: String, max_bytes: int) -> String:
	if not FileAccess.file_exists(path):
		return ""
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null or file.get_length() > max_bytes:
		if file != null:
			file.close()
		return ""
	var value := file.get_as_text().strip_edges()
	file.close()
	return value

func _drain_live_frames() -> void:
	var newline := _incoming.find("\n")
	while newline >= 0:
		var line := _incoming.substr(0, newline).strip_edges()
		_incoming = _incoming.substr(newline + 1)
		if not line.is_empty():
			var parsed = JSON.parse_string(line)
			if typeof(parsed) != TYPE_DICTIONARY:
				_fail_live("presentation bridge sent invalid JSON")
				return
			_accept_live_message(parsed)
			if not _live_started:
				return
		newline = _incoming.find("\n")

func _accept_live_message(message: Dictionary) -> void:
	match str(message.get("type", "")):
		"hello":
			if int(message.get("protocol", -1)) != PROTOCOL:
				_fail_live("presentation bridge protocol mismatch")
			elif not _auth_sent:
				_auth_sent = true
				if not _send_live_json({"type": "auth", "token": _session_token}):
					_fail_live("presentation bridge authentication write failed")
		"auth_ok":
			if not _auth_sent:
				_fail_live("presentation bridge authenticated before challenge")
			else:
				_authenticated = true
				_session_token = ""
				live_connection_changed.emit("authenticated")
		"auth_failed":
			_fail_live("presentation bridge authentication failed")
		"snapshot":
			if not _authenticated or not WorldManifestLoader.load_from_snapshot(message):
				_fail_live("presentation bridge supplied an invalid snapshot")
				return
			current_snapshot = message.duplicate(true)
			_sequence = int(message.get("sequence", 0))
			_current_room_id = str(message.get("currentRoomId", ""))
			EventPlayer.reset_to(_sequence)
			_reconnect_attempt = 0
			if _recovering:
				_recovering = false
				reconnected.emit(current_snapshot)
			else:
				snapshot_updated.emit(current_snapshot)
		"event":
			if not _authenticated:
				return
			var event_problem := _validate_live_event(message)
			if event_problem.is_empty():
				EventPlayer.offer(message)
			else:
				live_event_rejected.emit(message, event_problem)
		"intent_rejected":
			intent_rejected.emit({}, str(message.get("reason", "intent rejected")))
		"error":
			live_connection_changed.emit("server-error")

func _send_live_json(message: Dictionary) -> bool:
	if _peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return false
	var payload := JSON.stringify(message) + "\n"
	return _peer.put_data(payload.to_utf8_buffer()) == OK

func _validate_live_event(event: Dictionary) -> String:
	if int(event.get("protocol", -1)) != PROTOCOL:
		return "unsupported event protocol"
	if int(event.get("sequence", -1)) < 1:
		return "event has no valid sequence"
	var room_id := str(event.get("roomId", ""))
	if not WorldManifestLoader.has_cell(room_id):
		return "event names an unknown room"
	if not EVENT_KINDS.has(str(event.get("kind", ""))):
		return "event has an unsupported kind"
	for field in ["sourceEntityId", "targetEntityId"]:
		var entity_id := str(event.get(field, ""))
		if not entity_id.is_empty() and not _snapshot_has_entity(entity_id):
			return "event names an unknown entity"
	return ""

func _snapshot_has_entity(entity_id: String) -> bool:
	for entity in current_snapshot.get("entities", []):
		if entity is Dictionary and str(entity.get("id", "")) == entity_id:
			return true
	return false

func _fail_live(reason: String) -> void:
	disconnect_live()
	live_connection_changed.emit("failed: %s" % reason)

func request_live_recovery(_expected: int = -1, _received: int = -1) -> void:
	if mock_mode or _config_dir.is_empty():
		return
	_schedule_reconnect("ordered event gap requires a fresh snapshot", true)

func _schedule_reconnect(reason: String, immediate: bool = false) -> void:
	if mock_mode or _config_dir.is_empty():
		return
	if _retry_at_ms > 0:
		if immediate:
			_retry_at_ms = Time.get_ticks_msec()
		return
	_close_live_socket()
	_recovering = not current_snapshot.is_empty()
	_reconnect_attempt += 1
	if _reconnect_attempt > MAX_RECONNECT_ATTEMPTS:
		live_connection_changed.emit("failed: %s" % reason)
		set_process(false)
		return
	var delay := 0 if immediate else mini(RECONNECT_BASE_DELAY_MS * (1 << (_reconnect_attempt - 1)), 4000)
	_retry_at_ms = Time.get_ticks_msec() + delay
	set_process(true)
	live_connection_changed.emit("reconnecting-%d" % _reconnect_attempt)

func _connect_event_recovery() -> void:
	var player := get_node_or_null("/root/EventPlayer")
	if player != null and not player.sequence_gap_detected.is_connected(request_live_recovery):
		player.sequence_gap_detected.connect(request_live_recovery)

func _find_exit(cell_id: String, exit_move: String) -> Dictionary:
	for exit in WorldManifestLoader.true_exits(cell_id):
		if exit.get("move", "") == exit_move:
			return exit
	return {}

func _build_snapshot(world_id: String, room_id: String) -> Dictionary:
	_sequence += 1
	var active_room: Dictionary = WorldManifestLoader.get_cell(room_id)
	return {
		"protocol": PROTOCOL,
		"sequence": _sequence,
		"worldId": world_id,
		"currentRoomId": room_id,
		"cells": WorldManifestLoader.cells.values(),
		"activeRoom": active_room,
		# No live entity/ground-item source exists yet in this slice — an
		# empty array is the honest state, never an invented occupant.
		"entities": [],
		"groundItems": [],
	}
