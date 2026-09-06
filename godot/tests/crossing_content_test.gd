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
	# Keep the reviewed lighting setup active; this is a configuration guard,
	# not a substitute for rendered shadow/contact inspection.
	var scene: Node3D = load("res://scenes/WorldRoot.tscn").instantiate()
	var sun: DirectionalLight3D = scene.get_node("Sun")
	check(sun.shadow_enabled, "Detailed scenery retains cast shadows")
	check(sun.shadow_bias >= 0.1 and sun.shadow_normal_bias >= 1.0, "Shadow bias avoids rejected low-bias striping setup")
	check(ProjectSettings.get_setting("rendering/lights_and_shadows/directional_shadow/size") >= 4096, "Detailed scene uses reviewed directional shadow resolution")
	scene.free()
	var registry = root.get_node("ContentRegistry")
	var content = root.get_node("SharedAssetContent")
	var fixture: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/crossing/world.json"))
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
			if model.has_meta("repeated_ground"):
				check(model.get_child_count() > 0, "Repeated ground has real source modules")
				for tile in model.get_children():
					check(tile.scale.x <= 1.001 and tile.scale.z <= 1.001 and is_equal_approx(tile.scale.y, 1.0), "Ground modules preserve native height and never stretch horizontally")
			var bounds := _bounds(model, node)
			check(bounds.position.x >= -size.x/2 - 0.001 and bounds.end.x <= size.x/2 + 0.001 and bounds.position.z >= -size.z/2 - 0.001 and bounds.end.z <= size.z/2 + 0.001, "Full visual geometry stays within published footprint")
			var shells := model.find_children("CompleteExterior", "Node3D", true, false)
			if not shells.is_empty():
				check(not shells[0].get_meta("building_bounds").cutaway, "Production exterior is a complete shell, not demo cutaway")
				var record: Dictionary = content._native_records[model.get_meta("asset_id")]
				check(record.sockets.has("entrance"), "Building has measured entrance socket")
				var facing: Vector3 = model.basis * Vector3.FORWARD
				var toward_center := Vector3(-model.position.x, 0, -model.position.z)
				check(facing.dot(toward_center) > 0, "Building front faces the authored local approach")
		node.free()
		var changed := cell.duplicate(true)
		changed.sourceDescriptionHash = "changed"
		check(content.build_room_composition(changed) == null, "Changed description refuses old composition")
		changed = cell.duplicate(true)
		changed.id = "unrelated-room"
		check(content.build_room_composition(changed) == null, "Similar text cannot assign another room's geometry")
	check(content.build_room_composition(cells["1-467"]) == null, "Pond without an authored composition refuses unrelated geometry")
	for room_id in ["1-14", "1-225"]:
		var approach_room: Node3D = content.build_room_composition(cells[room_id])
		var building: Node3D = approach_room.get_child(1)
		var building_record: Dictionary = content._native_records[building.get_meta("asset_id")]
		var socket: Array = building_record.sockets.entrance
		var entrance := building.transform * Vector3(socket[0], socket[1], socket[2])
		var path := _bounds(approach_room.get_child(4), approach_room)
		check(absf(path.position.z - entrance.z) < 0.001, "Approach starts at fitted entrance socket, not a guessed offset")
		check(absf(path.end.z - registry.block_size_metres(cells[room_id]).z * 0.5) < 0.001, "Approach reaches the published room edge")
		check(absf(path.get_center().x - entrance.x) < 0.001, "Approach is centered on actual entrance")
		approach_room.free()
	var bazaar: Node3D = content.build_room_composition(cells["1-379"])
	var bazaar_width: float = registry.block_size_metres(cells["1-379"]).x
	for index in range(1, bazaar.get_child_count()):
		var box := _bounds(bazaar.get_child(index), bazaar)
		check(box.end.x <= -bazaar_width * 0.1 or box.position.x >= bazaar_width * 0.1, "Bazaar scenery preserves central aisle")
	for pair in [[1, 3], [2, 4]]:
		var shelter := _bounds(bazaar.get_child(pair[0]), bazaar)
		var table := _bounds(bazaar.get_child(pair[1]), bazaar)
		check(table.position.x >= shelter.position.x and table.end.x <= shelter.end.x and table.position.z >= shelter.position.z and table.end.z <= shelter.end.z, "Stall table stays beneath its shelter envelope")
	bazaar.free()
	# A table-height change must carry its supplies with it, without a guessed lift.
	for multiplier in [0.7, 1.0, 1.3]:
		var supply: Dictionary = cells["1-371"].duplicate(true)
		var recipe: Dictionary = content._room_compositions["1-371"]
		var saved: Dictionary = recipe.duplicate(true)
		recipe.pieces[1].envelope = [0.4 * multiplier, 0.3 * multiplier]
		recipe.pieces[1].yawDegrees = 90
		var assembly: Node3D = content.build_room_composition(supply)
		var table := _bounds(assembly.get_child(1), assembly)
		var sacks := _bounds(assembly.get_child(3), assembly)
		check(absf(table.end.y - sacks.position.y) < 0.001, "Supplies rest on actual rotated, scaled table surface")
		check(absf(table.get_center().x - sacks.get_center().x) < 0.001 and absf(table.get_center().z - sacks.get_center().z) < 0.001, "Support socket centers supplies on table")
		assembly.free()
		content._room_compositions["1-371"] = saved
	var supply_recipe: Dictionary = content._room_compositions["1-371"]
	supply_recipe.pieces[3].support.socket = "missing"
	check(content.build_room_composition(cells["1-371"]) == null, "Missing socket refuses entire composition")
	supply_recipe.pieces[3].support.socket = "surface"
	supply_recipe.pieces[3].support.pieceIndex = 3
	check(content.build_room_composition(cells["1-371"]) == null, "Self or forward support reference refuses composition")
	supply_recipe.pieces[3].support.pieceIndex = 1
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
