extends Node
## The local Tauri/Rust presentation bridge client — in mock mode until the
## real loopback-WebSocket bridge exists.
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

const PROTOCOL: int = 1

## True until a real Tauri/Rust WebSocket bridge is wired in. Nothing outside
## this file should ever need to branch on this — `request_snapshot`/
## `send_intent` behave the same either way from a caller's perspective; this
## flag only decides whether this file talks to a loopback socket or to the
## loaded manifest directly.
var mock_mode: bool = true

var current_snapshot: Dictionary = {}
var _sequence: int = 0
var _current_room_id: String = ""

func _ready() -> void:
	pass

## Mock-mode entry point: point the bridge at a loaded world/route id and a
## starting room, and build the first snapshot from whatever
## `WorldManifestLoader` currently has loaded. The real bridge's equivalent
## is "connect and receive the first WorldSnapshot from Tauri" — this is the
## same event from the rest of the viewer's point of view, just sourced
## locally instead of over the socket.
func start_mock(world_id: String, starting_room_id: String) -> bool:
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
