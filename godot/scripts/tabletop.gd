extends Node3D
## A read-only board of confirmed facts. Selection is local; travel is always
## an explicit intent, and only a later snapshot can move the player.
const LIVE_FLAG := "--live-presentation"
const VisibilityPolicy := preload("res://scripts/cell_visibility_policy.gd")
const CombatPresentation := preload("res://scripts/combat_presentation.gd")
const TabletopMaterials := preload("res://scripts/tabletop_materials.gd")
const RoomDiorama := preload("res://scripts/room_diorama.gd")
const GOLD := Color("edc578")
const INK := Color("101923")
const MUTED := Color("a8bdca")
const TERRAIN := {"street": Color("737e88"), "path": Color("91765a"), "grass": Color("2d3927"), "water": Color("387e9c"), "cave": Color("625b71"), "forest": Color("283d2b"), "interior": Color("82716a"), "snow": Color("cbd8df"), "sand": Color("c5ab78"), "swamp": Color("506350"), "rock": Color("7b8088"), "farmland": Color("8c7954")}
var surface_art := TabletopMaterials.new()
var diorama_art := RoomDiorama.new()
var token_stands: Array[Node3D] = []
var geometry := Node3D.new()
var effects := Node3D.new()
var camera := Camera3D.new()
var focus := Vector3.ZERO
var camera_size := 8.7
var yaw := PI / 4.0
var current_room := ""
var view_mode := "room"
var title_label := Label.new()
var status_label := Label.new()
var source_badge := Label.new()
var source_signature := ""
var mode_hint := Label.new()
var details := VBoxContainer.new()
var exits := HBoxContainer.new()
var snapshot: Dictionary = {}
var player_summary := Label.new()
var room_description := Label.new()
var information_scroll := ScrollContainer.new()
var selection_title := Label.new()
var selection_description := Label.new()
var travel_button := Button.new()
var event_label := Label.new()
var graph_overlay := Control.new()
var graph_labels: Dictionary = {}
var overview_markers: Dictionary = {}
var overview_pick_bodies: Dictionary = {}
var overview_links: Array[MeshInstance3D] = []
var overview_layout_pending := false
var destination_filter := LineEdit.new()
var destination_list := ItemList.new()
var destination_hint := Label.new()
var destination_signature := ""
var focus_button := Button.new()
var mode_buttons: Dictionary = {}
var hud_theme := Theme.new()
var roundtime_started_ms := 0
var rendered_ids: Array = []
var board_signature := ""
var inspector_signature := ""
var selected_kind := ""
var selected_id := ""
var connection_state := "demo"
var selection_ring: MeshInstance3D
var token_positions: Dictionary = {}
var token_labels: Dictionary = {}
var pick_bodies: Dictionary = {}
var event_history: Array[Dictionary] = []
var pending_effects: Array[Dictionary] = []
var effect_wait := 0.0
var last_effect_sequence := 0

func wants_live() -> bool:
	return OS.get_cmdline_user_args().has(LIVE_FLAG)

func _ready() -> void:
	add_child(geometry)
	add_child(effects)
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.far = 5000.0
	add_child(camera)
	camera.make_current()
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = INK
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("a9c4de")
	settings.ambient_light_energy = 0.32
	settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.environment = settings
	add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -30, 0)
	sun.light_color = Color("fff0d9")
	sun.light_energy = 0.85
	sun.shadow_enabled = true
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-25, 145, 0)
	fill.light_color = Color("86b6d9")
	fill.light_energy = 0.18
	add_child(fill)
	_build_hud()
	BridgeClient.snapshot_updated.connect(render_snapshot)
	BridgeClient.reconnected.connect(_reconnected)
	BridgeClient.live_connection_changed.connect(_connection_changed)
	BridgeClient.intent_rejected.connect(func(_intent, reason): status_label.text = reason)
	IntentSender.intent_refused.connect(func(reason): status_label.text = reason)
	EventPlayer.event_played.connect(_event_played)
	if wants_live():
		connection_state = "connecting"
		status_label.text = "Connecting to the app…"
		BridgeClient.start_live()
	else:
		status_label.text = "OFFLINE • DragonRealms reference rooms • no game connected"
		if WorldManifestLoader.load_from_path("res://mock/crossing_mock_world.json"):
			BridgeClient.start_mock("crossing", "1-14")
	_update_camera()

func _connection_changed(state: String) -> void:
	connection_state = state
	_update_source_status()
	_update_action_availability()

func _reconnected(next: Dictionary) -> void:
	_clear_events()
	render_snapshot(next)

func _actions_available() -> bool:
	if BridgeClient.mock_mode:
		return connection_state in ["demo", "authenticated"]
	return connection_state == "authenticated" and BridgeClient.can_send_live_intents()

func _update_source_status() -> void:
	var source = snapshot.get("source")
	var signature := JSON.stringify([source, connection_state, BridgeClient.mock_mode])
	if signature == source_signature:
		return
	source_signature = signature
	if BridgeClient.mock_mode:
		if source is Dictionary and source.get("sample") == true:
			source_badge.text = "DR COMPANION  /  EXPLICIT SAMPLE FIXTURE"
			status_label.text = "DEMO • illustrative sample state • no game connected"
		else:
			source_badge.text = "DR COMPANION  /  DRAGONREALMS REFERENCE"
			status_label.text = "OFFLINE • reference room descriptions and exits • no live inhabitants or events"
	elif source is Dictionary and source.get("kind") == "demo":
		source_badge.text = "DR COMPANION  /  DEMO FROM APP"
		status_label.text = "Demo from app • no live game • travel unavailable • bridge %s" % connection_state
	elif source is Dictionary and source.get("kind") == "live" and source.get("connected") == true:
		source_badge.text = "DR COMPANION  /  LIVE SOURCE"
		status_label.text = "Live source connected • bridge %s" % connection_state
	elif source is Dictionary and source.get("kind") == "live":
		source_badge.text = "DR COMPANION  /  SOURCE DISCONNECTED"
		var location_hint := "waiting for your game" if str(snapshot.get("currentRoomId", "")).is_empty() else "last known room"
		status_label.text = "Disconnected • %s • bridge %s" % [location_hint, connection_state]
	else:
		source_badge.text = "DR COMPANION  /  SOURCE UNKNOWN"
		status_label.text = "Source unverified • travel unavailable • bridge %s" % connection_state

func _update_action_availability() -> void:
	for child in exits.get_children():
		child.disabled = not _actions_available()
	travel_button.disabled = not can_request_selected_travel()

func _build_theme() -> void:
	hud_theme.default_font_size = 14
	hud_theme.set_font_size("font_size", "Button", 14)
	for state in ["normal", "hover", "pressed", "disabled", "focus"]:
		var style := StyleBoxFlat.new()
		style.bg_color = Color("243945") if state == "hover" else Color("354b52") if state == "pressed" else Color("152630")
		if state == "disabled":
			style.bg_color = Color("13212a")
		style.border_color = GOLD if state in ["pressed", "focus"] else Color("405765")
		style.set_border_width_all(1)
		style.set_corner_radius_all(6)
		style.content_margin_left = 10
		style.content_margin_right = 10
		style.content_margin_top = 5
		style.content_margin_bottom = 5
		if state == "focus":
			style.bg_color = Color.TRANSPARENT
		hud_theme.set_stylebox(state, "Button", style)
	hud_theme.set_color("font_color", "Button", Color("d7e5ec"))
	hud_theme.set_color("font_disabled_color", "Button", Color("788d9a"))

func _panel_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.045, 0.075, 0.105, 0.96)
	style.border_color = Color("324957")
	style.set_border_width_all(1)
	style.set_corner_radius_all(12)
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	return style

func _panel(layer: CanvasLayer, preset: int, bounds: Vector4) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.theme = hud_theme
	panel.set_anchors_and_offsets_preset(preset)
	panel.offset_left = bounds.x
	panel.offset_top = bounds.y
	panel.offset_right = bounds.z
	panel.offset_bottom = bounds.w
	panel.add_theme_stylebox_override("panel", _panel_style())
	layer.add_child(panel)
	return panel

func _small_label(text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", 12)
	label.add_theme_color_override("font_color", MUTED)
	return label

func _build_hud() -> void:
	_build_theme()
	var layer := CanvasLayer.new()
	add_child(layer)
	graph_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	graph_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	graph_overlay.theme = hud_theme
	layer.add_child(graph_overlay)
	var header := _panel(layer, Control.PRESET_TOP_WIDE, Vector4(16, 16, -16, 112))
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 6)
	header.add_child(content)
	var heading := HBoxContainer.new()
	content.add_child(heading)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	heading.add_child(titles)
	source_badge.add_theme_font_size_override("font_size", 12)
	source_badge.add_theme_color_override("font_color", MUTED)
	titles.add_child(source_badge)
	title_label.text = "Waiting for confirmed room"
	title_label.add_theme_font_size_override("font_size", 22)
	title_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	titles.add_child(title_label)
	var modes := HBoxContainer.new()
	modes.alignment = BoxContainer.ALIGNMENT_END
	heading.add_child(modes)
	for mode in ["world", "route", "room"]:
		var button := Button.new()
		button.text = mode.capitalize()
		button.toggle_mode = true
		button.custom_minimum_size = Vector2(72, 36)
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.pressed.connect(set_view.bind(mode))
		modes.add_child(button)
		mode_buttons[mode] = button
	var reset := Button.new()
	reset.text = "Recenter"
	reset.tooltip_text = "Recenter the current view (R)"
	reset.pressed.connect(func(): set_view(view_mode))
	modes.add_child(reset)
	for pair in [["−", 1.25], ["+", 0.8]]:
		var zoom := Button.new()
		zoom.text = pair[0]
		zoom.custom_minimum_size.x = 36
		zoom.tooltip_text = "Zoom out" if pair[1] > 1.0 else "Zoom in"
		zoom.pressed.connect(zoom_by.bind(float(pair[1])))
		modes.add_child(zoom)
	focus_button.text = "Focus selected"
	focus_button.tooltip_text = "Zoom to the selected room without travelling"
	focus_button.pressed.connect(focus_selected_room)
	modes.add_child(focus_button)
	status_label.add_theme_color_override("font_color", GOLD)
	status_label.add_theme_font_size_override("font_size", 12)
	content.add_child(status_label)
	var side := _panel(layer, Control.PRESET_RIGHT_WIDE, Vector4(-312, 130, -16, -130))
	var side_content := VBoxContainer.new()
	side_content.add_theme_constant_override("separation", 10)
	side.add_child(side_content)
	side_content.add_child(_small_label("ROOM INTELLIGENCE"))
	destination_filter.placeholder_text = "Find a room or room ID…"
	destination_filter.add_theme_font_size_override("font_size", 14)
	destination_filter.clear_button_enabled = true
	destination_filter.text_changed.connect(func(_text): _rebuild_destinations())
	side_content.add_child(destination_filter)
	destination_list.custom_minimum_size.y = 112
	destination_list.add_theme_font_size_override("font_size", 14)
	destination_list.allow_reselect = true
	destination_list.item_selected.connect(_destination_selected)
	destination_list.item_activated.connect(func(index):
		_destination_selected(index)
		focus_selected_room()
	)
	side_content.add_child(destination_list)
	destination_hint.add_theme_font_size_override("font_size", 11)
	destination_hint.add_theme_color_override("font_color", MUTED)
	destination_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	side_content.add_child(destination_hint)
	var scroll := information_scroll
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	side_content.add_child(scroll)
	var information := VBoxContainer.new()
	information.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	information.add_theme_constant_override("separation", 10)
	scroll.add_child(information)
	# Explicit selections get priority above the current-room background.
	selection_title.add_theme_font_size_override("font_size", 16)
	selection_title.add_theme_color_override("font_color", GOLD)
	selection_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	information.add_child(selection_title)
	travel_button.text = "Request travel here"
	travel_button.custom_minimum_size.y = 36
	travel_button.pressed.connect(request_selected_travel)
	information.add_child(travel_button)
	selection_description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	selection_description.add_theme_font_size_override("font_size", 13)
	information.add_child(selection_description)
	information.add_child(HSeparator.new())
	information.add_child(_small_label("CURRENT ROOM"))
	room_description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	room_description.add_theme_font_size_override("font_size", 13)
	room_description.add_theme_color_override("font_color", MUTED)
	information.add_child(room_description)
	details.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	information.add_child(details)
	information.add_child(HSeparator.new())
	information.add_child(_small_label("CONFIRMED EVENTS"))
	event_label.text = "Waiting for game events"
	event_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	event_label.add_theme_font_size_override("font_size", 12)
	event_label.add_theme_color_override("font_color", MUTED)
	information.add_child(event_label)
	var footer := _panel(layer, Control.PRESET_BOTTOM_WIDE, Vector4(16, -116, -16, -16))
	var footer_content := VBoxContainer.new()
	footer.add_child(footer_content)
	var exit_row := HBoxContainer.new()
	footer_content.add_child(exit_row)
	exit_row.add_child(_small_label("EXITS  "))
	var exit_scroll := ScrollContainer.new()
	exit_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	exit_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	exit_scroll.custom_minimum_size.y = 32
	exit_row.add_child(exit_scroll)
	exit_scroll.add_child(exits)
	mode_hint.add_theme_font_size_override("font_size", 11)
	mode_hint.add_theme_color_override("font_color", MUTED)
	footer_content.add_child(mode_hint)
	_update_selection()
	_update_mode_controls()

func render_snapshot(next: Dictionary) -> void:
	roundtime_started_ms = CombatPresentation.roundtime_clock_start(snapshot.get("player"), next.get("player"), roundtime_started_ms, Time.get_ticks_msec(), Time.get_unix_time_from_system() * 1000.0)
	snapshot = next.duplicate(true)
	_update_source_status()
	var moved := current_room != str(next.get("currentRoomId", ""))
	current_room = str(next.get("currentRoomId", ""))
	var cell := WorldManifestLoader.get_cell(current_room)
	var active: Dictionary = next.get("activeRoom", {})
	title_label.text = str(active.get("title", cell.get("title", "Waiting for your game")))
	if current_room.is_empty():
		title_label.text = "Waiting for your game"
	room_description.text = _description(active)
	if room_description.text.is_empty():
		room_description.text = _description(cell)
	if room_description.text.is_empty():
		room_description.text = "Waiting for confirmed room description."
	if moved:
		_clear_events()
		if selected_kind != "room" or selected_id == current_room:
			selected_kind = ""
			selected_id = ""
	if not _selection_exists():
		selected_kind = ""
		selected_id = ""
	_rebuild_board()
	_rebuild_details()
	_rebuild_destinations()
	_update_selection()
	if moved:
		set_view(view_mode)

func _description(cell: Dictionary) -> String:
	for key in ["description", "roomDescription"]:
		var value = cell.get(key)
		if value is String and not value.strip_edges().is_empty():
			return value.strip_edges()
	var content_value = cell.get("content")
	if content_value is Dictionary and content_value.get("description") is String:
		return str(content_value.description).strip_edges()
	return ""

func _point(cell: Dictionary) -> Vector3:
	var point: Dictionary = cell.get("position", {})
	return Vector3(float(point.get("x", 0)), float(point.get("y", 0)), float(point.get("z", 0)))

func _material(color: Color, glowing: bool = false) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.72
	if glowing:
		material.emission_enabled = true
		material.emission = color
		material.emission_energy_multiplier = 0.08
	return material

func _ground_kind(cell: Dictionary) -> String:
	return str(cell.get("content", {}).get("groundKind", cell.get("groundKind", "unknown")))

func _spatial_mode(cell: Dictionary) -> String:
	return str(cell.get("content", {}).get("spatialMode", cell.get("spatialMode", "")))

func _box(parent: Node3D, at: Vector3, size: Vector3, color: Color) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mesh.mesh = box
	mesh.material_override = _material(color)
	mesh.position = at
	parent.add_child(mesh)
	return mesh

func _label(parent: Node3D, at: Vector3, text: String, color: Color = Color.WHITE) -> Label3D:
	var label := Label3D.new()
	label.text = text
	label.position = at
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 24
	label.pixel_size = 0.008
	label.modulate = color
	label.outline_modulate = INK
	label.outline_size = 8
	label.no_depth_test = true
	parent.add_child(label)
	return label

func _ring(parent: Node3D, at: Vector3, radius: float, color: Color) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = radius - 0.025
	torus.outer_radius = radius + 0.025
	torus.rings = 32
	torus.ring_segments = 8
	node.mesh = torus
	node.material_override = _material(color, true)
	node.position = at
	parent.add_child(node)
	return node

func _pick_body(at: Vector3, size: Vector3, kind: String, id: String) -> void:
	var body := StaticBody3D.new()
	body.position = at
	body.set_meta("kind", kind)
	body.set_meta("id", id)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	geometry.add_child(body)
	pick_bodies["%s:%s" % [kind, id]] = body

func _visible_ids() -> Array:
	var policy := VisibilityPolicy.new()
	var ids: Array
	if view_mode == "world":
		ids = WorldManifestLoader.cells.keys()
	elif view_mode == "route":
		# Planning shows a broader known exit graph, never an invented path.
		ids = policy.detail_window(current_room, WorldManifestLoader.cells, 5).detailIds
		if selected_kind == "room" and WorldManifestLoader.has_cell(selected_id):
			for id in policy.detail_window(selected_id, WorldManifestLoader.cells, 1).detailIds:
				if not ids.has(id):
					ids.append(id)
	else:
		ids = policy.detail_window(current_room, WorldManifestLoader.cells).detailIds
	if ids.size() > 400:
		var origin := _point(WorldManifestLoader.get_cell(current_room))
		ids.sort_custom(func(a, b): return _point(WorldManifestLoader.get_cell(a)).distance_squared_to(origin) < _point(WorldManifestLoader.get_cell(b)).distance_squared_to(origin))
		ids = ids.slice(0, 400)
		if selected_kind == "room" and WorldManifestLoader.has_cell(selected_id) and not ids.has(selected_id):
			ids[-1] = selected_id
	return ids

func _rebuild_board() -> void:
	if not WorldManifestLoader.has_cell(current_room):
		_clear_geometry()
		board_signature = ""
		rendered_ids = []
		return
	var ids := _visible_ids()
	rendered_ids = ids
	var visible_cells: Array = []
	for id in ids:
		visible_cells.append(WorldManifestLoader.get_cell(id))
	var next_signature := JSON.stringify({"mode": view_mode, "demo": BridgeClient.mock_mode, "room": current_room, "cells": visible_cells, "entities": snapshot.get("entities", []), "items": snapshot.get("groundItems", [])})
	if next_signature == board_signature:
		return
	board_signature = next_signature
	_clear_geometry()
	var links := {}
	for id in ids:
		var cell := WorldManifestLoader.get_cell(id)
		var at := _point(cell)
		var footprint: Dictionary = cell.get("board", {}).get("footprint", {})
		var width := float(footprint.get("width", 4.4))
		var depth := float(footprint.get("depth", 4.4))
		var color: Color = TERRAIN.get(_ground_kind(cell), Color("7e735e"))
		# A continuous earth/stone surface on a dark presentation plinth.
		# No checkerboard or painted paths imply unsupported movement cells.
		var ground := MeshInstance3D.new()
		ground.mesh = diorama_art.surface(width, depth, _ground_kind(cell), id == current_room and view_mode == "room")
		ground.position = at
		ground.material_override = surface_art.terrain(_ground_kind(cell), color)
		geometry.add_child(ground)
		var earth := Color("3a3028") if _ground_kind(cell) in ["grass", "forest", "swamp", "farmland", "path"] else color.darkened(0.5)
		_box(geometry, at + Vector3(0, -0.15, 0), Vector3(width, 0.3, depth), earth)
		_box(geometry, at + Vector3(0, -0.36, 0), Vector3(width + 0.15, 0.14, depth + 0.15), Color("232a2c"))
		_box(geometry, at + Vector3(0, -0.47, 0), Vector3(width + 0.28, 0.08, depth + 0.28), Color("141e24"))
		if id == current_room:
			# Thin antique-metal trim belongs to the display base, not the room.
			_box(geometry, at + Vector3(0, -0.41, depth / 2 + 0.085), Vector3(width + 0.15, 0.018, 0.02), Color("817253"))
			_box(geometry, at + Vector3(width / 2 + 0.085, -0.41, 0), Vector3(0.02, 0.018, depth + 0.15), Color("817253"))
			if view_mode == "room":
				diorama_art.ground_details(geometry, at, width, depth, _ground_kind(cell), int(str(id).hash()))
		_pick_body(at + Vector3(0, -0.15, 0), Vector3(width, 0.4, depth), "room", id)
		if view_mode != "room":
			_overview_marker(at, str(id), GOLD if id == current_room else Color("8ab8cc"))
			var graph_label := Label.new()
			graph_label.text = "%s [%s]" % [_board_title(cell), id]
			graph_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
			graph_label.add_theme_font_size_override("font_size", 14)
			graph_label.add_theme_color_override("font_color", GOLD if id == current_room else Color("e3edf2"))
			graph_label.add_theme_color_override("font_shadow_color", INK)
			graph_label.add_theme_constant_override("shadow_offset_x", 1)
			graph_label.add_theme_constant_override("shadow_offset_y", 2)
			graph_overlay.add_child(graph_label)
			graph_label.resized.connect(_queue_overview_layout)
			graph_label.minimum_size_changed.connect(_queue_overview_layout)
			graph_labels[id] = graph_label
			overview_layout_pending = true
		if _spatial_mode(cell) == "interior-cutaway":
			_box(geometry, at + Vector3(0, 0.6, -depth / 2), Vector3(width, 1.2, 0.18), color.darkened(0.25))
		if view_mode == "room":
			continue
		for exit in cell.get("exits", []):
			var target = exit.get("targetCellId")
			if not target is String or not ids.has(target):
				continue
			var pair: Array = [str(id), target]
			pair.sort()
			var link_id := "|".join(pair)
			if links.has(link_id):
				continue
			links[link_id] = true
			_link(at, _point(WorldManifestLoader.get_cell(target)), GOLD.darkened(0.25) if id == current_room or target == current_room else Color("526f82"))
	var origin := _point(WorldManifestLoader.get_cell(current_room))
	_token(origin, "Preview position" if BridgeClient.mock_mode and not snapshot.get("source", {}).get("sample", false) else "You", GOLD, 0, "player", "player")
	var index := 1
	for entity in snapshot.get("entities", []):
		if str(entity.get("roomId", "")) == current_room and not str(entity.get("id", "")).is_empty():
			_token(origin, str(entity.get("name", "Unknown")), CombatPresentation.token_color(entity), index, "entity", str(entity.id), entity)
			index += 1
	var item_index := 0
	for item in snapshot.get("groundItems", []):
		if str(item.get("roomId", "")) != current_room or str(item.get("id", "")).is_empty():
			continue
		var at := origin + Vector3(-1.5 + float(item_index % 6) * 0.5, 0.16, 1.5 + float(item_index / 6) * 0.3)
		var item_mesh := MeshInstance3D.new()
		var marker := CylinderMesh.new()
		marker.top_radius = 0.18
		marker.bottom_radius = 0.2
		marker.height = 0.045
		marker.radial_segments = 8
		item_mesh.mesh = marker
		item_mesh.position = at - Vector3(0, 0.1, 0)
		item_mesh.material_override = _material(Color("82745d"))
		geometry.add_child(item_mesh)
		_ring(geometry, at - Vector3(0, 0.07, 0), 0.15, Color("af9870"))
		_pick_body(at, Vector3(0.4, 0.4, 0.4), "item", str(item.id))
		token_positions["item:" + str(item.id)] = at
		item_index += 1
	_update_selection_ring()

func _board_title(cell: Dictionary) -> String:
	var full := str(cell.get("title", cell.get("id", "Room")))
	var parts := full.split(",", false)
	var title := str(parts[-1]).strip_edges() if parts.size() > 1 else full
	return title if title.length() <= 28 else title.left(25) + "…"

func _clear_geometry() -> void:
	for label in graph_labels.values():
		graph_overlay.remove_child(label)
		label.queue_free()
	graph_labels.clear()
	overview_markers.clear()
	overview_pick_bodies.clear()
	overview_links.clear()
	selection_ring = null
	token_positions.clear()
	token_labels.clear()
	token_stands.clear()
	pick_bodies.clear()
	for child in geometry.get_children():
		child.free()

func _link(start: Vector3, end: Vector3, color: Color) -> void:
	if start.distance_to(end) < 0.01:
		return
	var line := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.035
	mesh.bottom_radius = 0.035
	mesh.height = start.distance_to(end)
	line.mesh = mesh
	line.material_override = _material(color)
	geometry.add_child(line)
	line.position = (start + end) / 2.0 - Vector3(0, 0.18, 0)
	line.quaternion = Quaternion(Vector3.UP, (end - start).normalized())
	overview_links.append(line)

func _token(origin: Vector3, text: String, color: Color, index: int, kind: String, id: String, entity: Dictionary = {}) -> void:
	var at := origin
	if index > 0:
		var angle := float(index) * 2.4
		at += Vector3(cos(angle), 0, sin(angle)) * (1.0 + float(index / 6) * 0.55)
	# Upright illustration/sigil stands are deliberately representative tokens.
	# Only the opt-in demo may display the sample portrait assets.
	var muted := color.lerp(Color("737b79"), 0.52)
	_box(geometry, at + Vector3(0, 0.08, 0), Vector3(0.7, 0.13, 0.36), Color("242e33"))
	var stand := Node3D.new()
	stand.position = at + Vector3(0, 0.77, 0)
	stand.rotation.y = atan2(camera.position.x - at.x, camera.position.z - at.z)
	geometry.add_child(stand)
	token_stands.append(stand)
	_box(stand, Vector3.ZERO, Vector3(0.77, 1.22, 0.075), Color("74684e") if kind == "player" else Color("384247"))
	var card := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(0.7, 1.14)
	card.mesh = quad
	card.position.z = 0.045
	var material := StandardMaterial3D.new()
	material.albedo_texture = diorama_art.marker_texture(id, BridgeClient.mock_mode, kind == "player")
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.roughness = 1.0
	card.material_override = material
	stand.add_child(card)
	_box(stand, Vector3(0, -0.57, 0.055), Vector3(0.7, 0.042, 0.015), muted)
	if kind == "entity":
		_box(stand, Vector3(0.3, -0.51, 0.065), Vector3(0.055, 0.055, 0.018), CombatPresentation.assessment_color(CombatPresentation.assessment_state(entity)))
	token_positions["%s:%s" % [kind, id]] = at
	_pick_body(at + Vector3(0, 0.77, 0), Vector3(0.8, 1.3, 0.8), kind, id)
	if view_mode == "room":
		var name_label := _label(geometry, at + Vector3(0, 1.57, 0), text, color.lightened(0.2))
		name_label.visible = kind == "player"
		token_labels["%s:%s" % [kind, id]] = name_label

func _rebuild_details() -> void:
	_update_player_summary()
	var next_signature := JSON.stringify({"room": current_room, "exits": WorldManifestLoader.true_exits(current_room), "entities": snapshot.get("entities", []), "items": snapshot.get("groundItems", [])})
	if next_signature == inspector_signature:
		_update_action_availability()
		return
	inspector_signature = next_signature
	for child in details.get_children():
		if child == player_summary:
			details.remove_child(child)
		else:
			details.remove_child(child)
			child.queue_free()
	for child in exits.get_children():
		# Mock requests can synchronously publish during this button's pressed
		# signal. Detach now, but never free a still-emitting Control.
		exits.remove_child(child)
		child.queue_free()
	details.add_child(player_summary)
	player_summary.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	player_summary.add_theme_font_size_override("font_size", 13)
	_update_player_summary()
	for key in ["entities", "groundItems"]:
		for entry in snapshot.get(key, []):
			if str(entry.get("roomId", "")) != current_room or str(entry.get("id", "")).is_empty():
				continue
			var button := Button.new()
			button.text = str(entry.get("name", "Unknown"))
			button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
			button.custom_minimum_size.y = 30
			button.tooltip_text = CombatPresentation.tactical_tooltip(entry) if key == "entities" else "Inspect %s" % button.text
			button.pressed.connect(select_visible_target.bind("entity" if key == "entities" else "item", str(entry.id)))
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
		button.custom_minimum_size = Vector2(70, 30)
		button.pressed.connect(request_visible_exit.bind(current_room, move))
		exits.add_child(button)
	_update_action_availability()

func request_visible_exit(from_room: String, move: String) -> bool:
	if not _actions_available() or from_room != current_room or not WorldManifestLoader.is_true_exit(from_room, move):
		return false
	return IntentSender.request_walk(from_room, move)

func _entry(kind: String, id: String) -> Dictionary:
	var key := "entities" if kind == "entity" else "groundItems"
	for entry in snapshot.get(key, []):
		if str(entry.get("id", "")) == id and str(entry.get("roomId", "")) == current_room:
			return entry
	return {}

func _selection_exists() -> bool:
	if selected_kind.is_empty():
		return true
	if selected_kind == "room":
		return WorldManifestLoader.has_cell(selected_id)
	if selected_kind == "player":
		return WorldManifestLoader.has_cell(current_room)
	return not _entry(selected_kind, selected_id).is_empty()

## Shared by mouse picking and accessible inspector buttons. Selection alone
## never walks; entity/item inspection is read-only and revalidated by sender.
func select_visible_target(kind: String, id: String) -> bool:
	if kind == "room":
		if not rendered_ids.has(id) or not WorldManifestLoader.has_cell(id):
			return false
	elif kind == "entity" or kind == "item":
		if _entry(kind, id).is_empty():
			return false
	elif kind == "player":
		if id != "player" or not WorldManifestLoader.has_cell(current_room):
			return false
	else:
		return false
	selected_kind = kind
	selected_id = id
	if kind == "entity" and _actions_available():
		IntentSender.request_inspect_entity(id)
	elif kind == "item" and _actions_available():
		IntentSender.request_inspect_ground_item(id)
	if view_mode == "route" and kind == "room":
		_rebuild_board()
	_update_selection()
	_reveal_selection()
	return true

func _reveal_selection() -> void:
	# Only direct user selection scrolls. Health/status-only publishes leave
	# the reader's scroll position and the separate search/list unchanged.
	information_scroll.set_deferred("scroll_vertical", 0)

func clear_selection() -> void:
	selected_kind = ""
	selected_id = ""
	_update_selection()

func can_request_selected_travel() -> bool:
	return _actions_available() and not BridgeClient.mock_mode and selected_kind == "room" and selected_id != current_room and WorldManifestLoader.has_cell(current_room) and WorldManifestLoader.has_cell(selected_id) and rendered_ids.has(selected_id)

func request_selected_travel() -> bool:
	if not can_request_selected_travel():
		return false
	status_label.text = "Travel requested • waiting for the game to confirm movement"
	return IntentSender.request_travel_to_room(selected_id)

func _update_selection() -> void:
	focus_button.disabled = selected_kind != "room" or not WorldManifestLoader.has_cell(selected_id)
	travel_button.visible = selected_kind == "room" and selected_id != current_room and rendered_ids.has(selected_id)
	if selected_kind.is_empty():
		selection_title.text = "Select something to inspect"
		selection_description.text = "Click a room, person, or item on the board. Selecting a room does not move you."
	elif selected_kind == "room":
		var cell := WorldManifestLoader.get_cell(selected_id)
		selection_title.text = str(cell.get("title", selected_id))
		var exit_count := WorldManifestLoader.true_exits(selected_id).size()
		selection_description.text = "%s • %d known exits\n%s" % [selected_id, exit_count, _description(cell)]
		if selected_id == current_room:
			selection_description.text += "\nYour confirmed location."
		elif not rendered_ids.has(selected_id):
			selection_description.text += "\nOutside this view. Switch to Route or World to see this destination."
		elif BridgeClient.mock_mode:
			selection_description.text += "\nTravel needs a live connection. Demo exits can be explored below."
		else:
			selection_description.text += "\nLich checks the route and travel rules. No route has been confirmed here."
	elif selected_kind == "player":
		selection_title.text = "Your confirmed character"
		var player: Dictionary = CombatPresentation.player_view(snapshot.get("player"))
		selection_description.text = "%s\n%s\n%s" % [player.state, player.healthText, ", ".join(player.flags)]
	else:
		var entry := _entry(selected_kind, selected_id)
		selection_title.text = str(entry.get("name", "Unknown"))
		selection_description.text = CombatPresentation.tactical_tooltip(entry) if selected_kind == "entity" else "Confirmed on the floor in %s.\nInspection is read-only." % current_room
	_update_action_availability()
	_update_selection_ring()
	_update_token_labels()
	_update_overview()

func _update_token_labels() -> void:
	# The inspector always lists every confirmed name. On the physical board,
	# label only the selected pawn (or You) so nearby names cannot collide.
	var selected_key := "%s:%s" % [selected_kind, selected_id]
	var visible_key := selected_key if selected_kind == "entity" and token_labels.has(selected_key) else "player:player"
	for key in token_labels:
		token_labels[key].visible = key == visible_key

func _update_selection_ring() -> void:
	if is_instance_valid(selection_ring):
		selection_ring.free()
	selection_ring = null
	if selected_kind == "room" and rendered_ids.has(selected_id):
		var cell := WorldManifestLoader.get_cell(selected_id)
		var width := float(cell.get("board", {}).get("footprint", {}).get("width", 4.4))
		selection_ring = _ring(geometry, _point(cell) + Vector3(0, 0.08, 0), width * 0.53, Color("91deed"))

	elif token_positions.has("%s:%s" % [selected_kind, selected_id]):
		selection_ring = _ring(geometry, token_positions["%s:%s" % [selected_kind, selected_id]] + Vector3(0, 0.23, 0), 0.42, Color("91deed"))

func pick_at(screen_position: Vector2) -> bool:
	var origin := camera.project_ray_origin(screen_position)
	var end := origin + camera.project_ray_normal(screen_position) * camera.far
	var query := PhysicsRayQueryParameters3D.create(origin, end)
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		clear_selection()
		return false
	var body: Object = hit.collider
	if not body.has_meta("kind") or not body.has_meta("id"):
		return false
	return select_visible_target(str(body.get_meta("kind")), str(body.get_meta("id")))

func set_view(mode: String) -> void:
	if not mode in ["world", "route", "room"]:
		return
	view_mode = mode
	focus = _point(WorldManifestLoader.get_cell(current_room))
	camera_size = 8.7 if mode == "room" else 42.0 if mode == "route" else 140.0
	_rebuild_board()
	if mode != "room" and not rendered_ids.is_empty():
		var low := _point(WorldManifestLoader.get_cell(rendered_ids[0]))
		var high := low
		for id in rendered_ids:
			var at := _point(WorldManifestLoader.get_cell(id))
			low = low.min(at)
			high = high.max(at)
		focus = (low + high) / 2.0
		camera_size = maxf(24.0, (high - low).length() * 1.25 + 12.0)
	_update_selection()
	_rebuild_destinations()
	_update_mode_controls()
	_update_camera()

func _update_mode_controls() -> void:
	for control in [destination_filter, destination_list, destination_hint]:
		control.visible = view_mode != "room"
	for mode in mode_buttons:
		mode_buttons[mode].set_pressed_no_signal(mode == view_mode)
	var hint := "Click to inspect • Wheel zoom • Right drag orbit • Middle drag pan • 1/2/3 views • Esc clear"
	if view_mode == "route":
		hint = "Route graph • Lines are known exits, not a confirmed route • Search or select a room, then Focus selected • Travel uses Lich"
	elif view_mode == "world":
		hint = "World graph • %d of %d rooms drawn • Search rooms to resolve overlapping nodes • Double-click a list row to focus" % [rendered_ids.size(), WorldManifestLoader.cells.size()]
	mode_hint.text = hint

func _update_camera() -> void:
	camera.size = camera_size
	camera.position = focus + Vector3(cos(yaw), 1.25, sin(yaw)) * 200.0
	camera.look_at(focus)
	# Leave visual breathing room for the inspector without changing board truth.
	camera.h_offset = camera_size * 0.19
	for stand in token_stands:
		stand.rotation.y = atan2(camera.position.x - stand.position.x, camera.position.z - stand.position.z)
	_update_overview()

func zoom_by(factor: float) -> void:
	camera_size = clampf(camera_size * factor, 6.0, 10000.0)
	_update_camera()

func focus_selected_room() -> bool:
	if selected_kind != "room" or not WorldManifestLoader.has_cell(selected_id):
		return false
	focus = _point(WorldManifestLoader.get_cell(selected_id))
	camera_size = 14.0
	_update_camera()
	return true

func _rebuild_destinations() -> void:
	var query := destination_filter.text.strip_edges().to_lower()
	var rooms: Array = []
	for id in WorldManifestLoader.cells:
		rooms.append([id, WorldManifestLoader.get_cell(id).get("title", id)])
	var signature := JSON.stringify([view_mode != "room", query, rooms])
	if signature == destination_signature:
		return
	destination_signature = signature
	destination_list.clear()
	if view_mode == "room":
		return
	var matching := 0
	for id in WorldManifestLoader.cells:
		var cell := WorldManifestLoader.get_cell(id)
		var title := str(cell.get("title", id))
		if not query.is_empty() and not (title + " " + str(id)).to_lower().contains(query):
			continue
		matching += 1
		if destination_list.item_count >= 200:
			continue
		var index := destination_list.add_item("%s  · %s" % [_board_title(cell), id])
		destination_list.set_item_metadata(index, id)
		destination_list.set_item_tooltip(index, "%s [%s]\nSelect to inspect; double-click to focus. No movement." % [title, id])
		if selected_kind == "room" and selected_id == id:
			destination_list.select(index)
	destination_hint.text = "%d matching rooms • Double-click to focus" % matching if matching <= 200 else "First 200 of %d matches • Narrow your search" % matching

func _destination_selected(index: int) -> void:
	if index < 0 or index >= destination_list.item_count:
		return
	var id := str(destination_list.get_item_metadata(index))
	if not WorldManifestLoader.has_cell(id):
		return
	# The searchable list can reach known rooms outside the geometry budget.
	# Selection mounts that room; only the explicit travel button sends intent.
	selected_kind = "room"
	selected_id = id
	_rebuild_board()
	_update_selection()
	_reveal_selection()
	_update_mode_controls()

func _overview_marker(at: Vector3, id: String, color: Color) -> void:
	var marker := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.5
	sphere.height = 1.0
	sphere.radial_segments = 16
	sphere.rings = 8
	marker.mesh = sphere
	marker.material_override = _material(color, true)
	marker.material_override.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	marker.position = at + Vector3(0, 0.55, 0)
	geometry.add_child(marker)
	overview_markers[id] = marker
	var body := StaticBody3D.new()
	body.position = marker.position
	body.set_meta("kind", "room")
	body.set_meta("id", id)
	var collision := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = 0.5
	collision.shape = shape
	body.add_child(collision)
	geometry.add_child(body)
	overview_pick_bodies[id] = body

func _queue_overview_layout() -> void:
	overview_layout_pending = true

func _update_overview() -> void:
	if view_mode == "room" or overview_markers.is_empty():
		return
	var canvas := get_viewport().get_visible_rect().size
	var units_per_pixel := camera_size / maxf(1.0, canvas.y)
	var diameter := maxf(0.5, units_per_pixel * 20.0)
	for id in overview_markers:
		var marker: MeshInstance3D = overview_markers[id]
		marker.scale = Vector3.ONE * diameter
		var body: StaticBody3D = overview_pick_bodies[id]
		body.get_child(0).shape.radius = diameter * 0.65
		marker.material_override.albedo_color = Color("91deed") if selected_kind == "room" and id == selected_id else GOLD if id == current_room else Color("8ab8cc")
	for line in overview_links:
		var thickness := maxf(1.0, units_per_pixel * 0.75 / 0.035)
		line.scale = Vector3(thickness, 1.0, thickness)
	var order := graph_labels.keys()
	order.sort_custom(func(a, b):
		var rank_a := 0 if a == selected_id else 1 if a == current_room else 2
		var rank_b := 0 if b == selected_id else 1 if b == current_room else 2
		return rank_a < rank_b if rank_a != rank_b else str(a) < str(b)
	)
	var placed: Array[Rect2] = []
	var node_bounds: Dictionary = {}
	for id in overview_markers:
		var screen := camera.unproject_position(overview_markers[id].position)
		var radius := diameter / units_per_pixel * 0.5 + 2.0
		node_bounds[id] = Rect2(screen - Vector2.ONE * radius, Vector2.ONE * radius * 2.0)
	var safe := Rect2(20, 132, maxf(1, canvas.x - 352), maxf(1, canvas.y - 270))
	for id in order:
		var label: Label = graph_labels[id]
		label.visible = false
		var screen := camera.unproject_position(overview_markers[id].position)
		# Labels added this frame may not have shaped yet. Measure the same
		# font explicitly and honor final minimum/actual size after layout.
		var font := label.get_theme_font("font")
		var font_size := label.get_theme_font_size("font_size")
		var measured := Vector2(ceilf(font.get_string_size(label.text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x), ceilf(font.get_height(font_size)))
		var size := measured.max(label.get_combined_minimum_size()).max(label.size)
		label.size = size
		for offset in [Vector2(15, -size.y / 2), Vector2(-size.x - 15, -size.y / 2), Vector2(-size.x / 2, -size.y - 15), Vector2(-size.x / 2, 15)]:
			var rect := Rect2(screen + offset, size)
			if not safe.encloses(rect):
				continue
			var overlaps := false
			for other in placed:
				if rect.grow(4).intersects(other):
					overlaps = true
					break
			if not overlaps:
				for other_id in node_bounds:
					if other_id != id and rect.intersects(node_bounds[other_id]):
						overlaps = true
						break
			if overlaps:
				continue
			label.position = rect.position
			label.visible = true
			placed.append(rect)
			break

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			pick_at(event.position)
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom_by(0.88)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom_by(1.0 / 0.88)
	if event is InputEventMouseMotion:
		if event.button_mask & MOUSE_BUTTON_MASK_RIGHT:
			yaw -= event.relative.x * 0.008
		elif event.button_mask & MOUSE_BUTTON_MASK_MIDDLE:
			focus -= camera.global_basis.x * event.relative.x * camera_size / maxf(1, get_viewport().get_visible_rect().size.y)
			focus += Vector3(sin(yaw), 0, -cos(yaw)) * event.relative.y * camera_size / maxf(1, get_viewport().get_visible_rect().size.y)
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_1: set_view("world")
			KEY_2: set_view("route")
			KEY_3: set_view("room")
			KEY_R: set_view(view_mode)
			KEY_ESCAPE: clear_selection()
	_update_camera()

## Only the sequencer may deliver effects. Event text is shown verbatim; these
## cues never subtract health, move a token, infer damage, or add an occupant.
func _event_played(event: Dictionary) -> void:
	if str(event.get("roomId", "")) != current_room:
		return
	event_history.append(event.duplicate(true))
	if event_history.size() > 6:
		event_history.pop_front()
	var lines: Array[String] = []
	for fact in event_history:
		var text := str(fact.get("authoritativeText", "")).strip_edges()
		lines.append("%s  %s" % [str(fact.get("kind", "event")).to_upper(), text])
	event_label.text = "\n\n".join(lines)
	pending_effects.append(event.duplicate(true))
	# Bound visual backlog in bursts; the latest confirmed text remains above.
	if pending_effects.size() > 32:
		pending_effects.pop_front()

func _clear_events() -> void:
	event_history.clear()
	pending_effects.clear()
	effect_wait = 0.0
	last_effect_sequence = 0
	event_label.text = "Waiting for game events"
	for child in effects.get_children():
		child.queue_free()

func _play_effect(event: Dictionary) -> void:
	last_effect_sequence = int(event.get("sequence", 0))
	var at := _point(WorldManifestLoader.get_cell(current_room))
	var kind := str(event.get("kind", "event"))
	var entity_id := str(event.get("targetEntityId", "")) if kind in ["hit", "death", "status-change"] else str(event.get("sourceEntityId", ""))
	if token_positions.has("entity:" + entity_id):
		at = token_positions["entity:" + entity_id]
	var color := Color("ed947f") if kind in ["hit", "death"] else Color("a9dcef") if kind in ["block", "parry", "evade", "miss"] else GOLD
	var pulse := _ring(effects, at + Vector3(0, 0.25, 0), 0.45, color)
	var label := _label(effects, at + Vector3(0, 1.7, 0), kind.to_upper(), color)
	var tween := create_tween().set_parallel(true)
	tween.tween_property(pulse, "scale", Vector3(2.2, 1.0, 2.2), 0.65).set_trans(Tween.TRANS_SINE)
	tween.tween_property(label, "position:y", label.position.y + 0.45, 0.65)
	tween.tween_property(label, "modulate:a", 0.0, 0.65)
	tween.chain().tween_callback(func():
		if is_instance_valid(pulse): pulse.queue_free()
		if is_instance_valid(label): label.queue_free()
	)

func _process(delta: float) -> void:
	if overview_layout_pending:
		overview_layout_pending = false
		_update_overview()
	_update_player_summary()
	effect_wait = maxf(0.0, effect_wait - delta)
	if effect_wait <= 0.0 and not pending_effects.is_empty():
		_play_effect(pending_effects.pop_front())
		effect_wait = 0.48

func _update_player_summary() -> void:
	var player: Dictionary = CombatPresentation.player_view(snapshot.get("player"))
	var state: String = player.state
	if state == "ROUND TIME":
		var remaining := maxf(0.0, float(player.roundtime) - float(Time.get_ticks_msec() - roundtime_started_ms) / 1000.0)
		state = "ROUND TIME %.1fs" % remaining if remaining > 0.0 else "READY"
	player_summary.text = "%s • %s" % [state, player.healthText]
	player_summary.add_theme_color_override("font_color", Color("ed8b7f") if state == "CANNOT ACT" else Color("99d7ae") if state == "READY" else MUTED if not player.known else GOLD)

func _exit_tree() -> void:
	if not player_summary.is_inside_tree():
		player_summary.free()
