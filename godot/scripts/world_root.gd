extends Node3D
## The single world viewer's root scene script.
##
## Ties the autoloads together for one running viewer: loads a manifest,
## starts the (currently mock-only) bridge, spawns cell content through
## `ContentRegistry`, and drives `CameraDirector` off whatever room the
## bridge says is current. This file owns wiring, not policy — it never
## itself decides what a cell looks like (`ContentRegistry`'s job) or
## whether a click is a legal walk (`IntentSender`/`BridgeClient`'s job).

const MOCK_FIXTURE_PATH := "res://mock/crossing_mock_world.json"
const MOCK_WORLD_ID := "crossing-mock"
const MOCK_STARTING_ROOM := "1-14"  # Town Green North
const CellVisibilityPolicy := preload("res://scripts/cell_visibility_policy.gd")
## The script rather than the `ContentRegistry` autoload, for the reason
## `exit_anchor_layer.gd` records: a test that `preload`s this file compiles it
## before the SceneTree's autoloads exist, so naming the singleton would be a
## compile error there and nowhere else.
const ContentRegistryScript := preload("res://scripts/content_registry.gd")
## The flag the host passes after `--`. Spelled identically in
## `src-tauri/src/viewer.rs::LIVE_FLAG`, which has a test that reads this file
## and compares them, because nothing else can: a disagreement between the two
## is a viewer that comes up in the mock Crossing and looks perfectly healthy.
const LIVE_FLAG := "--live-presentation"
## Retry cadence for a live start that could not even open a socket. The
## bridge's own reconnect timer only exists once a connection has been made, so
## the case where DR Companion is not running yet has nothing else driving it.
const LIVE_RETRY_SECONDS := 2.0
## Banner text for a host that answered on an open socket and refused what the
## viewer said. Named constants rather than literals because
## `godot/tests/live_status_states_test.gd` asserts these two are different
## strings: a server error swept up by the unrecognised-state arm would leave
## its own arm deletable with nothing going red, which is the shape of the bug
## that made this necessary.
const LIVE_STATUS_SERVER_ERROR := "DR Companion rejected a viewer message."
const LIVE_STATUS_UNRECOGNISED := "DR Companion reported an unrecognised state (%s)."

@onready var camera: Camera3D = $CameraDirector
@onready var cell_root: Node3D = $CellRoot
@onready var exit_root: Node3D = $ExitAnchors
@onready var entity_projection: Node3D = $EntityProjection
@onready var route_graph: Node3D = $RouteGraph
@onready var route_transition: Node3D = $RouteTransition
@onready var world_controls: CanvasLayer = $WorldControls
@onready var world_inspector: CanvasLayer = $WorldInspector

## cellId -> spawned Node3D, so a room change can clear/rebuild without
## leaking nodes and without re-deriving which nodes belong to which cell.
var _spawned_cells: Dictionary = {}
var _active_detail_cells: Dictionary = {}
var _visibility_policy := CellVisibilityPolicy.new()
var _last_confirmed_room_id := ""
## Built in code rather than in the scene: it exists only on the live path and
## the scene file is shared content. Null until a live start is attempted.
var _live_status: Label = null
var _live_retry: Timer = null

func _ready() -> void:
	BridgeClient.snapshot_updated.connect(_on_snapshot_updated)
	BridgeClient.reconnected.connect(_on_snapshot_updated)
	entity_projection.inspect_entity_requested.connect(_on_entity_inspect_requested)
	entity_projection.inspect_ground_item_requested.connect(_on_ground_item_inspect_requested)
	world_controls.view_requested.connect(_on_view_requested)
	world_controls.exit_requested.connect(_on_exit_requested)
	world_inspector.inspect_entity_requested.connect(_on_entity_inspect_requested)
	world_inspector.inspect_ground_item_requested.connect(_on_ground_item_inspect_requested)
	exit_root.exit_requested.connect(_on_exit_requested)

	if _live_requested():
		_build_live_status()
		BridgeClient.live_connection_changed.connect(_on_live_connection_changed)
		if not BridgeClient.start_live():
			push_error("WorldRoot: live presentation bridge is unavailable")
			# Returning here used to leave a black window with nothing in it and
			# no way to tell a broken viewer from an app that simply is not
			# running yet. Say which, and keep trying.
			_show_live_status("Bridge unavailable — is DR Companion running?")
			_begin_live_retry()
		return

	if not WorldManifestLoader.load_from_path(MOCK_FIXTURE_PATH):
		push_error("WorldRoot: failed to load mock fixture at %s" % MOCK_FIXTURE_PATH)
		return
	if not BridgeClient.start_mock(MOCK_WORLD_ID, MOCK_STARTING_ROOM):
		push_error("WorldRoot: failed to start mock bridge at %s" % MOCK_STARTING_ROOM)
		return

	_prepare_all_cells()
	route_graph.render_routes(WorldManifestLoader.cells)
	_apply_detail_window(MOCK_STARTING_ROOM)
	_project_snapshot_tokens(BridgeClient.current_snapshot)
	_focus_room(MOCK_STARTING_ROOM, camera.Mode.ROOM)

## Creates lightweight room holders and click targets for the whole loaded
## graph. Detailed primitives are mounted separately by `_apply_detail_window`
## so a city-sized manifest never instantiates every prop just to show a room.
func _prepare_all_cells() -> void:
	for child in cell_root.get_children():
		child.queue_free()
	_spawned_cells.clear()
	_active_detail_cells.clear()

	for cell_id in WorldManifestLoader.cells.keys():
		var cell: Dictionary = WorldManifestLoader.cells[cell_id]
		var holder := Node3D.new()
		holder.name = "Cell_%s" % cell_id
		holder.position = _cell_position(cell)
		holder.set_meta("board", cell.get("board", {}))
		cell_root.add_child(holder)
		_spawned_cells[cell_id] = holder
		var content := Node3D.new()
		content.name = "DetailContent"
		holder.add_child(content)

		# A clickable body per cell, so the mock viewer can turn a click into
		# a focus-room intent even before real per-primitive collision
		# shapes exist. Codex's content later adds its own collision where a
		# specific mesh needs finer picking; this is the always-present
		# fallback the contract needs for slice 0's acceptance gate.
		#
		# Its size is the cell's own `board.selectionBounds`, asked for through
		# ContentRegistry like every other board dimension. It was a hand-typed
		# `Vector3(4.5, 1.0, 4.5)` until issue #366 - 5 cm proud of the block on
		# every side, so a click in the gutter between two rooms silently picked
		# one of them, and 1 m tall on an interior cutaway the manifest publishes
		# at 3, so most of that room's block could not be clicked at all.
		var body := StaticBody3D.new()
		body.name = "ClickTarget"
		var shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = ContentRegistryScript.selection_size_metres(cell)
		shape.shape = box
		body.add_child(shape)
		body.input_event.connect(_on_cell_clicked.bind(cell_id))
		holder.add_child(body)

func _apply_detail_window(origin_id: String) -> void:
	var window: Dictionary = _visibility_policy.detail_window(origin_id, WorldManifestLoader.cells)
	var requested_ids: Array = window.get("detailIds", [])
	# A loaded cell is always at distance 0 from itself, so an empty window for
	# one is not a small budget - it is the policy having failed to answer, and
	# the whole board then draws nothing. That is what issue #376 looked like
	# from here: a GDScript runtime error inside `detail_window()` returned null,
	# this Dictionary came back empty, and nineteen cells mounted no content at
	# all while the console carried one line about a String constructor. An empty
	# window for a cell that is *not* in the manifest is the honest answer and is
	# left alone.
	if requested_ids.is_empty() and WorldManifestLoader.has_cell(origin_id):
		push_error("WorldRoot: the detail window for '%s' came back empty although it is a loaded cell, so no cell will mount any primitive and the board will draw nothing. CellVisibilityPolicy.detail_window() failed rather than returning a small budget." % origin_id)
	var requested: Dictionary = {}
	for cell_id in requested_ids:
		requested[cell_id] = true

	for cell_id in _active_detail_cells.keys():
		if not requested.has(cell_id):
			_unmount_cell_detail(cell_id)
	for cell_id in requested.keys():
		if not _active_detail_cells.has(cell_id):
			_mount_cell_detail(cell_id)

func _mount_cell_detail(cell_id: String) -> void:
	var holder: Node3D = _spawned_cells.get(cell_id)
	var cell: Dictionary = WorldManifestLoader.get_cell(cell_id)
	if holder == null or cell.is_empty():
		return
	var content: Node3D = holder.get_node_or_null("DetailContent")
	if content == null:
		return
	for primitive in cell.get("primitives", []):
		content.add_child(ContentRegistry.build(cell, primitive))
	_active_detail_cells[cell_id] = true

func _unmount_cell_detail(cell_id: String) -> void:
	var holder: Node3D = _spawned_cells.get(cell_id)
	if holder == null:
		_active_detail_cells.erase(cell_id)
		return
	var content: Node3D = holder.get_node_or_null("DetailContent")
	if content != null:
		for child in content.get_children():
			child.free()
	_active_detail_cells.erase(cell_id)

func _cell_position(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))

func _on_cell_clicked(_camera: Node, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape_idx: int, cell_id: String) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var current_room: String = BridgeClient.current_snapshot.get("currentRoomId", "")
		var exit := _exit_towards(current_room, cell_id)
		if exit != "":
			IntentSender.request_walk(current_room, exit)
		else:
			IntentSender.request_focus_room(cell_id)

func _exit_towards(from_room_id: String, target_cell_id: String) -> String:
	for exit in WorldManifestLoader.true_exits(from_room_id):
		if exit.get("targetCellId", "") == target_cell_id:
			return exit.get("move", "")
	return ""

func _on_snapshot_updated(snapshot: Dictionary) -> void:
	# Real state arrived, so whatever the banner last said is now untrue.
	_show_live_status("")
	var room_id: String = snapshot.get("currentRoomId", "")
	if _spawned_cells.size() != WorldManifestLoader.cells.size() or (room_id != "" and not _spawned_cells.has(room_id)):
		_prepare_all_cells()
		route_graph.render_routes(WorldManifestLoader.cells)
	if room_id != "" and not _last_confirmed_room_id.is_empty() and room_id != _last_confirmed_room_id and not _spawned_cells.is_empty():
		route_transition.play_confirmed_route(_last_confirmed_room_id, room_id, WorldManifestLoader.cells)
	if room_id != "":
		_focus_room(room_id, camera.Mode.ROOM)
		_apply_detail_window(room_id)
		_last_confirmed_room_id = room_id
	_rebuild_exit_anchors(room_id)
	_project_snapshot_tokens(snapshot)

func _live_requested() -> bool:
	return OS.get_cmdline_user_args().has(LIVE_FLAG)

func _build_live_status() -> void:
	if _live_status != null:
		return
	var layer := CanvasLayer.new()
	layer.name = "LiveStatus"
	layer.layer = 100
	_live_status = Label.new()
	_live_status.name = "Message"
	_live_status.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_live_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_live_status.offset_top = 24.0
	_live_status.visible = false
	layer.add_child(_live_status)
	add_child(layer)

## The one place the live banner's text is set. Hidden again by the first
## snapshot, so the label can never outlive the condition it describes.
func _show_live_status(message: String) -> void:
	if _live_status == null:
		return
	_live_status.text = message
	_live_status.visible = not message.is_empty()

func _begin_live_retry() -> void:
	if _live_retry != null:
		return
	_live_retry = Timer.new()
	_live_retry.name = "LiveRetry"
	_live_retry.wait_time = LIVE_RETRY_SECONDS
	_live_retry.timeout.connect(_on_live_retry_timeout)
	add_child(_live_retry)
	_live_retry.start()

func _on_live_retry_timeout() -> void:
	# Once a socket is open BridgeClient owns the retrying, so stop competing
	# with its backoff: this timer exists only for the never-connected case.
	if BridgeClient.start_live():
		_end_live_retry()

func _end_live_retry() -> void:
	if _live_retry == null:
		return
	_live_retry.stop()
	_live_retry.queue_free()
	_live_retry = null

func _on_live_connection_changed(state: String) -> void:
	match state:
		"authenticated":
			_end_live_retry()
			_show_live_status("")
		"connecting", "connected-awaiting-auth":
			# A socket is open, so BridgeClient's own backoff takes over from
			# the never-connected retry above.
			_end_live_retry()
			_show_live_status("Connecting to DR Companion…")
		"configuration-unavailable", "configuration-invalid", "connection-failed":
			_show_live_status("Bridge unavailable — is DR Companion running?")
			_begin_live_retry()
		"server-error":
			# The host answered over a socket that is still open and refused
			# something the viewer sent, so the connection is not the problem
			# and reopening it would not help: no retry from here. Until this
			# arm existed the state matched nothing at all and the previous
			# banner stayed up, so a server error after "connecting" read as
			# "Connecting to DR Companion…" indefinitely (issue #341).
			_show_live_status(LIVE_STATUS_SERVER_ERROR)
		_:
			if state.begins_with("failed:"):
				_show_live_status("Bridge unavailable — is DR Companion running?")
				_begin_live_retry()
			elif state.begins_with("reconnecting-"):
				_show_live_status("Reconnecting to DR Companion…")
			else:
				# Every arm above is a state BridgeClient emits today. One it
				# grows tomorrow must not fall through in silence: the banner
				# would then describe a condition that has already passed,
				# which `_show_live_status` says below cannot happen. Saying
				# something imprecise is the lesser failure.
				push_warning("WorldRoot: unhandled live connection state '%s'" % state)
				_show_live_status(LIVE_STATUS_UNRECOGNISED % state)

func _project_snapshot_tokens(snapshot: Dictionary) -> void:
	# The projection layer owns only visual, deterministic room-local slots.
	# It receives no independent positions, so it cannot turn a MUD occupant
	# into a free-roaming world actor.
	entity_projection.project_snapshot(snapshot, _spawned_cells)
	world_inspector.render_snapshot(snapshot)

func _on_entity_inspect_requested(entity_id: String) -> void:
	IntentSender.request_inspect_entity(entity_id)

func _on_ground_item_inspect_requested(item_id: String) -> void:
	IntentSender.request_inspect_ground_item(item_id)

func _focus_room(room_id: String, mode: int) -> void:
	var cell: Dictionary = WorldManifestLoader.get_cell(room_id)
	if cell.is_empty():
		return
	camera.focus_on(mode, _cell_position(cell))

## Public camera controls for the host UI. They do not mutate MUD state and
## do not change the detail budget: world view keeps the local bubble mounted
## while the route mesh supplies the city-scale context.
func focus_world_view() -> void:
	if WorldManifestLoader.cells.is_empty():
		return
	var center := Vector3.ZERO
	for cell in WorldManifestLoader.cells.values():
		center += _cell_position(cell)
	center /= float(WorldManifestLoader.cells.size())
	camera.focus_on(camera.Mode.WORLD, center)

func focus_current_room_view() -> void:
	var room_id: String = BridgeClient.current_snapshot.get("currentRoomId", "")
	if room_id != "":
		_focus_room(room_id, camera.Mode.ROOM)

func focus_route_view() -> void:
	var room_id: String = BridgeClient.current_snapshot.get("currentRoomId", "")
	if room_id != "":
		_focus_room(room_id, camera.Mode.ROUTE)

func _on_view_requested(view_id: String) -> void:
	match view_id:
		"world": focus_world_view()
		"route": focus_route_view()
		"room": focus_current_room_view()

func _on_exit_requested(from_room_id: String, exit_move: String) -> void:
	# Markers are rebuilt from snapshots, but the room check prevents a late
	# click from an old frame from becoming a command in a new room.
	if BridgeClient.current_snapshot.get("currentRoomId", "") == from_room_id:
		IntentSender.request_walk(from_room_id, exit_move)

## Both representations receive the identical true-exit collection. They also
## converge on `_on_exit_requested`, which rechecks the current snapshot.
func _rebuild_exit_anchors(room_id: String) -> void:
	exit_root.render_exits(room_id, WorldManifestLoader.cells)
	world_controls.render_exits(room_id, WorldManifestLoader.true_exits(room_id))

## Host-facing copy of the accessible, non-3D-dependent exit labels.
func exit_labels() -> Array:
	var room_id: String = BridgeClient.current_snapshot.get("currentRoomId", "")
	var labels: Array = []
	for exit in WorldManifestLoader.true_exits(room_id):
		labels.append(exit.get("move", ""))
	return labels
