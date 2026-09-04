extends Node3D
## Snapshot-only tabletop token projection for the continuous 3D viewer.
##
## The game remains a room-node MUD: this layer receives entities and ground
## items that have already been confirmed by the bridge and puts a small,
## deterministic visual token *under that room's tether*. The local angle is
## purely presentation spacing. When the bridge supplies one of DragonRealms'
## exact assessed range buckets, the local radius uses that band; it is never
## converted into physical distance and cannot carry a token into another room.

var _tethers: Dictionary = {}
var _projected_ids: Dictionary = {}
var _target_links: Dictionary = {}
const CombatPresentation := preload("res://scripts/combat_presentation.gd")

signal inspect_entity_requested(entity_id: String)
signal inspect_ground_item_requested(item_id: String)

func project_snapshot(snapshot: Dictionary, room_holders: Dictionary) -> void:
	_clear_projection()
	_project_player(snapshot, room_holders)
	for entity_value in snapshot.get("entities", []):
		if entity_value is Dictionary:
			_project_entity(entity_value, room_holders)
	for item_value in snapshot.get("groundItems", []):
		if item_value is Dictionary:
			_project_ground_item(item_value, room_holders)
	_project_engagements(snapshot)

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

func target_for(projected_id: String) -> String:
	return str(_target_links.get(projected_id, ""))

func target_link_count() -> int:
	return _target_links.size()

func _clear_projection() -> void:
	for tether in _tethers.values():
		if tether != null and is_instance_valid(tether):
			tether.free()
	_tethers.clear()
	_projected_ids.clear()
	_target_links.clear()

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
	token.material_override = _token_material(CombatPresentation.token_color(entity))
	var tactical_value = entity.get("tactical")
	var role := "hostile" if String(entity.get("deck", "")) == "hostile" else "occupant"
	token.position = _slot_for(entity_id, _range_radius(entity)) if tactical_value is Dictionary else _board_slot(tether, role, entity_id, 1.50)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "entity")
	token.set_meta("entityName", String(entity.get("name", "")))
	token.set_meta("assessmentState", CombatPresentation.assessment_state(entity))
	token.set_meta("tacticalSummary", CombatPresentation.tactical_summary(entity))
	token.set_meta("tooltip", CombatPresentation.tactical_tooltip(entity))
	tether.add_child(token)
	_add_assessment_ring(token, CombatPresentation.assessment_state(entity))
	_add_inspect_hitbox(token, "entity", entity_id)
	_projected_ids[entity_id] = token

func _project_player(snapshot: Dictionary, room_holders: Dictionary) -> void:
	var player_value = snapshot.get("player")
	var room_id := str(snapshot.get("currentRoomId", ""))
	if not player_value is Dictionary or room_id.is_empty():
		return
	var tether := _tether_for(room_id, room_holders)
	if tether == null:
		return
	var token := MeshInstance3D.new()
	token.name = "PlayerSelf"
	var pawn := CapsuleMesh.new()
	pawn.radius = 0.28
	pawn.height = 0.94
	token.mesh = pawn
	token.material_override = _token_material(CombatPresentation.player_color(player_value))
	token.position = _board_slot(tether, "player", "player:self", 0.0)
	var view := CombatPresentation.player_view(player_value)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "player")
	token.set_meta("combatState", view.get("state", "PLAYER STATE UNKNOWN"))
	token.set_meta("healthPercent", view.get("healthPercent", 0.0))
	tether.add_child(token)
	_add_range_bands(tether)
	_projected_ids["player:self"] = token

func _add_range_bands(tether: Node3D) -> void:
	if tether.has_node("RangeBands"):
		return
	var bands := Node3D.new()
	bands.name = "RangeBands"
	for definition in [["melee", 0.78, Color(0.95, 0.30, 0.24, 0.24)], ["pole", 1.24, Color(0.96, 0.67, 0.18, 0.20)], ["missile", 1.72, Color(0.35, 0.64, 0.96, 0.17)]]:
		var ring := MeshInstance3D.new()
		ring.name = "RangeBand_%s" % definition[0]
		var torus := TorusMesh.new()
		torus.inner_radius = float(definition[1]) - 0.025
		torus.outer_radius = float(definition[1]) + 0.025
		ring.mesh = torus
		ring.material_override = _transparent_material(definition[2])
		ring.position.y = 0.015
		bands.add_child(ring)
	tether.add_child(bands)

func _add_assessment_ring(token: MeshInstance3D, state: String) -> void:
	var ring := MeshInstance3D.new()
	ring.name = "AssessmentRing"
	var torus := TorusMesh.new()
	torus.inner_radius = 0.39
	torus.outer_radius = 0.46
	ring.mesh = torus
	ring.material_override = _token_material(CombatPresentation.assessment_color(state))
	ring.position.y = -0.39
	token.add_child(ring)

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
	token.position = _board_slot(tether, "item", item_id, 1.55)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "ground-item")
	token.set_meta("itemName", String(item.get("name", "")))
	tether.add_child(token)
	_add_inspect_hitbox(token, "ground-item", item_id)
	_projected_ids[item_id] = token

func _project_engagements(snapshot: Dictionary) -> void:
	var names: Dictionary = {"you": ["player:self"]} if _projected_ids.has("player:self") else {}
	for entity_value in snapshot.get("entities", []):
		if not entity_value is Dictionary:
			continue
		var entity_id := str(entity_value.get("id", ""))
		if not _projected_ids.has(entity_id):
			continue
		var entity_name := str(entity_value.get("name", "")).strip_edges().to_lower()
		if not entity_name.is_empty():
			if not names.has(entity_name):
				names[entity_name] = []
			names[entity_name].append(entity_id)
	for entity_value in snapshot.get("entities", []):
		if not entity_value is Dictionary:
			continue
		var source_id := str(entity_value.get("id", ""))
		var tactical_value = entity_value.get("tactical")
		if not tactical_value is Dictionary or bool(tactical_value.get("dead", false)) or bool(tactical_value.get("disengaged", false)):
			continue
		var target_name := str(tactical_value.get("target", "")).strip_edges().to_lower()
		var candidates: Array = names.get(target_name, [])
		if candidates.size() != 1:
			continue
		var target_id := str(candidates[0])
		if source_id == target_id or not _projected_ids.has(source_id) or not _projected_ids.has(target_id):
			continue
		_add_target_link(source_id, target_id, CombatPresentation.assessment_color(CombatPresentation.assessment_state(entity_value)))

func _add_target_link(source_id: String, target_id: String, color: Color) -> void:
	var source: Node3D = _projected_ids[source_id]
	var target: Node3D = _projected_ids[target_id]
	if source.get_parent() != target.get_parent():
		return
	var line_mesh := ImmediateMesh.new()
	line_mesh.surface_begin(Mesh.PRIMITIVE_LINES, _transparent_material(Color(color.r, color.g, color.b, 0.68)))
	line_mesh.surface_add_vertex(source.position + Vector3(0.0, 0.08, 0.0))
	line_mesh.surface_add_vertex(target.position + Vector3(0.0, 0.08, 0.0))
	line_mesh.surface_end()
	var line := MeshInstance3D.new()
	line.name = "Target_%s_to_%s" % [source_id, target_id]
	line.mesh = line_mesh
	source.get_parent().add_child(line)
	_target_links[source_id] = target_id

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
	tether.set_meta("board", room_holder.get_meta("board", {}))
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

func _token_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.06
	material.roughness = 0.42
	return material

func _transparent_material(color: Color) -> StandardMaterial3D:
	var material := _token_material(color)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

func _range_radius(entity: Dictionary) -> float:
	var tactical_value = entity.get("tactical")
	if not tactical_value is Dictionary:
		return 1.50
	match str(tactical_value.get("range", "")):
		"melee": return 0.78
		"pole": return 1.24
		"missile": return 1.72
		_: return 1.50

func _slot_for(stable_id: String, radius: float) -> Vector3:
	var hash_value := _stable_hash(stable_id)
	var angle := TAU * float(hash_value % 360) / 360.0
	var distance := radius * (0.94 + float((hash_value / 360) % 13) / 100.0)
	return Vector3(cos(angle) * distance, 0.4, sin(angle) * distance)

func _board_slot(tether: Node3D, role: String, stable_id: String, fallback_radius: float) -> Vector3:
	var board_value = tether.get_meta("board", {})
	if board_value is Dictionary:
		var matches: Array = []
		for point in board_value.get("spawnPoints", []):
			if point is Dictionary and str(point.get("role", "")) == role:
				matches.append(point)
		if not matches.is_empty():
			var point: Dictionary = matches[_stable_hash(stable_id) % matches.size()]
			var anchor: Dictionary = point.get("anchor", {})
			return Vector3(float(anchor.get("x", 0.0)), float(anchor.get("y", 0.4)), float(anchor.get("z", 0.0)))
	var fallback := _slot_for(stable_id, fallback_radius)
	return fallback + Vector3(0.0, -0.32, 0.0) if role == "item" else fallback

func _stable_hash(value: String) -> int:
	var result := 17
	for i in range(value.length()):
		result = (result * 31 + value.unicode_at(i)) & 0x7fffffff
	return result
