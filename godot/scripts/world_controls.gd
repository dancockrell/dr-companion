extends CanvasLayer
## Reachable controls for the one continuous viewer.
##
## These controls change only presentation framing. They never send a walk
## intent, alter the confirmed room, or create a second map surface. Buttons
## and 1/2/3 keyboard shortcuts expose the same three camera modes.

signal view_requested(view_id: String)

@onready var world_button: Button = $Margin/Views/World
@onready var route_button: Button = $Margin/Views/Route
@onready var room_button: Button = $Margin/Views/Room

func _ready() -> void:
	world_button.pressed.connect(_activate.bind("world"))
	route_button.pressed.connect(_activate.bind("route"))
	room_button.pressed.connect(_activate.bind("room"))

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
