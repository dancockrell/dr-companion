extends Node3D
## Renderer of confirmed topology. Camera framing never sends travel intents.
const LIVE_FLAG := "--live-presentation"
const VisibilityPolicy := preload("res://scripts/cell_visibility_policy.gd")
const CombatPresentation := preload("res://scripts/combat_presentation.gd")
var geometry := Node3D.new()
var camera := Camera3D.new()
var focus := Vector3.ZERO
var camera_size := 24.0
var yaw := PI / 4.0
var current_room := ""
var view_mode := "room"
var title_label := Label.new()
var status_label := Label.new()
var details := VBoxContainer.new()
var exits := HBoxContainer.new()
var snapshot: Dictionary = {}
var player_summary := Label.new()
var roundtime_started_ms := 0
var rendered_ids: Array = []
var board_signature := ""
var inspector_signature := ""

func wants_live() -> bool:
	return OS.get_cmdline_user_args().has(LIVE_FLAG)

func _ready() -> void:
	add_child(geometry)
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.far = 5000.0
	add_child(camera)
	camera.make_current()
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("101923")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("a9c4de")
	settings.ambient_light_energy = 0.65
	environment.environment = settings
	add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -30, 0)
	sun.light_energy = 1.4
	sun.shadow_enabled = true
	add_child(sun)
	_build_hud()
	BridgeClient.snapshot_updated.connect(render_snapshot)
	BridgeClient.reconnected.connect(render_snapshot)
	BridgeClient.live_connection_changed.connect(_connection_changed)
	BridgeClient.intent_rejected.connect(func(_intent, reason): status_label.text = reason)
	IntentSender.intent_refused.connect(func(reason): status_label.text = reason)
	if wants_live():
		status_label.text = "Connecting to the app…"
		BridgeClient.start_live()
	else:
		status_label.text = "DEMO • local fixture • no game connected"
		if WorldManifestLoader.load_from_path("res://mock/crossing_mock_world.json"):
			BridgeClient.start_mock("crossing", "1-14")
	_update_camera()

func _connection_changed(state: String) -> void:
	status_label.text = "Live bridge: %s" % state
	# A disconnected board stays visible, but its controls cannot send stale actions.
	for child in exits.get_children():
		child.disabled = state != "authenticated"

func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	margin.offset_left = 16
	margin.offset_right = -16
	margin.offset_top = 16
	layer.add_child(margin)
	var panel := PanelContainer.new()
	margin.add_child(panel)
	var content := VBoxContainer.new()
	panel.add_child(content)
	title_label.text = "Waiting for confirmed room"
	title_label.add_theme_font_size_override("font_size", 22)
	content.add_child(title_label)
	content.add_child(status_label)
	var modes := HBoxContainer.new()
	content.add_child(modes)
	for mode in ["world", "route", "room"]:
		var button := Button.new()
		button.text = mode.capitalize()
		button.pressed.connect(set_view.bind(mode))
		modes.add_child(button)
	var reset := Button.new()
	reset.text = "Recenter (R)"
	reset.pressed.connect(func(): set_view(view_mode))
	modes.add_child(reset)
	var help := Label.new()
	help.text = "Wheel: zoom • Right drag: orbit • Middle drag: pan • 1/2/3: views"
	content.add_child(help)
	var bottom := PanelContainer.new()
	bottom.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	bottom.offset_left = 16
	bottom.offset_right = -16
	bottom.offset_top = -190
	bottom.offset_bottom = -16
	layer.add_child(bottom)
	var body := VBoxContainer.new()
	bottom.add_child(body)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(scroll)
	details.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(details)
	var exit_scroll := ScrollContainer.new()
	exit_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	exit_scroll.custom_minimum_size.y = 40
	body.add_child(exit_scroll)
	exit_scroll.add_child(exits)

func render_snapshot(next: Dictionary) -> void:
	snapshot = next.duplicate(true)
	roundtime_started_ms = Time.get_ticks_msec()
	var moved := current_room != str(next.get("currentRoomId", ""))
	current_room = str(next.get("currentRoomId", ""))
	var cell := WorldManifestLoader.get_cell(current_room)
	title_label.text = str(next.get("activeRoom", {}).get("title", cell.get("title", "Location unresolved")))
	_rebuild_board()
	_rebuild_details()
	if moved:
		set_view(view_mode)

func _point(cell: Dictionary) -> Vector3:
	var point: Dictionary = cell.get("position", {})
	return Vector3(float(point.get("x", 0)), float(point.get("y", 0)), float(point.get("z", 0)))

func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.82
	return material

func _box(parent: Node3D, at: Vector3, size: Vector3, color: Color) -> void:
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh.mesh = box
	mesh.material_override = _material(color)
	mesh.position = at
	parent.add_child(mesh)

func _label(parent: Node3D, at: Vector3, text: String) -> void:
	var label := Label3D.new()
	label.text = text
	label.position = at
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 24
	label.pixel_size = 0.008
	label.no_depth_test = true
	parent.add_child(label)

func _rebuild_board() -> void:
	if not WorldManifestLoader.has_cell(current_room):
		for child in geometry.get_children():
			child.free()
		rendered_ids = []
		return
	var window: Dictionary = VisibilityPolicy.new().detail_window(current_room, WorldManifestLoader.cells)
	var ids: Array = WorldManifestLoader.cells.keys() if view_mode == "world" else window.detailIds
	# Bound world geometry on large zones; the full topology remains loaded.
	if ids.size() > 400:
		ids.sort_custom(func(a, b): return _point(WorldManifestLoader.get_cell(a)).distance_squared_to(focus) < _point(WorldManifestLoader.get_cell(b)).distance_squared_to(focus))
		ids = ids.slice(0, 400)
	rendered_ids = ids
	var visible_cells: Array = []
	for id in ids:
		visible_cells.append(WorldManifestLoader.get_cell(id))
	var next_signature := JSON.stringify({"mode": view_mode, "room": current_room, "cells": visible_cells, "entities": snapshot.get("entities", []), "items": snapshot.get("groundItems", [])})
	if next_signature == board_signature:
		return
	board_signature = next_signature
	for child in geometry.get_children():
		child.free()
	var palette := {"street": Color("737e88"), "grass": Color("557450"), "water": Color("387e9c"), "cave": Color("625b71"), "forest": Color("385e48")}
	for id in ids:
		var cell := WorldManifestLoader.get_cell(id)
		var at := _point(cell)
		var board: Dictionary = cell.get("board", {})
		var footprint: Dictionary = board.get("footprint", {})
		var width := float(footprint.get("width", 4.4))
		var depth := float(footprint.get("depth", 4.4))
		var color: Color = palette.get(cell.get("groundKind", ""), Color("7e735e"))
		_box(geometry, at + Vector3(0, -0.3, 0), Vector3(width, 0.6, depth), color)
		if id == current_room:
			# Small seams give the active board scale without implying invented props.
			for x in range(4):
				for z in range(4):
					var tile_at := at + Vector3((float(x) - 1.5) * width / 4.0, 0.018, (float(z) - 1.5) * depth / 4.0)
					_box(geometry, tile_at, Vector3(width / 4.0 - 0.025, 0.036, depth / 4.0 - 0.025), color.lightened(0.04 if (x + z) % 2 == 0 else 0.01))
			_box(geometry, at + Vector3(0, -0.64, 0), Vector3(width + 0.3, 0.12, depth + 0.3), Color("e7bd69"))
		if view_mode != "room":
			_label(geometry, at + Vector3(0, 1.7, 0), str(cell.get("title", id)))
		if cell.get("spatialMode", "") == "interior-cutaway":
			_box(geometry, at + Vector3(0, 0.6, -depth / 2), Vector3(width, 1.2, 0.18), color.darkened(0.25))
		for exit in cell.get("exits", []):
			var target = exit.get("targetCellId")
			if not target is String or not ids.has(target):
				continue
			var end := _point(WorldManifestLoader.get_cell(target))
			if view_mode == "room":
				continue
			if at.distance_to(end) < 0.01:
				continue
			var line := MeshInstance3D.new()
			var mesh := CylinderMesh.new()
			mesh.top_radius = 0.035
			mesh.bottom_radius = 0.035
			mesh.height = at.distance_to(end)
			line.mesh = mesh
			line.material_override = _material(Color("8ca8b9"))
			geometry.add_child(line)
			line.position = (at + end) / 2.0
			var direction := (end - at).normalized()
			if absf(direction.dot(Vector3.UP)) < 0.999:
				line.quaternion = Quaternion(Vector3.UP, direction)
	var origin := _point(WorldManifestLoader.get_cell(current_room))
	_token(origin, "", Color("edc578"), 0)
	var index := 1
	for entity in snapshot.get("entities", []):
		if str(entity.get("roomId", "")) == current_room:
			_token(origin, str(entity.get("name", "Unknown")), CombatPresentation.token_color(entity), index)
			index += 1
	var item_index := 0
	for item in snapshot.get("groundItems", []):
		if str(item.get("roomId", "")) != current_room:
			continue
		var at := origin + Vector3(-1.5 + float(item_index % 6) * 0.5, 0.1, 1.5 + float(item_index / 6) * 0.3)
		_box(geometry, at, Vector3(0.25, 0.2, 0.25), Color("bca287"))
		item_index += 1

func _token(origin: Vector3, text: String, color: Color, index: int) -> void:
	var at := origin
	if index > 0:
		var angle := float(index) * 2.4
		at += Vector3(cos(angle), 0, sin(angle)) * (1.0 + float(index / 6) * 0.55)
	var mesh := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.22
	capsule.height = 0.9
	mesh.mesh = capsule
	mesh.position = at + Vector3(0, 0.45, 0)
	mesh.material_override = _material(color)
	geometry.add_child(mesh)
	if not text.is_empty():
		_label(geometry, at + Vector3(0, 1.35, 0), text)

func _rebuild_details() -> void:
	_update_player_summary()
	var next_signature := JSON.stringify({"room": current_room, "exits": WorldManifestLoader.true_exits(current_room), "entities": snapshot.get("entities", []), "items": snapshot.get("groundItems", [])})
	if next_signature == inspector_signature:
		return
	inspector_signature = next_signature
	for child in details.get_children():
		if child == player_summary:
			details.remove_child(child)
		else:
			child.free()
	for child in exits.get_children():
		child.free()
	details.add_child(player_summary)
	_update_player_summary()
	for key in ["entities", "groundItems"]:
		for entry in snapshot.get(key, []):
			if str(entry.get("roomId", "")) != current_room:
				continue
			var button := Button.new()
			button.text = str(entry.get("name", "Unknown"))
			if key == "entities":
				button.tooltip_text = CombatPresentation.tactical_tooltip(entry)
				button.pressed.connect(IntentSender.request_inspect_entity.bind(str(entry.get("id", ""))))
			else:
				button.pressed.connect(IntentSender.request_inspect_ground_item.bind(str(entry.get("id", ""))))
			details.add_child(button)
	var moves := {}
	for exit in WorldManifestLoader.true_exits(current_room):
		var move := str(exit.get("move", "")).strip_edges()
		if move.is_empty() or moves.has(move):
			continue
		moves[move] = true
		var button := Button.new()
		button.text = move.capitalize()
		button.tooltip_text = "Request confirmed exit: %s" % move
		button.pressed.connect(IntentSender.request_walk.bind(current_room, move))
		exits.add_child(button)

func set_view(mode: String) -> void:
	if not mode in ["world", "route", "room"]:
		return
	view_mode = mode
	focus = _point(WorldManifestLoader.get_cell(current_room))
	camera_size = 12.0 if mode == "room" else 42.0 if mode == "route" else 140.0
	_rebuild_board()
	if mode != "room" and not rendered_ids.is_empty():
		var low := _point(WorldManifestLoader.get_cell(rendered_ids[0]))
		var high := low
		for id in rendered_ids:
			var at := _point(WorldManifestLoader.get_cell(id))
			low = low.min(at)
			high = high.max(at)
		focus = (low + high) / 2.0
		camera_size = maxf(24.0, (high - low).length() * 1.55 + 12.0)
	_update_camera()

func _update_camera() -> void:
	camera.size = camera_size
	camera.position = focus + Vector3(cos(yaw), 1.25, sin(yaw)) * 200.0
	camera.look_at(focus)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			camera_size = maxf(6.0, camera_size * 0.88)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			camera_size = minf(500.0, camera_size / 0.88)
	if event is InputEventMouseMotion:
		if event.button_mask & MOUSE_BUTTON_MASK_RIGHT:
			yaw -= event.relative.x * 0.008
		elif event.button_mask & MOUSE_BUTTON_MASK_MIDDLE:
			focus -= camera.global_basis.x * event.relative.x * camera_size / 720.0
			focus += Vector3(sin(yaw), 0, -cos(yaw)) * event.relative.y * camera_size / 720.0
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_1: set_view("world")
			KEY_2: set_view("route")
			KEY_3: set_view("room")
			KEY_R: set_view(view_mode)
	_update_camera()

func _process(_delta: float) -> void:
	_update_player_summary()

func _update_player_summary() -> void:
	var player: Dictionary = CombatPresentation.player_view(snapshot.get("player"))
	var state: String = player.state
	if state == "ROUND TIME":
		var remaining := maxf(0.0, float(player.roundtime) - float(Time.get_ticks_msec() - roundtime_started_ms) / 1000.0)
		state = "ROUND TIME %.1fs" % remaining if remaining > 0.0 else "READY"
	player_summary.text = "%s • %s" % [state, player.healthText]
	player_summary.add_theme_color_override("font_color", Color("ed8b7f") if state == "CANNOT ACT" else Color("99d7ae") if state == "READY" else Color("a9b7c4") if not player.known else Color("edc578"))

func _exit_tree() -> void:
	if not player_summary.is_inside_tree():
		player_summary.free()
