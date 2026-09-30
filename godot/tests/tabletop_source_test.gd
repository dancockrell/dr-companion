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
	var loader: Node = root.get_node("WorldManifestLoader")
	var fixture: Dictionary = bridge.current_snapshot.duplicate(true)
	var destination: String = loader.true_exits(scene.current_room)[0].targetCellId
	scene.select_visible_target("room", destination)
	bridge.mock_mode = false
	bridge._authenticated = true
	for source in [{"kind": "demo", "connected": false}, {"kind": "live", "connected": false}, {}]:
		fixture.source = source
		bridge.current_snapshot = fixture.duplicate(true)
		scene.render_snapshot(fixture)
		scene._connection_changed("authenticated")
		_ok("authenticated %s source cannot enable gameplay controls" % str(source), not scene._actions_available() and scene.travel_button.disabled and scene.exits.get_child(0).disabled)
		if source.get("kind") == "demo":
			_ok("app demo is visibly separated from live transport", scene.source_badge.text.contains("DEMO FROM APP") and scene.status_label.text.contains("no live game"))
		elif source.get("kind") == "live":
			_ok("disconnected live source identifies last-known room truth", scene.status_label.text.contains("Disconnected") and scene.status_label.text.contains("last known room"))
		else:
			_ok("old snapshots with unknown source stay conservative", scene.source_badge.text.contains("SOURCE UNKNOWN") and not scene.can_request_selected_travel())
	fixture.source = {"kind": "live", "connected": true}
	bridge.current_snapshot = fixture.duplicate(true)
	scene.render_snapshot(fixture)
	_ok("only connected live source and authenticated transport enable travel", scene._actions_available() and scene.can_request_selected_travel() and not scene.exits.get_child(0).disabled)
	scene._connection_changed("reconnecting")
	_ok("live source alone cannot bypass disconnected transport", not scene._actions_available() and scene.travel_button.disabled)
	fixture.source.connected = false
	fixture.currentRoomId = ""
	fixture.activeRoom = {}
	fixture.cells = []
	fixture.entities = []
	fixture.groundItems = []
	loader.load_from_snapshot(fixture)
	bridge.current_snapshot = fixture.duplicate(true)
	scene.render_snapshot(fixture)
	_ok("unavailable source clears old geometry and waits honestly", scene.geometry.get_child_count() == 0 and scene.title_label.text == "Waiting for your game" and scene.status_label.text.contains("waiting for your game"))
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
