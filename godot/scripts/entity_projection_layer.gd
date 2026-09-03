extends Node3D
## Snapshot-only tabletop token projection for the continuous 3D viewer.
##
## The game remains a room-node MUD: this layer receives entities and ground
## items that have already been confirmed by the bridge and puts a small,
## deterministic visual token *under that room's tether*.  The local offset is
## purely presentation spacing.  It is never a coordinate from the game, never
## a combat range, and cannot carry a token into another room.

var _tethers: Dictionary = {}
var _projected_ids: Dictionary = {}

signal inspect_entity_requested(entity_id: String)
signal inspect_ground_item_requested(item_id: String)

func project_snapshot(snapshot: Dictionary, room_holders: Dictionary) -> void:
	_clear_projection()
	for entity_value in snapshot.get("entities", []):
		if entity_value is Dictionary:
			_project_entity(entity_value, room_holders)
	for item_value in snapshot.get("groundItems", []):
		if item_value is Dictionary:
			_project_ground_item(item_value, room_holders)

func visible_ids() -> Array:
	return _projected_ids.keys()

func tether_room_for(projected_id: String) -> String:
	var token: Node3D = _projected_ids.get(projected_id)
	if token == null or not is_instance_valid(token):
		return ""
	return String(token.get_meta("roomId", ""))

func token_for(projected_id: String) -> Node3D:
	var token: Node3D = _projected_ids.get(projected_id)
	return token if token != null and is_instance_valid(token) else null

func local_slot_for(projected_id: String) -> Vector3:
	var token: Node3D = _projected_ids.get(projected_id)
	if token == null or not is_instance_valid(token):
		return Vector3.ZERO
	return token.position

func _clear_projection() -> void:
	for tether in _tethers.values():
		if tether != null and is_instance_valid(tether):
			tether.free()
	_tethers.clear()
	_projected_ids.clear()

func _project_entity(entity: Dictionary, room_holders: Dictionary) -> void:
	var entity_id := String(entity.get("id", ""))
	var room_id := String(entity.get("roomId", ""))
	if entity_id.is_empty() or room_id.is_empty():
		return
	var tether := _tether_for(room_id, room_holders)
	if tether == null:
		return

	var token := MeshInstance3D.new()
	token.name = "Entity_%s" % entity_id
	token.mesh = _entity_mesh(String(entity.get("deck", "")))
	token.material_override = _token_material(_entity_color(String(entity.get("deck", ""))))
	token.position = _slot_for(entity_id, 0.72)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "entity")
	token.set_meta("entityName", String(entity.get("name", "")))
	tether.add_child(token)
	_add_inspect_hitbox(token, "entity", entity_id)
	_projected_ids[entity_id] = token

func _project_ground_item(item: Dictionary, room_holders: Dictionary) -> void:
	var item_id := String(item.get("id", ""))
	var room_id := String(item.get("roomId", ""))
	if item_id.is_empty() or room_id.is_empty():
		return
	var tether := _tether_for(room_id, room_holders)
	if tether == null:
		return

	var token := MeshInstance3D.new()
	token.name = "GroundItem_%s" % item_id
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.28, 0.12, 0.28)
	token.mesh = mesh
	token.material_override = _token_material(Color(0.94, 0.71, 0.18))
	token.position = _slot_for(item_id, 1.55) + Vector3(0.0, 0.08, 0.0)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "ground-item")
	token.set_meta("itemName", String(item.get("name", "")))
	tether.add_child(token)
	_add_inspect_hitbox(token, "ground-item", item_id)
	_projected_ids[item_id] = token

func _add_inspect_hitbox(token: MeshInstance3D, snapshot_kind: String, snapshot_id: String) -> void:
	var body := StaticBody3D.new()
	body.name = "InspectTarget"
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.42 if snapshot_kind == "entity" else 0.24
	shape.shape = sphere
	body.add_child(shape)
	body.input_event.connect(_on_inspect_target_clicked.bind(snapshot_kind, snapshot_id))
	token.add_child(body)

func _on_inspect_target_clicked(_camera: Node, event: InputEvent, _position: Vector3, _normal: Vector3, _shape_idx: int, snapshot_kind: String, snapshot_id: String) -> void:
	if not (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT):
		return
	if snapshot_kind == "entity":
		inspect_entity_requested.emit(snapshot_id)
	else:
		inspect_ground_item_requested.emit(snapshot_id)

func _tether_for(room_id: String, room_holders: Dictionary) -> Node3D:
	var existing: Node3D = _tethers.get(room_id)
	if existing != null and is_instance_valid(existing):
		return existing
	var room_holder: Node3D = room_holders.get(room_id)
	if room_holder == null or not is_instance_valid(room_holder):
		return null
	var tether := Node3D.new()
	tether.name = "RoomTether_%s" % room_id
	tether.set_meta("roomId", room_id)
	room_holder.add_child(tether)
	_tethers[room_id] = tether
	return tether

func _entity_mesh(deck: String) -> PrimitiveMesh:
	if deck == "hostile":
		var sphere := SphereMesh.new()
		sphere.radius = 0.34
		sphere.height = 0.68
		return sphere
	var pawn := CylinderMesh.new()
	pawn.top_radius = 0.18
	pawn.bottom_radius = 0.38
	pawn.height = 0.8
	return pawn

func _entity_color(deck: String) -> Color:
	match deck:
		"hostile": return Color(0.88, 0.25, 0.22)
		"allied": return Color(0.20, 0.72, 0.42)
		"people": return Color(0.30, 0.58, 0.92)
		_: return Color(0.58, 0.58, 0.65)

func _token_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.06
	material.roughness = 0.42
	return material

func _slot_for(stable_id: String, radius: float) -> Vector3:
	var hash_value := _stable_hash(stable_id)
	var angle := TAU * float(hash_value % 360) / 360.0
	var distance := radius * (0.45 + float((hash_value / 360) % 55) / 100.0)
	return Vector3(cos(angle) * distance, 0.4, sin(angle) * distance)

func _stable_hash(value: String) -> int:
	var result := 17
	for i in range(value.length()):
		result = (result * 31 + value.unicode_at(i)) & 0x7fffffff
	return result
