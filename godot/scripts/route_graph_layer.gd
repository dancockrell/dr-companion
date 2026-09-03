extends Node3D
## One inexpensive visual route mesh for a whole loaded manifest.
##
## This is presentation of confirmed topology, not a navigation mesh and not
## an interaction target.  Detailed cells decide their own prop budget; this
## layer makes the world/route camera legible without asking every remote room
## to instantiate scenery.  Reciprocal exits draw one segment, while a route
## to an unloaded/external cell is deliberately absent rather than guessed.

var _mesh_instance: MeshInstance3D
var _segment_count := 0

func render_routes(cells: Dictionary) -> void:
	_ensure_mesh_instance()
	var route_mesh := ImmediateMesh.new()
	route_mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	var rendered_pairs: Dictionary = {}
	_segment_count = 0

	for source_id_value in cells.keys():
		var source_id := str(source_id_value)
		var source_cell: Dictionary = cells.get(source_id, {})
		for exit in source_cell.get("exits", []):
			if not (exit is Dictionary):
				continue
			var target_id := str(exit.get("targetCellId", ""))
			if target_id.is_empty() or not cells.has(target_id):
				continue
			var pair_key := _undirected_pair_key(source_id, target_id)
			if rendered_pairs.has(pair_key):
				continue
			rendered_pairs[pair_key] = true
			route_mesh.surface_add_vertex(_cell_position(source_cell) + Vector3(0.0, 0.06, 0.0))
			route_mesh.surface_add_vertex(_cell_position(cells[target_id]) + Vector3(0.0, 0.06, 0.0))
			_segment_count += 1

	route_mesh.surface_end()
	_mesh_instance.mesh = route_mesh

func segment_count() -> int:
	return _segment_count

func _ensure_mesh_instance() -> void:
	if _mesh_instance != null and is_instance_valid(_mesh_instance):
		return
	_mesh_instance = MeshInstance3D.new()
	_mesh_instance.name = "ManifestRoutes"
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.28, 0.63, 0.72, 0.72)
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mesh_instance.material_override = material
	add_child(_mesh_instance)

func _cell_position(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))

func _undirected_pair_key(a: String, b: String) -> String:
	return "%s\u001f%s" % [a, b] if a < b else "%s\u001f%s" % [b, a]
