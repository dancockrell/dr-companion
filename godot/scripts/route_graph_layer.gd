extends Node3D
## One inexpensive static mesh per typed tether family.
##
## This is presentation of confirmed topology, not a navigation mesh and not
## an interaction target.  Detailed cells decide their own prop budget; this
## layer makes the world/route camera legible without asking every remote room
## to instantiate scenery.  Reciprocal exits draw one segment, while a route
## to an unloaded/external cell is deliberately absent rather than guessed.

var _segment_count := 0
var _segment_counts: Dictionary = {}

const TETHER_COLORS := {
	"road": Color(0.62, 0.48, 0.30, 0.82),
	"path": Color(0.35, 0.60, 0.32, 0.82),
	"threshold": Color(0.82, 0.72, 0.38, 0.88),
	"stairs": Color(0.72, 0.72, 0.76, 0.88),
	"ladder": Color(0.66, 0.42, 0.22, 0.88),
	"ferry": Color(0.20, 0.58, 0.78, 0.90),
	"portal": Color(0.68, 0.36, 0.92, 0.92),
	"warp": Color(0.92, 0.34, 0.72, 0.92),
	"other": Color(0.46, 0.52, 0.56, 0.66),
}

func render_routes(cells: Dictionary) -> void:
	_clear()
	var route_meshes: Dictionary = {}
	var rendered_pairs: Dictionary = {}
	_segment_count = 0
	_segment_counts = {}

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
			var tether_kind := str(exit.get("tetherKind", "other"))
			if not TETHER_COLORS.has(tether_kind):
				tether_kind = "other"
			if not route_meshes.has(tether_kind):
				var typed_mesh := ImmediateMesh.new()
				typed_mesh.surface_begin(Mesh.PRIMITIVE_LINES)
				route_meshes[tether_kind] = typed_mesh
			var route_mesh: ImmediateMesh = route_meshes[tether_kind]
			route_mesh.surface_add_vertex(_cell_position(source_cell) + Vector3(0.0, 0.06, 0.0))
			route_mesh.surface_add_vertex(_cell_position(cells[target_id]) + Vector3(0.0, 0.06, 0.0))
			_segment_count += 1
			_segment_counts[tether_kind] = int(_segment_counts.get(tether_kind, 0)) + 1

	for tether_kind in route_meshes.keys():
		var route_mesh: ImmediateMesh = route_meshes[tether_kind]
		route_mesh.surface_end()
		var mesh_instance := MeshInstance3D.new()
		mesh_instance.name = "ManifestRoutes_%s" % tether_kind
		mesh_instance.mesh = route_mesh
		mesh_instance.material_override = _material_for(tether_kind)
		add_child(mesh_instance)

func segment_count() -> int:
	return _segment_count

func segment_count_for(tether_kind: String) -> int:
	return int(_segment_counts.get(tether_kind, 0))

func _material_for(tether_kind: String) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = TETHER_COLORS.get(tether_kind, TETHER_COLORS["other"])
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return material

func _clear() -> void:
	for child in get_children():
		child.free()

func _cell_position(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))

func _undirected_pair_key(a: String, b: String) -> String:
	return "%s\u001f%s" % [a, b] if a < b else "%s\u001f%s" % [b, a]
