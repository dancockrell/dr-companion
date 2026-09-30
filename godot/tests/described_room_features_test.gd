extends SceneTree
const Diorama := preload("res://scripts/room_diorama.gd")
var checked := 0
var failed := 0

func _initialize() -> void:
	var fixture = JSON.parse_string(FileAccess.get_file_as_string("res://mock/crossing_mock_world.json"))
	var cell: Dictionary = fixture.cells[0]
	var before := JSON.stringify(cell)
	var art := Diorama.new()
	var parent := Node3D.new()
	var rendered := art.described_features(parent, Vector3.ZERO, 4.4, 4.4, cell)
	_ok("verified prose renders cobblestones and privet", rendered == ["cobblestones", "privet_hedge"])
	_ok("description recipe preserves all source exits and action state", JSON.stringify(cell) == before)
	var root := parent.get_child(0)
	_ok("recipe records exact description provenance", root.get_meta("source_sha256") == cell.descriptionSource.sha256 and root.get_meta("presentation_only"))
	_ok("visible narrow cobbled stretch has 36 stone meshes", root.get_node("DescribedCobblestones").get_child_count() == 36)
	_ok("visible privet hedge has 36 overlapping foliage clusters", root.get_node("DescribedPrivetHedge").get_child_count() == 36)
	_ok("features have no collision or interactive nodes", _cosmetic_only(root))
	_ok("geometry stays within representative footprint", _bounded(root, 4.4, 4.4))
	for mode in ["missing", "changed", "unknown", "hash", "live", "game"]:
		var unsupported := cell.duplicate(true)
		match mode:
			"missing": unsupported.erase("description")
			"changed": unsupported.description += " Changed."
			"unknown": unsupported.descriptionSource.sourceId = "unknown"
			"hash": unsupported.descriptionSource.sha256 = "wrong"
			"live": unsupported.descriptionSource.kind = "live"
			"game": unsupported.descriptionSource.game = "other"
		var count := parent.get_child_count()
		_ok("%s source safely falls back without invented features" % mode, art.described_features(parent, Vector3.ZERO, 4.4, 4.4, unsupported).is_empty() and parent.get_child_count() == count)
	_ok("invalid footprint safely falls back", art.described_features(parent, Vector3.ZERO, 0, 4.4, cell).is_empty())
	parent.free()
	print("%d checked, %d failed" % [checked, failed])
	quit(1 if failed else 0)

func _cosmetic_only(node: Node) -> bool:
	if not node is Node3D or node is CollisionObject3D or node is CollisionShape3D or node.get_script() != null:
		return false
	for child in node.get_children():
		if not _cosmetic_only(child): return false
	return true

func _bounded(node: Node3D, width: float, depth: float) -> bool:
	for child in node.get_children():
		if child is MeshInstance3D:
			var box: AABB = child.transform * child.mesh.get_aabb()
			if absf(box.get_center().x) + box.size.x / 2 > width / 2 or absf(box.get_center().z) + box.size.z / 2 > depth / 2:
				return false
		if not _bounded(child, width, depth): return false
	return true

func _ok(label: String, condition: bool) -> void:
	checked += 1
	if condition: print("OK   %s" % label)
	else:
		failed += 1
		print("FAIL %s" % label)
