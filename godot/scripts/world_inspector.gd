extends CanvasLayer
## One compact, collapsible text equivalent for the current room's 3D tokens.
## It mirrors confirmed snapshot data and never creates lore, occupants, items,
## or commands of its own.

signal inspect_entity_requested(entity_id: String)
signal inspect_ground_item_requested(item_id: String)

const CombatPresentation := preload("res://scripts/combat_presentation.gd")

@onready var panel: PanelContainer = $Panel
@onready var collapse_button: Button = $Panel/Content/Header/Collapse
@onready var room_title: Label = $Panel/Content/RoomTitle
@onready var room_id_label: Label = $Panel/Content/RoomId
@onready var player_state: Label = $Panel/Content/PlayerStatus/State
@onready var player_health: ProgressBar = $Panel/Content/PlayerStatus/Health
@onready var player_health_text: Label = $Panel/Content/PlayerStatus/HealthText
@onready var player_flags: Label = $Panel/Content/PlayerFlags
@onready var entity_list: VBoxContainer = $Panel/Content/Scroll/Lists/Entities
@onready var item_list: VBoxContainer = $Panel/Content/Scroll/Lists/Items

var _current_room_id := ""
var _current_title := "Location unresolved"
var _visible_entities: Dictionary = {}
var _visible_items: Dictionary = {}
var _player_view: Dictionary = CombatPresentation.player_view(null)
var _roundtime_started_ms := 0

func _ready() -> void:
	collapse_button.pressed.connect(_toggle_collapsed)
	_rebuild()

func render_snapshot(snapshot: Dictionary) -> void:
	_current_room_id = str(snapshot.get("currentRoomId", ""))
	var active_room: Dictionary = snapshot.get("activeRoom", {})
	_current_title = str(active_room.get("title", "")).strip_edges()
	if _current_title.is_empty():
		_current_title = "Location unresolved"
	_visible_entities = _collect_current(snapshot.get("entities", []))
	_visible_items = _collect_current(snapshot.get("groundItems", []))
	_player_view = CombatPresentation.player_view(snapshot.get("player"))
	_roundtime_started_ms = Time.get_ticks_msec()
	set_process(_player_view.get("roundtime") != null and float(_player_view.get("roundtime")) > 0.0)
	if is_node_ready():
		_rebuild()

func request_visible_entity(entity_id: String) -> bool:
	if not _visible_entities.has(entity_id):
		return false
	inspect_entity_requested.emit(entity_id)
	return true

func request_visible_item(item_id: String) -> bool:
	if not _visible_items.has(item_id):
		return false
	inspect_ground_item_requested.emit(item_id)
	return true

func visible_entity_ids() -> Array:
	return _visible_entities.keys()

func visible_item_ids() -> Array:
	return _visible_items.keys()

func player_view() -> Dictionary:
	return _player_view.duplicate(true)

func entity_summary(entity_id: String) -> String:
	var entity: Dictionary = _visible_entities.get(entity_id, {})
	return CombatPresentation.tactical_summary(entity) if not entity.is_empty() else ""

func entity_tooltip(entity_id: String) -> String:
	var entity: Dictionary = _visible_entities.get(entity_id, {})
	return CombatPresentation.tactical_tooltip(entity) if not entity.is_empty() else ""

func _collect_current(entries: Array) -> Dictionary:
	var visible := {}
	for entry in entries:
		if not entry is Dictionary or str(entry.get("roomId", "")) != _current_room_id:
			continue
		var stable_id := str(entry.get("id", "")).strip_edges()
		if stable_id.is_empty():
			continue
		visible[stable_id] = entry.duplicate(true)
	return visible

func _rebuild() -> void:
	room_title.text = _current_title
	room_id_label.text = _current_room_id if not _current_room_id.is_empty() else "No confirmed room"
	_update_player_status()
	_rebuild_list(entity_list, _visible_entities, request_visible_entity, "No one confirmed here", true)
	_rebuild_list(item_list, _visible_items, request_visible_item, "No items confirmed here", false)

func _rebuild_list(container: VBoxContainer, entries: Dictionary, request: Callable, empty_text: String, entities: bool) -> void:
	for child in container.get_children():
		child.free()
	if entries.is_empty():
		var empty := Label.new()
		empty.text = empty_text
		container.add_child(empty)
		return
	for stable_id in entries.keys():
		var entry: Dictionary = entries[stable_id]
		var name := str(entry.get("name", "")).strip_edges()
		if name.is_empty():
			name = "Unknown"
		var row := HBoxContainer.new()
		row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var button := Button.new()
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.text = "%s\n%s" % [name, CombatPresentation.tactical_summary(entry)] if entities else name
		button.tooltip_text = CombatPresentation.tactical_tooltip(entry) if entities else "Inspect %s" % name
		button.focus_mode = Control.FOCUS_ALL
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.pressed.connect(request.bind(stable_id))
		row.add_child(button)
		var wiki := LinkButton.new()
		wiki.text = "Wiki"
		wiki.tooltip_text = "Search Elanthipedia for %s" % name
		wiki.focus_mode = Control.FOCUS_ALL
		wiki.pressed.connect(_open_wiki.bind(CombatPresentation.elanthipedia_search_url(name)))
		row.add_child(wiki)
		container.add_child(row)

func _open_wiki(url: String) -> void:
	if url.begins_with(CombatPresentation.ELANTHIPEDIA_SEARCH):
		OS.shell_open(url)

func _process(_delta: float) -> void:
	_update_player_status()

func _update_player_status() -> void:
	if not is_node_ready():
		return
	player_state.text = str(_player_view.get("state", "PLAYER STATE UNKNOWN"))
	player_health.visible = bool(_player_view.get("healthKnown", false))
	player_health.value = float(_player_view.get("healthPercent", 0.0))
	player_health_text.text = str(_player_view.get("healthText", "Health not received"))
	var flags: Array = _player_view.get("flags", [])
	player_flags.text = "Status: %s" % ", ".join(flags) if not flags.is_empty() else "No status flags reported"
	var initial_roundtime = _player_view.get("roundtime")
	if initial_roundtime == null:
		return
	var elapsed := float(Time.get_ticks_msec() - _roundtime_started_ms) / 1000.0
	var remaining := maxf(0.0, float(initial_roundtime) - elapsed)
	if remaining > 0.0 and not bool(_player_view.get("state") == "CANNOT ACT"):
		player_state.text = "ROUND TIME %.1fs" % remaining
	elif remaining <= 0.0:
		set_process(false)
		if not bool(_player_view.get("state") == "CANNOT ACT"):
			player_state.text = "READY"
	match player_state.text:
		"CANNOT ACT": player_state.add_theme_color_override("font_color", Color(1.0, 0.34, 0.28))
		"READY": player_state.add_theme_color_override("font_color", Color(0.34, 0.88, 0.58))
		_:
			var active_roundtime := initial_roundtime != null and float(initial_roundtime) > 0.0
			player_state.add_theme_color_override("font_color", Color(1.0, 0.76, 0.28) if active_roundtime else Color(0.65, 0.65, 0.68))

func _toggle_collapsed() -> void:
	var show_content: bool = not room_title.visible
	for child in $Panel/Content.get_children():
		if child.name != "Header":
			child.visible = show_content
	panel.offset_bottom = 392.0 if show_content else 58.0
	collapse_button.text = "Hide" if show_content else "Show"
	collapse_button.tooltip_text = "Hide current-room inspector" if show_content else "Show current-room inspector"
