extends SceneTree
## Exercise the public seams used by real picking, buttons, and ordered events.
var checked := 0
var failed := 0

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	# Headless defaults to a 64 px OS window; use the project canvas for layout QA.
	root.size = Vector2i(1280, 720)
	var scene: Node3D = load("res://scenes/tabletop.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	await process_frame
	var panels_fit := true
	for child in scene.get_children():
		if child is CanvasLayer:
			for panel in child.get_children():
				var rect: Rect2 = panel.get_global_rect()
				panels_fit = panels_fit and rect.position.x >= 0 and rect.position.y >= 0 and rect.end.x <= root.get_visible_rect().size.x and rect.end.y <= root.get_visible_rect().size.y
	_ok("HUD panels and footer fit inside the canvas", panels_fit)
	var bridge: Node = root.get_node("BridgeClient")
	var loader: Node = root.get_node("WorldManifestLoader")
	var sender: Node = root.get_node("IntentSender")
	var player: Node = root.get_node("EventPlayer")
	var intents: Array = []
	sender.intent_created.connect(func(intent): intents.append(intent))
	var original: Dictionary = bridge.current_snapshot.duplicate(true)
	var fixture: Dictionary = original.duplicate(true)
	fixture.activeRoom.description = "A confirmed green with a well-kept path."
	fixture.player = {"health": 0.75, "roundtime": 0, "cannotAct": false}
	fixture.entities = [{"id": "guard-1", "roomId": scene.current_room, "name": "Town guard", "deck": "allied", "tactical": {"range": "melee", "enrichedAgeSeconds": 2}}, {"id": "away", "roomId": "unknown", "name": "Elsewhere"}]
	fixture.groundItems = [{"id": "coin-1", "roomId": scene.current_room, "name": "A copper coin"}]
	bridge.current_snapshot = fixture.duplicate(true)
	scene.render_snapshot(fixture)
	await physics_frame
	await physics_frame
	_ok("confirmed room description is visible", scene.room_description.text == fixture.activeRoom.description)
	var timed: Dictionary = fixture.duplicate(true)
	timed.player.roundtime = 5
	scene.render_snapshot(timed)
	scene.roundtime_started_ms = Time.get_ticks_msec() - 4000
	var measured_start: int = scene.roundtime_started_ms
	timed.activeRoom.description = "A later description, with the same status measurement."
	scene.render_snapshot(timed)
	_ok("unrelated snapshots preserve the measured roundtime deadline", scene.roundtime_started_ms == measured_start and scene.player_summary.text.contains("ROUND TIME 1.0s"))
	scene.roundtime_started_ms = Time.get_ticks_msec() - 6000
	scene.render_snapshot(timed)
	_ok("expired roundtime does not restart on a repeated snapshot", scene.player_summary.text.contains("READY"))
	timed.player.roundtimeObservedAt = Time.get_unix_time_from_system() * 1000.0
	scene.render_snapshot(timed)
	_ok("a new source observation restarts an equal-valued roundtime", scene.player_summary.text.contains("ROUND TIME 5.0s"))
	timed.player.roundtimeObservedAt -= 4000.0
	scene.render_snapshot(timed)
	_ok("late source observations subtract their delivery age", scene.player_summary.text.contains("ROUND TIME 1.0s"))
	scene.render_snapshot(fixture)
	_ok("board has pick bodies for rooms, occupants, items, and player", scene.pick_bodies.has("room:1-14") and scene.pick_bodies.has("entity:guard-1") and scene.pick_bodies.has("item:coin-1") and scene.pick_bodies.has("player:player"))
	_ok("absent occupants never get pick bodies", not scene.pick_bodies.has("entity:away"))
	var token: Vector3 = scene.token_positions["entity:guard-1"] + Vector3(0, 0.55, 0)
	_ok("real ray picking selects the confirmed miniature", scene.pick_at(scene.camera.unproject_position(token)) and scene.selected_kind == "entity" and scene.selected_id == "guard-1")
	_ok("token picking issues only a read-only inspect intent", intents.size() == 1 and intents[0].kind == "inspect-entity")
	_ok("local inspector displays tactical facts", scene.selection_description.text.contains("Range: melee") and is_instance_valid(scene.selection_ring))
	_ok("floor item selection issues the supported inspect intent", scene.select_visible_target("item", "coin-1") and intents[-1].kind == "inspect-ground-item")
	_ok("stale and foreign targets cannot be selected", not scene.select_visible_target("entity", "away") and not scene.select_visible_target("item", "missing") and not scene.select_visible_target("room", "imaginary"))
	var before: Dictionary = bridge.current_snapshot.duplicate(true)
	var count := intents.size()
	var destination: String = loader.true_exits(scene.current_room)[0].targetCellId
	_ok("a visible tile can be selected without movement", scene.select_visible_target("room", destination) and intents.size() == count and bridge.current_snapshot == before)
	_ok("demo destination travel is visibly disabled and cannot teleport", scene.travel_button.visible and scene.travel_button.disabled and not scene.request_selected_travel() and bridge.current_snapshot == before)
	scene.set_view("route")
	_ok("route mode explains its authority boundary", scene.mode_hint.text.contains("not a confirmed route") and scene.mode_hint.text.contains("Lich"))
	_ok("view modes visibly indicate the active selection", scene.mode_buttons.route.button_pressed and not scene.mode_buttons.room.button_pressed)
	bridge.mock_mode = false
	scene._connection_changed("authenticated")
	_ok("live destination enables explicit travel request", not scene.travel_button.disabled and scene.request_selected_travel() and intents[-1] == {"kind": "travel-to-room", "roomId": destination})
	_ok("requesting travel never speculates a room or player update", scene.current_room == before.currentRoomId and bridge.current_snapshot == before)
	scene._connection_changed("reconnecting-1")
	count = intents.size()
	_ok("disconnect blocks destination requests", not scene.request_selected_travel() and scene.travel_button.disabled and intents.size() == count)
	var disconnected: Dictionary = fixture.duplicate(true)
	disconnected.entities.append({"id": "guard-2", "roomId": scene.current_room, "name": "Second guard"})
	scene.render_snapshot(disconnected)
	var all_disabled := true
	for button in scene.exits.get_children():
		all_disabled = all_disabled and button.disabled
	_ok("new exit buttons stay disabled after a disconnected rebuild", all_disabled)
	_ok("stale button callbacks cannot bypass disconnected controls", not scene.request_visible_exit(scene.current_room, loader.true_exits(scene.current_room)[0].move))
	bridge.mock_mode = true
	scene._connection_changed("demo")
	scene.render_snapshot(fixture)
	scene.set_view("room")
	scene.select_visible_target("entity", "guard-1")
	var removed: Dictionary = fixture.duplicate(true)
	removed.entities = []
	scene.render_snapshot(removed)
	_ok("disappearing entities clear selection and ring", scene.selected_id.is_empty() and not is_instance_valid(scene.selection_ring))
	scene.render_snapshot(fixture)
	var unknown: Dictionary = fixture.duplicate(true)
	unknown.currentRoomId = "not-in-manifest"
	scene.render_snapshot(unknown)
	_ok("unknown room clears all board geometry", scene.geometry.get_child_count() == 0 and scene.board_signature.is_empty())
	scene.render_snapshot(fixture)
	_ok("A to unknown to identical A restores geometry", scene.geometry.get_child_count() > 0 and scene.rendered_ids.has(fixture.currentRoomId))
	player.reset_to(0)
	var attack := {"sequence": 1, "roomId": scene.current_room, "kind": "attack", "sourceEntityId": "guard-1", "authoritativeText": "The guard swings."}
	var hit := {"sequence": 2, "roomId": scene.current_room, "kind": "hit", "targetEntityId": "guard-1", "authoritativeText": "A blow lands."}
	before = scene.snapshot.duplicate(true)
	player.offer(hit)
	_ok("out-of-order hits do not display before the attack", scene.event_history.is_empty() and scene.pending_effects.is_empty())
	player.offer(attack)
	_ok("confirmed attack then hit appear in exact event order", scene.event_history.size() == 2 and scene.event_history[0].sequence == 1 and scene.event_history[1].sequence == 2)
	_ok("event feed preserves authoritative text", scene.event_label.text.contains("The guard swings.") and scene.event_label.text.contains("A blow lands."))
	player.offer(hit)
	_ok("duplicate deliveries do not repeat feedback", scene.event_history.size() == 2)
	scene._process(0)
	_ok("visual feedback starts with the ordered attack", scene.last_effect_sequence == 1 and scene.effects.get_child_count() == 2)
	scene._process(0.5)
	_ok("hit feedback plays after attack", scene.last_effect_sequence == 2)
	_ok("combat cues never invent health or world mutations", scene.snapshot == before and scene.player_summary.text.contains("75% health"))
	player.offer({"sequence": 3, "roomId": "elsewhere", "kind": "death", "authoritativeText": "Elsewhere only."})
	_ok("events from other rooms stay off this board", scene.event_history.size() == 2 and not scene.event_label.text.contains("Elsewhere"))
	scene._reconnected(fixture)
	_ok("reconnect clears transient feedback without replaying history", scene.event_history.is_empty() and scene.pending_effects.is_empty() and scene.last_effect_sequence == 0)
	# Route planning must include farther known graph cells than room detail.
	var graph := fixture.duplicate(true)
	graph.cells = []
	for index in range(8):
		graph.cells.append({"id": "cell-%d" % index, "title": "Room %d" % index, "position": {"x": index * 6, "y": 0, "z": 0}, "exits": [{"move": "east", "targetCellId": "cell-%d" % (index + 1)}] if index < 7 else []})
	graph.currentRoomId = "cell-0"
	graph.entities = []
	graph.groundItems = []
	loader.load_from_snapshot(graph)
	scene.render_snapshot(graph)
	scene.set_view("room")
	var room_count: int = scene.rendered_ids.size()
	scene.set_view("route")
	_ok("route planning shows a broader confirmed graph than room detail", scene.rendered_ids.size() > room_count and scene.rendered_ids.has("cell-5"))
	scene.set_view("world")
	scene.select_visible_target("room", "cell-7")
	scene.set_view("route")
	_ok("route view retains a distant selected destination", scene.rendered_ids.has("cell-7") and scene.selected_id == "cell-7")
	_ok("camera-only changes never create travel requests", intents.size() == count + 1)
	bridge.mock_mode = false
	scene._connection_changed("authenticated")
	_ok("visible distant selection has an enabled live travel action", scene.travel_button.visible and not scene.travel_button.disabled)
	scene.set_view("room")
	_ok("switching to room view hides and disables off-board travel", not scene.rendered_ids.has("cell-7") and not scene.travel_button.visible and scene.travel_button.disabled and not scene.can_request_selected_travel())
	_ok("off-board selection explains how to recover the destination", scene.selection_description.text.contains("Switch to Route or World"))
	_ok("a stale travel callback cannot act on an off-board room", not scene.request_selected_travel())
	scene.set_view("route")
	_ok("returning to route restores the visible destination action", scene.rendered_ids.has("cell-7") and scene.travel_button.visible and not scene.travel_button.disabled)
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
