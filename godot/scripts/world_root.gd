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

@onready var camera: Camera3D = $CameraDirector
@onready var cell_root: Node3D = $CellRoot
@onready var exit_root: Node3D = $ExitAnchors
@onready var entity_projection: Node3D = $EntityProjection

## cellId -> spawned Node3D, so a room change can clear/rebuild without
## leaking nodes and without re-deriving which nodes belong to which cell.
var _spawned_cells: Dictionary = {}
var _spawned_exit_anchors: Array = []
var _active_detail_cells: Dictionary = {}
var _visibility_policy := CellVisibilityPolicy.new()

func _ready() -> void:
	BridgeClient.snapshot_updated.connect(_on_snapshot_updated)
	BridgeClient.reconnected.connect(_on_snapshot_updated)
	entity_projection.inspect_entity_requested.connect(_on_entity_inspect_requested)
	entity_projection.inspect_ground_item_requested.connect(_on_ground_item_inspect_requested)

	if not WorldManifestLoader.load_from_path(MOCK_FIXTURE_PATH):
		push_error("WorldRoot: failed to load mock fixture at %s" % MOCK_FIXTURE_PATH)
		return
	if not BridgeClient.start_mock(MOCK_WORLD_ID, MOCK_STARTING_ROOM):
		push_error("WorldRoot: failed to start mock bridge at %s" % MOCK_STARTING_ROOM)
		return

	_prepare_all_cells()
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
		var body := StaticBody3D.new()
		body.name = "ClickTarget"
		var shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(4.5, 1.0, 4.5)
		shape.shape = box
		body.add_child(shape)
		body.input_event.connect(_on_cell_clicked.bind(cell_id))
		holder.add_child(body)

func _apply_detail_window(origin_id: String) -> void:
	var window: Dictionary = _visibility_policy.detail_window(origin_id, WorldManifestLoader.cells)
	var requested_ids: Array = window.get("detailIds", [])
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
	var room_id: String = snapshot.get("currentRoomId", "")
	if room_id != "":
		_focus_room(room_id, camera.Mode.ROOM)
		_apply_detail_window(room_id)
	_rebuild_exit_anchors(room_id)
	_project_snapshot_tokens(snapshot)

func _project_snapshot_tokens(snapshot: Dictionary) -> void:
	# The projection layer owns only visual, deterministic room-local slots.
	# It receives no independent positions, so it cannot turn a MUD occupant
	# into a free-roaming world actor.
	entity_projection.project_snapshot(snapshot, _spawned_cells)

func _on_entity_inspect_requested(entity_id: String) -> void:
	IntentSender.request_inspect_entity(entity_id)

func _on_ground_item_inspect_requested(item_id: String) -> void:
	IntentSender.request_inspect_ground_item(item_id)

func _focus_room(room_id: String, mode: int) -> void:
	var cell: Dictionary = WorldManifestLoader.get_cell(room_id)
	if cell.is_empty():
		return
	camera.focus_on(mode, _cell_position(cell))

## Exit anchors: one visible marker per true exit of the current room,
## reachable to a text/list equivalent too (see `Viewer.exit_labels()`
## below) — the accessible-controls requirement the brief calls out is not
## satisfiable by 3D markers alone.
func _rebuild_exit_anchors(room_id: String) -> void:
	for node in _spawned_exit_anchors:
		node.queue_free()
	_spawned_exit_anchors.clear()

	var cell: Dictionary = WorldManifestLoader.get_cell(room_id)
	var base_position := _cell_position(cell)
	var exits: Array = WorldManifestLoader.true_exits(room_id)
	var count := exits.size()
	for i in range(count):
		var exit: Dictionary = exits[i]
		var angle: float = TAU * float(i) / maxi(1, count)
		var marker := MeshInstance3D.new()
		var sphere := SphereMesh.new()
		sphere.radius = 0.4
		sphere.height = 0.8
		marker.mesh = sphere
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(0.95, 0.85, 0.3)
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		marker.material_override = material
		marker.name = "Exit_%s" % exit.get("move", "?")
		marker.position = base_position + Vector3(cos(angle) * 2.4, 0.6, sin(angle) * 2.4)
		exit_root.add_child(marker)
		_spawned_exit_anchors.append(marker)

## The accessible, non-3D-dependent list of the current room's true exits —
## a UI panel outside this scene calls this rather than reading the 3D
## markers, so the exit list stays reachable even if rendering is degraded
## or unavailable.
func exit_labels() -> Array:
	var room_id: String = BridgeClient.current_snapshot.get("currentRoomId", "")
	var labels: Array = []
	for exit in WorldManifestLoader.true_exits(room_id):
		labels.append(exit.get("move", ""))
	return labels
