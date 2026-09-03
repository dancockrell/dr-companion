extends Node3D
## A short visual route ribbon for an already-confirmed room transition.
##
## This layer cannot move a player and never predicts an arrival.  `WorldRoot`
## calls it only after a snapshot says the current room changed; it then draws
## the exact manifest link between the previous and confirmed room, if one
## exists.  A reconnect, rejected command, external destination, or unexplained
## room jump stays visually quiet rather than receiving invented travel.

const FADE_SECONDS := 0.75

var _ribbon: MeshInstance3D
var _fade_tween: Tween
var _last_route: Dictionary = {}

func play_confirmed_route(from_room_id: String, to_room_id: String, cells: Dictionary) -> bool:
	_clear()
	if from_room_id.is_empty() or to_room_id.is_empty() or from_room_id == to_room_id:
		return false
	if not cells.has(from_room_id) or not cells.has(to_room_id) or not _has_true_link(from_room_id, to_room_id, cells):
		return false

	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	mesh.surface_add_vertex(_cell_position(cells[from_room_id]) + Vector3(0.0, 0.20, 0.0))
	mesh.surface_add_vertex(_cell_position(cells[to_room_id]) + Vector3(0.0, 0.20, 0.0))
	mesh.surface_end()

	_ribbon = MeshInstance3D.new()
	_ribbon.name = "ConfirmedRouteRibbon"
	_ribbon.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(1.0, 0.73, 0.23, 0.95)
	material.emission_enabled = true
	material.emission = Color(1.0, 0.40, 0.05)
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_ribbon.material_override = material
	add_child(_ribbon)
	_last_route = {"fromRoomId": from_room_id, "toRoomId": to_room_id}

	_fade_tween = create_tween()
	_fade_tween.tween_property(material, "albedo_color:a", 0.0, FADE_SECONDS)
	_fade_tween.tween_callback(_clear)
	return true

func last_route() -> Dictionary:
	return _last_route.duplicate()

func is_playing() -> bool:
	return _ribbon != null and is_instance_valid(_ribbon)

func _clear() -> void:
	if _fade_tween != null and _fade_tween.is_valid():
		_fade_tween.kill()
	_fade_tween = null
	if _ribbon != null and is_instance_valid(_ribbon):
		_ribbon.free()
	_ribbon = null

func _has_true_link(from_room_id: String, to_room_id: String, cells: Dictionary) -> bool:
	var source: Dictionary = cells.get(from_room_id, {})
	for exit in source.get("exits", []):
		if exit is Dictionary and str(exit.get("targetCellId", "")) == to_room_id:
			return true
	return false

func _cell_position(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))
