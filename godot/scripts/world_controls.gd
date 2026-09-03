extends CanvasLayer
## Reachable controls for the one continuous viewer.
##
## These controls change only presentation framing. They never send a walk
## intent, alter the confirmed room, or create a second map surface. Buttons
## and 1/2/3 keyboard shortcuts expose the same three camera modes.

signal view_requested(view_id: String)
signal exit_requested(from_room_id: String, exit_move: String)

@onready var world_button: Button = $Margin/Views/World
@onready var route_button: Button = $Margin/Views/Route
@onready var room_button: Button = $Margin/Views/Room
@onready var exit_list: VBoxContainer = $ExitPanel/Content/ExitScroll/ExitList

var _exit_room_id := ""
var _visible_exit_moves: Dictionary = {}

func _ready() -> void:
	world_button.pressed.connect(_activate.bind("world"))
	route_button.pressed.connect(_activate.bind("route"))
	room_button.pressed.connect(_activate.bind("room"))
	_rebuild_exit_buttons()

func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_1: _activate("world")
		KEY_2: _activate("route")
		KEY_3: _activate("room")

func _activate(view_id: String) -> void:
	if view_id in ["world", "route", "room"]:
		view_requested.emit(view_id)

## Replaces the accessible exit model from the same true-exit array used by
## the 3D markers. Blank and duplicate move strings are never presented.
func render_exits(room_id: String, exits: Array) -> void:
	_exit_room_id = room_id
	_visible_exit_moves.clear()
	for exit in exits:
		var move := str(exit.get("move", "")).strip_edges()
		if not move.is_empty():
			_visible_exit_moves[move] = true
	if is_node_ready():
		_rebuild_exit_buttons()

## Public seam shared by generated buttons and the headless contract test.
## The room and exact move must still belong to the currently rendered model.
func request_visible_exit(from_room_id: String, exit_move: String) -> bool:
	if from_room_id != _exit_room_id or not _visible_exit_moves.has(exit_move):
		return false
	exit_requested.emit(from_room_id, exit_move)
	return true

func _rebuild_exit_buttons() -> void:
	for child in exit_list.get_children():
		child.free()
	for move in _visible_exit_moves.keys():
		var button := Button.new()
		button.text = move
		button.tooltip_text = "Use confirmed exit: %s" % move
		button.focus_mode = Control.FOCUS_ALL
		button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		button.pressed.connect(request_visible_exit.bind(_exit_room_id, move))
		exit_list.add_child(button)
