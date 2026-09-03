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
		anchor.position = base + _anchor_offset(exit, index, exits.size(), cells)
		anchor.set_meta("move", move)
		anchor.set_meta("fromRoomId", room_id)
		add_child(anchor)
		_visible_moves[move] = true
		_add_visuals(anchor, move)

func request_exit(from_room_id: String, exit_move: String) -> bool:
	if from_room_id != _current_room_id or not _visible_moves.has(exit_move):
		return false
	exit_requested.emit(from_room_id, exit_move)
	return true

func visible_moves() -> Array:
	return _visible_moves.keys()

func _add_visuals(anchor: Node3D, move: String) -> void:
	var marker := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.22
	mesh.bottom_radius = 0.38
	mesh.height = 0.8
	marker.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.95, 0.85, 0.30)
	material.emission_enabled = true
	material.emission = Color(0.45, 0.30, 0.04)
	marker.material_override = material
	marker.position.y = 0.4
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

func _anchor_offset(exit: Dictionary, index: int, count: int, cells: Dictionary) -> Vector3:
	var target_id := str(exit.get("targetCellId", ""))
	if not target_id.is_empty() and cells.has(target_id):
		var from_position := _cell_position(cells[_current_room_id])
		var delta := _cell_position(cells[target_id]) - from_position
		delta.y = 0.0
		if delta.length_squared() > 0.0001:
			return delta.normalized() * 2.4
	var angle := TAU * float(index) / maxi(1, count)
	return Vector3(cos(angle) * 2.4, 0.0, sin(angle) * 2.4)

func _clear() -> void:
	for child in get_children():
		child.free()
	_visible_moves.clear()
	_current_room_id = ""

func _cell_position(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))
