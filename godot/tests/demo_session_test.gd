extends SceneTree
var checked := 0
var failed := 0

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var bridge: Node = root.get_node("BridgeClient")
	var loader: Node = root.get_node("WorldManifestLoader")
	loader.load_from_path("res://mock/crossing_mock_world.json")
	bridge.start_mock("fixture", "1-14")
	_ok("ordinary mock sessions contain no sample occupants or player", bridge.current_snapshot.entities.is_empty() and bridge.current_snapshot.groundItems.is_empty() and bridge.current_snapshot.player == null)
	var scene: Node3D = load("res://scenes/tabletop.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	_ok("standalone demo explicitly identifies its sample state", scene.status_label.text.contains("DEMO") and scene.status_label.text.contains("sample"))
	_ok("standalone demo provides sample pawns and an item to inspect", bridge.current_snapshot.entities.size() == 2 and bridge.current_snapshot.groundItems.size() == 1 and scene.pick_bodies.has("entity:demo:town-guard") and scene.pick_bodies.has("item:demo:copper-coin"))
	_ok("unselected sample pawn names cannot overlap the player label", scene.token_labels["player:player"].visible and not scene.token_labels["entity:demo:town-guard"].visible and not scene.token_labels["entity:demo:practice-opponent"].visible)
	var pawn_id: int = scene.token_labels["entity:demo:town-guard"].get_instance_id()
	_ok("sample inspection remains read-only", scene.select_visible_target("entity", "demo:town-guard") and scene.current_room == "1-14" and scene.selection_title.text == "Sample town guard")
	_ok("selected pawn gets the sole board name without rebuilding geometry", scene.token_labels["entity:demo:town-guard"].visible and not scene.token_labels["player:player"].visible and not scene.token_labels["entity:demo:practice-opponent"].visible and scene.token_labels["entity:demo:town-guard"].get_instance_id() == pawn_id)
	scene.clear_selection()
	_ok("clearing selection restores the player label", scene.token_labels["player:player"].visible and not scene.token_labels["entity:demo:town-guard"].visible)
	_ok("sample entities remain explicitly named as samples", bridge.current_snapshot.entities[0].name.begins_with("Sample") and bridge.current_snapshot.groundItems[0].name.begins_with("Sample"))
	bridge.send_intent({"kind": "walk", "fromRoomId": "1-14", "exitMove": loader.true_exits("1-14")[0].move})
	_ok("demo occupants stay tethered to their own fixture room", bridge.current_snapshot.currentRoomId != "1-14" and bridge.current_snapshot.entities.is_empty() and bridge.current_snapshot.groundItems.is_empty())
	bridge.start_live("/missing-demo-isolation-config")
	_ok("even a failed live connection clears all sample state", not bridge.mock_mode and bridge.current_snapshot.is_empty() and bridge._demo_session.is_empty())
	bridge.start_mock("fixture", "1-14")
	_ok("ordinary mock restart does not inherit opt-in sample data", bridge.current_snapshot.entities.is_empty() and bridge.current_snapshot.groundItems.is_empty() and bridge.current_snapshot.player == null)
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
