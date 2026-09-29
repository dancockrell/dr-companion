extends SceneTree

var checked := 0
var failed := 0

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var scene: Node3D = load("res://scenes/tabletop.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	var bridge: Node = root.get_node("BridgeClient")
	var sender: Node = root.get_node("IntentSender")
	_ok("main scene loads the explicit demo fixture", bridge.mock_mode and scene.current_room == "1-14")
	_ok("tabletop builds visible geometry", scene.geometry.get_child_count() > 0)
	_ok("room camera centers on confirmed room", scene.focus == scene._point(root.get_node("WorldManifestLoader").get_cell("1-14")))
	_ok("demo is clearly labeled", scene.status_label.text.contains("DEMO"))
	_ok("confirmed exits are reachable buttons", scene.exits.get_child_count() > 0)
	var original_snapshot: Dictionary = bridge.current_snapshot.duplicate(true)
	var original_color: Color = scene.geometry.get_child(0).material_override.albedo_color
	var live_content: Dictionary = original_snapshot.duplicate(true)
	for cell in live_content.cells:
		if cell.id == scene.current_room:
			cell.groundKind = "grass"
			cell.content = {"groundKind": "snow", "spatialMode": "interior-cutaway"}
	root.get_node("WorldManifestLoader").load_from_snapshot(live_content)
	scene.render_snapshot(live_content)
	_ok("live classified terrain changes the rendered material", scene.geometry.get_child(0).material_override.albedo_color == Color("cbd8df"))
	var has_wall := false
	for mesh in scene.geometry.get_children():
		if mesh is MeshInstance3D and mesh.mesh is BoxMesh and is_equal_approx(mesh.mesh.size.y, 1.2):
			has_wall = true
	_ok("live interior classification builds cutaway wall geometry", has_wall)
	root.get_node("WorldManifestLoader").load_from_snapshot(original_snapshot)
	scene.render_snapshot(original_snapshot)
	_ok("legacy mock content still renders after a live content update", scene.geometry.get_child(0).material_override.albedo_color == original_color)
	scene.set_view("route")
	_ok("route mode changes framing only", scene.camera.size > 12.0 and scene.current_room == "1-14")
	scene.set_view("world")
	_ok("world mode retains room truth", scene.view_mode == "world" and scene.current_room == "1-14")
	var old_size: float = scene.camera.size
	scene.set_view("invented")
	_ok("unknown camera modes are rejected", scene.camera.size == old_size)
	scene.set_view("room")
	var stable_geometry: int = scene.geometry.get_child(0).get_instance_id()
	var stable_exit: int = scene.exits.get_child(0).get_instance_id()
	var status_only: Dictionary = bridge.current_snapshot.duplicate(true)
	status_only.player = {"health": 0.5, "roundtime": 0, "cannotAct": false}
	scene.render_snapshot(status_only)
	_ok("health updates retain terrain and keyboard exit focus", scene.geometry.get_child(0).get_instance_id() == stable_geometry and scene.exits.get_child(0).get_instance_id() == stable_exit)
	_ok("retained board still updates player health", scene.player_summary.text.contains("50% health"))
	var move: String = root.get_node("WorldManifestLoader").true_exits("1-14")[0].move
	sender.request_walk("1-14", move)
	_ok("confirmed mock movement updates camera and room", scene.current_room == str(bridge.current_snapshot.currentRoomId) and scene.current_room != "1-14")
	var confirmed: String = scene.current_room
	sender.request_walk(confirmed, "invented exit")
	_ok("invented movement never changes the rendered room", scene.current_room == confirmed)
	_ok("rejected movement has visible feedback", scene.status_label.text.contains("not a true exit"))
	var fixture: Dictionary = bridge.current_snapshot.duplicate(true)
	fixture.entities = [{"id": "npc-1", "roomId": confirmed, "name": "Confirmed person", "deck": "people"}, {"id": "npc-away", "roomId": "elsewhere", "name": "Absent person"}]
	fixture.groundItems = [{"id": "item-1", "roomId": confirmed, "name": "Confirmed item"}]
	scene.render_snapshot(fixture)
	_ok("inspector lists only confirmed occupants and items", scene.details.get_child_count() == 3)
	scene._connection_changed("reconnecting")
	var disabled := true
	for button in scene.exits.get_children():
		disabled = disabled and button.disabled
	_ok("disconnected travel controls are disabled", disabled)
	scene._connection_changed("authenticated")
	_ok("authenticated bridge restores exit controls", not scene.exits.get_child(0).disabled)
	scene.render_snapshot(bridge.current_snapshot)
	scene.status_label.text = "DEMO • local fixture • no game connected"
	# Optional visual QA through a real virtual display, never a user's window.
	var screenshot := OS.get_environment("DRC_TABLETOP_SCREENSHOT")
	if not screenshot.is_empty():
		await process_frame
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(screenshot)
	scene.free()
	var live: Node3D = load("res://tests/fixtures/live_tabletop.gd").new()
	root.add_child(live)
	await process_frame
	_ok("missing live bridge never falls back to demo", not bridge.mock_mode and live.current_room.is_empty())
	live.set_view("room")
	_ok("unconfirmed live room draws no invented player or terrain", live.geometry.get_child_count() == 0)
	_ok("missing live configuration is visible", live.status_label.text.contains("configuration-unavailable"))
	live.free()
	print("%d checked, %d failed" % [checked, failed])
	quit(1 if failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		failed += 1
		print("FAIL %s" % label)
