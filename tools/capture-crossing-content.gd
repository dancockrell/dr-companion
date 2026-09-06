extends SceneTree
## Captures the real WorldRoot, not a second renderer or a simulated screenshot.
func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	root.size = Vector2i(1600, 1000)
	var world: Node3D = load("res://scenes/WorldRoot.tscn").instantiate()
	root.add_child(world)
	current_scene = world
	await create_timer(2).timeout
	var camera = world.get_node("CameraDirector")
	var output := ProjectSettings.globalize_path("res://../docs/verification")
	for entry in [["1-14", "north"], ["1-15", "bower"], ["1-17", "oak"], ["1-225", "armory-approach"], ["1-379", "bazaar"], ["1-191", "weaponsmith"], ["1-371", "supply-stand"]]:
		# The normal viewer's mock transport confirms the room; the same scene
		# mounts through its normal detail-window path.
		var bridge = root.get_node("BridgeClient")
		bridge.start_mock("crossing-mock", entry[0])
		await create_timer(1).timeout
		camera.size = 12.0
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output.path_join("crossing-native-" + entry[1] + ".png"))
	world.focus_world_view()
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png(output.path_join("crossing-native-world.png"))
	print("Captured seven actual viewer room views and full-zone overview")
	quit()
