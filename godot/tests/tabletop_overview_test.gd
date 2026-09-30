extends SceneTree
var checked := 0
var failed := 0

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	root.size = Vector2i(1280, 720)
	var scene: Node3D = load("res://scenes/tabletop.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	await process_frame
	var bridge: Node = root.get_node("BridgeClient")
	var loader: Node = root.get_node("WorldManifestLoader")
	var sender: Node = root.get_node("IntentSender")
	var intents: Array = []
	sender.intent_created.connect(func(intent): intents.append(intent))
	var original: Dictionary = bridge.current_snapshot.duplicate(true)
	scene.set_view("world")
	_ok("overview has a graph marker and pick body for each mounted room", scene.overview_markers.size() == scene.rendered_ids.size() and scene.overview_pick_bodies.size() == scene.rendered_ids.size())
	var marker: MeshInstance3D = scene.overview_markers[scene.current_room]
	var half: Vector3 = scene.camera.global_basis.x * marker.scale.x * 0.5
	var pixel_width: float = scene.camera.unproject_position(marker.position + half).distance_to(scene.camera.unproject_position(marker.position - half))
	_ok("distant overview markers retain at least twenty screen pixels", pixel_width >= 19.9)
	var collision: CollisionShape3D = scene.overview_pick_bodies[scene.current_room].get_child(0)
	_ok("graph hit areas exceed the visible marker size", collision.shape.radius * 2 > marker.scale.x)
	_ok("overview labels use readable screen-space text", scene.graph_labels[scene.current_room] is Label and scene.graph_labels[scene.current_room].get_theme_font_size("font_size") == 14)
	var placed: Array[Rect2] = []
	var nonoverlapping := true
	for label in scene.graph_labels.values():
		if not label.visible:
			continue
		var rect: Rect2 = label.get_global_rect()
		for other in placed:
			nonoverlapping = nonoverlapping and not rect.intersects(other)
		placed.append(rect)
	_ok("overview places readable labels without overlapping each other", nonoverlapping and placed.size() > 0)
	_ok("overview exposes the known-room picker", scene.destination_filter.visible and scene.destination_list.visible and scene.destination_list.item_count == loader.cells.size())
	var previous_size: float = scene.camera_size
	scene.zoom_by(0.8)
	_ok("zoom controls change camera framing without changing room truth", scene.camera_size < previous_size and scene.current_room == original.currentRoomId and intents.is_empty())
	marker = scene.overview_markers[scene.current_room]
	half = scene.camera.global_basis.x * marker.scale.x * 0.5
	pixel_width = scene.camera.unproject_position(marker.position + half).distance_to(scene.camera.unproject_position(marker.position - half))
	_ok("marker size stays screen-readable after zooming", pixel_width >= 19.9)
	scene.destination_filter.text = "1-191"
	scene.destination_filter.text_changed.emit("1-191")
	_ok("destination search matches a stable room ID", scene.destination_list.item_count == 1 and scene.destination_list.get_item_metadata(0) == "1-191")
	scene.destination_list.item_selected.emit(0)
	_ok("list selection picks the actual known room without travel", scene.selected_kind == "room" and scene.selected_id == "1-191" and intents.is_empty())
	_ok("focus selected frames the exact destination without movement", scene.focus_selected_room() and scene.focus == scene._point(loader.get_cell("1-191")) and scene.camera_size == 14.0 and scene.current_room == original.currentRoomId and intents.is_empty())
	scene.destination_filter.text = "no matching room exists"
	scene.destination_filter.text_changed.emit(scene.destination_filter.text)
	_ok("unmatched searches expose no invented destination", scene.destination_list.item_count == 0)
	scene.set_view("room")
	_ok("room view hides graph-only controls and markers", not scene.destination_list.visible and not scene.destination_filter.visible and scene.overview_markers.is_empty() and scene.graph_labels.is_empty())
	var graph: Dictionary = original.duplicate(true)
	graph.cells = []
	for index in range(410):
		graph.cells.append({"id": "node-%d" % index, "title": "Room %d" % index, "position": {"x": index * 6, "y": 0, "z": 0}, "exits": []})
	graph.currentRoomId = "node-0"
	loader.load_from_snapshot(graph)
	scene.render_snapshot(graph)
	scene.destination_filter.text = ""
	scene.set_view("world")
	_ok("large world geometry and destination results are bounded", scene.rendered_ids.size() == 400 and scene.destination_list.item_count == 200 and scene.destination_hint.text.contains("410 matches"))
	scene.destination_filter.text = "node-409"
	scene.destination_filter.text_changed.emit("node-409")
	scene.destination_list.item_selected.emit(0)
	_ok("search can mount a confirmed destination beyond the initial geometry budget", scene.selected_id == "node-409" and scene.rendered_ids.has("node-409") and scene.rendered_ids.size() == 400 and intents.is_empty())
	var list_id: int = scene.destination_list.get_instance_id()
	graph.player = {"roundtime": 0, "health": 0.5}
	scene.render_snapshot(graph)
	_ok("unrelated live status retains search text and destination list", scene.destination_filter.text == "node-409" and scene.destination_list.get_instance_id() == list_id and scene.destination_list.item_count == 1)
	scene.free()
	print("%d checked, %d failed" % [checked, failed])
	quit(1 if failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		failed += 1
		print("FAIL %s" % label)
