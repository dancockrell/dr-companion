extends Node3D
## Labeled, clickable presentation anchors for exact manifest exits.
##
## An anchor is a request affordance, not a route predictor. It is made only
## from a real current-room exit, emits the exact move text, and is positioned
## toward a loaded target cell when one is known. External exits retain their
## real command label but never receive a fabricated destination direction.

signal exit_requested(from_room_id: String, exit_move: String)

var _current_room_id := ""
var _visible_moves: Dictionary = {}
var _position_states: Dictionary = {}

func render_exits(room_id: String, cells: Dictionary) -> void:
	_clear()
	_current_room_id = room_id
	if room_id.is_empty() or not cells.has(room_id):
		return
	var source: Dictionary = cells[room_id]
	var base := _cell_position(source)
	var exits: Array = source.get("exits", [])
	for index in range(exits.size()):
		var exit: Dictionary = exits[index]
		var move := str(exit.get("move", ""))
		if move.is_empty():
			continue
		var anchor := Node3D.new()
		anchor.name = "Exit_%s" % move
		var placement := _anchor_placement(exit, index, cells)
		anchor.position = base + placement["offset"]
		anchor.set_meta("move", move)
		anchor.set_meta("fromRoomId", room_id)
		anchor.set_meta("positionState", placement["state"])
		add_child(anchor)
		_visible_moves[move] = true
		_position_states[move] = placement["state"]
		_add_visuals(anchor, move, placement["state"] == "resolved")

func request_exit(from_room_id: String, exit_move: String) -> bool:
	if from_room_id != _current_room_id or not _visible_moves.has(exit_move):
		return false
	exit_requested.emit(from_room_id, exit_move)
	return true

func visible_moves() -> Array:
	return _visible_moves.keys()

func position_state_for(exit_move: String) -> String:
	return str(_position_states.get(exit_move, "absent"))

## A flat chevron lying in the gutter, pointing the way out.
##
## This was an upright cylinder standing at the anchor, and Dan found both
## things wrong with it by playing: "the exits are sometimes hard to find", and
## a marker wants to be "on the edge actually... but not on the block itself,
## it won't be readable".
##
## Upright is the harder half. At a fixed isometric camera a standing post is
## seen nearly end-on, so it covers very few pixels and hides behind whatever
## the room contains. A flat shape lying on the ground keeps its whole area
## turned toward the camera wherever it sits on the board. The wedge also
## carries direction, which a cylinder cannot: it points out of the room, so
## eight of them read as eight ways out rather than eight identical bollards.
##
## And it belongs in the gutter between this block and the next rather than on
## the block, for the reason Dan gave - against room content it is not
## readable. The gutter is empty by construction (CELL_GAP_METRES in
## src/lib/isometric-board-layout.mjs), so a marker there competes with
## nothing, and a mark drawn between two tiles is what a doorway between two
## rooms actually is.
func _add_visuals(anchor: Node3D, move: String, resolved: bool) -> void:
	var marker := MeshInstance3D.new()
	var mesh := PrismMesh.new()
	# Wide across the edge it sits on, shallow along the direction of travel,
	# and thin: a chevron painted on the floor, not an object in the room.
	mesh.size = Vector3(0.9, 0.12, 0.7)
	marker.mesh = mesh
	# The prism's point faces +Z. Turn it to face away from the room centre so
	# it reads as an arrow out rather than a wedge lying at some angle.
	var outward := Vector3(anchor.position.x, 0.0, anchor.position.z)
	if outward.length_squared() > 0.0001:
		marker.rotation.y = atan2(outward.x, outward.z)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.95, 0.85, 0.30) if resolved else Color(0.52, 0.55, 0.58)
	material.emission_enabled = resolved
	material.emission = Color(0.45, 0.30, 0.04) if resolved else Color.BLACK
	marker.material_override = material
	# Just clear of the ground plane: high enough not to z-fight the board,
	# low enough to stay a floor marking.
	marker.position.y = 0.08
	anchor.add_child(marker)

	var label := Label3D.new()
	label.text = move
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.outline_size = 4
	label.font_size = 40
	label.position.y = 0.95
	anchor.add_child(label)

	var body := StaticBody3D.new()
	body.name = "WalkTarget"
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.5
	shape.shape = sphere
	body.add_child(shape)
	body.input_event.connect(_on_anchor_clicked.bind(_current_room_id, move))
	anchor.add_child(body)

func _on_anchor_clicked(_camera: Node, event: InputEvent, _position: Vector3, _normal: Vector3, _shape_idx: int, from_room_id: String, exit_move: String) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		request_exit(from_room_id, exit_move)

func _anchor_placement(exit: Dictionary, index: int, cells: Dictionary) -> Dictionary:
	var board_anchor = exit.get("boardAnchor")
	if board_anchor is Dictionary:
		return {"offset": Vector3(float(board_anchor.get("x", 0.0)), float(board_anchor.get("y", 0.0)), float(board_anchor.get("z", 0.0))), "state": "resolved"}
	var target_id := str(exit.get("targetCellId", ""))
	if not target_id.is_empty() and cells.has(target_id):
		var from_position := _cell_position(cells[_current_room_id])
		var delta := _cell_position(cells[target_id]) - from_position
		delta.y = 0.0
		if delta.length_squared() > 0.0001:
			return {"offset": delta.normalized() * 2.4, "state": "resolved"}
	# A real but directionless/external exit remains actionable without being
	# assigned a fabricated compass edge. Stack it above the room centre as an
	# explicitly neutral affordance; the accessible exit list remains primary.
	return {"offset": Vector3(0.0, 1.2 + float(index) * 0.35, 0.0), "state": "unpositioned"}

func _clear() -> void:
	for child in get_children():
		child.free()
	_visible_moves.clear()
	_position_states.clear()
	_current_room_id = ""

func _cell_position(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))
