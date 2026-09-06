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
	for cell in cells.values():
		var overview: Node3D = registry.build_cell(cell, false)
		check(overview.name == "OverviewGround", "Every full-city room has an overview surface holder")
		check(overview.get_child_count() == 1, "Overview mounts only the declared base, not props or landmark placeholders")
		check(overview.get_meta("content_status") == "base-only; not completed room art", "Overview does not claim art completion")
		overview.free()
	for recipe in selections.roomCompositions:
		check(recipe.pieces[0].get("assetId", "") != "painted-river-port.cobble-street", "Broad paved bases do not repeat raised curbs across the room")
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
	for room_id in ["1-191", "1-192"]:
		var shop: Node3D = content.build_room_composition(cells[room_id])
		var ids: Array = []
		for index in range(1, shop.get_child_count()):
			var furniture: Node3D = shop.get_child(index)
			if furniture.get_meta("composition_role") != "furnishing":
				continue
			ids.append(furniture.get_meta("asset_id"))
			var box := _bounds(furniture, shop)
			check(box.end.x < -2.0 or box.position.x > 2.0 or box.end.z < -2.0, "Shop furnishings preserve the central player area and south approach")
			for other in range(1, index):
				if shop.get_child(other).get_meta("composition_role") != "furnishing":
					continue
				check(not box.intersects(_bounds(shop.get_child(other), shop)), "Shop furniture envelopes do not overlap")
		check("painted-river-port.pine-shop-counter" in ids, "Showroom mounts a counter, not a generic workbench")
		check("painted-river-port.wooden-display-bin" in ids, "Showroom mounts an open goods bin")
		check(not "painted-river-port.cargo-stack" in ids, "Freight cargo does not substitute for shop display furniture")
		var count_before := shop.get_child_count()
		var anchors: Dictionary = shop.get_meta("exit_anchors")
		check(anchors.size() == cells[room_id].exits.size(), "Every showroom exit has a measured doorway socket")
		check(is_equal_approx(float(anchors.out.x), 0.0) and float(anchors.out.z) > 7.0, "Out marker uses south doorway socket")
		var absent_exit: Dictionary = cells[room_id].duplicate(true)
		absent_exit.exits = []
		check(content.build_room_composition(absent_exit) == null, "Removed live exit refuses stale doorway binding")
		var covers := 0
		content.set_interior_inspection(shop, true)
		for piece in shop.get_children():
			if piece.get_meta("inspection_cover", false):
				covers += 1
				check(not piece.visible, "Inspection hides authored covers")
			else:
				check(piece.visible, "Inspection retains rear shell and furnishings")
		check(covers == 11, "Two five-section walls and ceiling are viewing covers")
		content.set_interior_inspection(shop, false)
		for piece in shop.get_children():
			check(piece.visible, "World view restores complete geometry")
		check(shop.get_child_count() == count_before, "Inspection never destroys geometry")
		shop.free()
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
	# Water, decks and hulls share an explicit vertical composition contract.
	var quay: Node3D = content.build_room_composition(cells["1-32"])
	var water := _bounds(quay.get_child(0), quay)
	var deck_top: float = registry.block_top_y(cells["1-32"])
	for index in [1, 2, 3, 5]:
		var pier: Node3D = quay.get_child(index)
		var record: Dictionary = content._native_records[pier.get_meta("asset_id")]
		var socket: Array = record.sockets.join_a
		var point := pier.transform * Vector3(socket[0], socket[1], socket[2])
		check(absf(point.y - deck_top) < 0.001, "Every quay pier deck uses the same published standing height")
	for index in [4, 6]:
		check(absf(_bounds(quay.get_child(index), quay).end.y - deck_top) < 0.001, "Edge approaches align with pier deck height")
	var quay_size: Vector3 = registry.block_size_metres(cells["1-32"])
	check(absf(_bounds(quay.get_child(4), quay).end.x - quay_size.x * 0.5) < 0.001, "East walkway reaches room edge")
	check(absf(_bounds(quay.get_child(6), quay).end.z - quay_size.z * 0.5) < 0.001, "South walkway reaches room edge")
	for index in [7, 8, 9]:
		var boat := _bounds(quay.get_child(index), quay)
		check(boat.position.y < water.position.y and boat.end.y > water.position.y, "Dinghy hull crosses the declared waterline")
		check(boat.end.y < deck_top, "Dinghy gunwale stays below the raised pier deck")
	quay.free()
	var bank: Node3D = content.build_room_composition(cells["1-26"])
	for index in range(1, bank.get_child_count()):
		var cap := _bounds(bank.get_child(index), bank)
		check(absf(cap.end.y - registry.block_top_y(cells["1-26"])) < 0.001, "Retaining caps meet the street surface after native fitting")
		check(cap.end.z <= -1.499 or cap.position.z >= 1.499, "Embankment leaves a three-metre clear opening to the pier")
	bank.free()
	for pair in [["1-25", "1-26"], ["1-26", "1-32"]]:
		var east: Dictionary = cells[pair[0]]
		var west: Dictionary = cells[pair[1]]
		check(east.position.z == west.position.z and east.position.x > west.position.x, "Approach rooms follow the true westward street sequence")
		check(is_equal_approx(registry.block_top_y(east) + float(east.position.y), registry.block_top_y(west) + float(west.position.y)), "Approach standing surfaces meet at equal world height")
	var water_recipe: Dictionary = content._room_compositions["1-32"]
	water_recipe.pieces[0].surfaceKind = "unregistered-fake-river"
	check(content.build_room_composition(cells["1-32"]) == null, "Unknown authored surface refuses whole composition")
	water_recipe.pieces[0].surfaceKind = "water-ribbon-5m"
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
	var workshop: Node3D = content.build_room_composition(cells["1-193"])
	var workshop_exits: Dictionary = workshop.get_meta("exit_anchors", {})
	check(workshop_exits.has("out") and workshop_exits.has("go bellows room") and workshop_exits.size() == 2, "Workroom binds exactly its two real commands")
	check(workshop.get_child(1).get_meta("asset_id") == "painted-river-port.anvil", "Workroom uses the native anvil, not shop display furniture")
	for first in range(1, 8):
		var a := _bounds(workshop.get_child(first), workshop)
		for second in range(first + 1, 8):
			var b := _bounds(workshop.get_child(second), workshop)
			check(not a.intersects(b), "Workshop furniture has no intersecting measured bounds")
	content.set_interior_inspection(workshop, true)
	check(not workshop.get_child(workshop.get_child_count() - 1).visible, "Workroom ceiling opens for inspection")
	content.set_interior_inspection(workshop, false)
	check(workshop.get_child(workshop.get_child_count() - 1).visible, "Workroom ceiling restores outside inspection")
	workshop.free()
	var bellows_room: Node3D = content.build_room_composition(cells["1-194"])
	var bellows: Node3D = bellows_room.get_child(1)
	check(bellows.get_meta("asset_id") == "painted-river-port.forge-bellows", "Bellows room uses its named mechanism")
	check(bellows.scale.is_equal_approx(Vector3.ONE), "Bellows retains measured native proportions")
	var bellows_exits: Dictionary = bellows_room.get_meta("exit_anchors", {})
	check(bellows_exits.size() == 1 and bellows_exits.has("out"), "Bellows room has exactly its existing exit")
	var bellows_box := _bounds(bellows, bellows_room)
	check(bellows_box.end.z < 3.0 and bellows_box.end.y < 3.05 + registry.block_top_y(cells["1-194"]), "Bellows leaves operator and ceiling clearance")
	for socket in ["air_outlet", "lever_pivot", "operator_handle"]:
		check(not bellows.find_children(socket, "Node3D", true, false).is_empty(), "Bellows keeps measured " + socket)
	bellows_room.free()
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
