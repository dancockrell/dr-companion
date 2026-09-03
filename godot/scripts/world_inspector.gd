extends CanvasLayer
## One compact, collapsible text equivalent for the current room's 3D tokens.
## It mirrors confirmed snapshot data and never creates lore, occupants, items,
## or commands of its own.

signal inspect_entity_requested(entity_id: String)
signal inspect_ground_item_requested(item_id: String)

@onready var panel: PanelContainer = $Panel
@onready var collapse_button: Button = $Panel/Content/Header/Collapse
@onready var room_title: Label = $Panel/Content/RoomTitle
@onready var room_id_label: Label = $Panel/Content/RoomId
@onready var entity_list: VBoxContainer = $Panel/Content/Scroll/Lists/Entities
@onready var item_list: VBoxContainer = $Panel/Content/Scroll/Lists/Items

var _current_room_id := ""
var _current_title := "Location unresolved"
var _visible_entities: Dictionary = {}
var _visible_items: Dictionary = {}

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

func _collect_current(entries: Array) -> Dictionary:
	var visible := {}
	for entry in entries:
		if not entry is Dictionary or str(entry.get("roomId", "")) != _current_room_id:
			continue
		var stable_id := str(entry.get("id", "")).strip_edges()
		if stable_id.is_empty():
			continue
		var label := str(entry.get("name", "")).strip_edges()
		visible[stable_id] = label if not label.is_empty() else "Unknown"
	return visible

func _rebuild() -> void:
	room_title.text = _current_title
	room_id_label.text = _current_room_id if not _current_room_id.is_empty() else "No confirmed room"
	_rebuild_list(entity_list, _visible_entities, request_visible_entity, "No one confirmed here")
	_rebuild_list(item_list, _visible_items, request_visible_item, "No items confirmed here")

func _rebuild_list(container: VBoxContainer, entries: Dictionary, request: Callable, empty_text: String) -> void:
	for child in container.get_children():
		child.free()
	if entries.is_empty():
		var empty := Label.new()
		empty.text = empty_text
		container.add_child(empty)
		return
	for stable_id in entries.keys():
		var button := Button.new()
		button.text = entries[stable_id]
		button.tooltip_text = "Inspect %s" % entries[stable_id]
		button.focus_mode = Control.FOCUS_ALL
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.pressed.connect(request.bind(stable_id))
		container.add_child(button)

func _toggle_collapsed() -> void:
	var show_content: bool = not room_title.visible
	for child in $Panel/Content.get_children():
		if child.name != "Header":
			child.visible = show_content
	panel.offset_bottom = 392.0 if show_content else 58.0
	collapse_button.text = "Hide" if show_content else "Show"
	collapse_button.tooltip_text = "Hide current-room inspector" if show_content else "Show current-room inspector"
