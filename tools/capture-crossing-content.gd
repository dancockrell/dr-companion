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
	var requested := OS.get_cmdline_user_args()
	assert(not ("--aa" in requested and "--no-aa" in requested), "Choose one anti-aliasing mode")
	if "--no-aa" in requested:
		root.msaa_3d = Viewport.MSAA_DISABLED
		root.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	if "--aa" in requested:
		root.msaa_3d = Viewport.MSAA_4X
		root.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA
	var unshadowed := "--unshadowed" in requested
	if unshadowed:
		world.get_node("Sun").shadow_enabled = false
	var suffix := "-unshadowed" if unshadowed else ""
	if "--no-ao" in requested:
		world.get_node("TabletopEnvironment").environment.ssao_enabled = false
		suffix += "-no-ao"
	var captured: Array = []
	if "--aa" in requested:
		suffix += "-aa"
	if "--no-aa" in requested:
		suffix += "-no-aa"
	if "--no-normal" in requested:
		suffix += "-no-normal"
	if "--flat" in requested:
		suffix += "-flat"
	if "--no-textures" in requested:
		suffix += "-no-textures"
	var entries: Array = [["1-194", "bellows-room"], ["1-193", "armory-workroom"], ["1-32", "trollferry-quay"], ["1-14", "north"], ["1-15", "bower"], ["1-17", "oak"], ["1-225", "armory-approach"], ["1-379", "bazaar"], ["1-191", "weaponsmith"], ["1-192", "armory-interior"], ["1-371", "supply-stand"], ["1-7", "herbalist"], ["1-22", "residences"], ["1-95", "bathhouse"], ["1-100", "cottage"], ["1-112", "stable"]]
	# Any real manifest room can be reviewed without editing this script per room.
	var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/crossing/world.json"))
	for id in requested:
		var listed := false
		for entry in entries:
			listed = listed or entry[0] == id
		if not listed:
			for cell in manifest.cells:
				if cell.id == id:
					entries.append([id, "room-" + id])
	for entry in entries:
		if not requested.is_empty() and not entry[0] in requested:
			continue
		captured.append(entry[0])
		# The normal viewer's mock transport confirms the room; the same scene
		# mounts through its normal detail-window path.
		var bridge = root.get_node("BridgeClient")
		bridge.start_mock("crossing-mock", entry[0])
		await create_timer(1).timeout
		if "--no-normal" in requested:
			for mesh in world.find_children("*", "MeshInstance3D", true, false):
				if mesh.material_override is StandardMaterial3D:
					var material: StandardMaterial3D = mesh.material_override.duplicate()
					material.normal_enabled = false
					mesh.material_override = material
		camera.size = 36.0
		if "--no-textures" in requested:
			for mesh in world.find_children("*", "MeshInstance3D", true, false):
				for surface in mesh.mesh.get_surface_count():
					var original = mesh.get_active_material(surface)
					if original is StandardMaterial3D:
						var plain: StandardMaterial3D = original.duplicate()
						plain.albedo_texture = null
						plain.normal_enabled = false
						mesh.set_surface_override_material(surface, plain)
				mesh.material_override = null
		if "--flat" in requested:
			var flat := StandardMaterial3D.new()
			flat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			flat.albedo_color = Color("#ad9c80")
			for mesh in world.find_children("*", "MeshInstance3D", true, false):
				mesh.material_override = flat
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output.path_join("crossing-native-" + entry[1] + suffix + ".png"))
	for id in requested:
		assert(id in ["--unshadowed", "--no-ao", "--no-normal", "--flat", "--no-textures", "--aa", "--no-aa", "world"] or id in captured, "Unknown capture room: " + id)
	if requested.is_empty() or "world" in requested:
		world.focus_world_view()
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output.path_join("crossing-native-world" + suffix + ".png"))
	print("Captured actual viewer rooms: ", captured)
	quit()
