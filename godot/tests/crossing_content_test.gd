extends SceneTree
var checked := 0
var failed := 0

func check(value: bool, label: String) -> void:
	checked += 1
	if not value:
		failed += 1
		push_error(label)

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var registry = root.get_node("ContentRegistry")
	var content = root.get_node("SharedAssetContent")
	var fixture: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://mock/crossing_mock_world.json"))
	var selections: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/shared_asset_selections.json"))
	var cells: Dictionary = {}
	for cell in fixture.cells:
		cells[cell.id] = cell
	var original := JSON.stringify(cells)
	for recipe in selections.roomCompositions:
		var cell: Dictionary = cells[recipe.cellId]
		var node: Node3D = registry.build_cell(cell)
		check(node.name == "AuthoredTownGreen", recipe.cellId + " uses actual native content")
		check(node.get_child_count() == recipe.pieces.size(), "All declared pieces mounted")
		var size = registry.block_size_metres(cell)
		for model in node.get_children():
			var bounds := _bounds(model, node)
			check(bounds.position.x >= -size.x/2 - 0.001 and bounds.end.x <= size.x/2 + 0.001 and bounds.position.z >= -size.z/2 - 0.001 and bounds.end.z <= size.z/2 + 0.001, "Full visual geometry stays within published footprint")
		node.free()
		var changed := cell.duplicate(true)
		changed.sourceDescriptionHash = "changed"
		check(content.build_room_composition(changed) == null, "Changed description refuses old composition")
		changed = cell.duplicate(true)
		changed.id = "unrelated-room"
		check(content.build_room_composition(changed) == null, "Similar text cannot assign another room's geometry")
	check(content.build_room_composition(cells["1-467"]) == null, "Unknown pond remains unresolved")
	check(JSON.stringify(cells) == original, "Composition never changes room positions exits or state")
	print("%d checked, %d failed" % [checked, failed])
	quit(1 if failed else 0)

func _bounds(node: Node3D, relative: Node3D) -> AABB:
	var result := AABB()
	var found := false
	for mesh in node.find_children("*", "MeshInstance3D", true, false):
		var transform: Transform3D = mesh.transform
		var parent: Node = mesh.get_parent()
		while parent != relative:
			transform = parent.transform * transform
			parent = parent.get_parent()
		var box: AABB = transform * mesh.mesh.get_aabb()
		result = result.merge(box) if found else box
		found = true
	return result
