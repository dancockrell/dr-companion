extends RefCounted
## Cosmetic room presentation only. Ground classification controls surface
## treatment; no geometry here creates exits, obstacles, or tactical positions.
# Existing repository art: public/npcs/npc-guard-kaldar-male-0.webp and
# public/npc-defaults/warrior-male/32.webp, copied for this explicit demo only.
const PORTRAITS := {
	"demo:town-guard": "res://assets/demo/sample-guard.webp",
	"demo:practice-opponent": "res://assets/demo/sample-opponent.webp",
}
var _portraits: Dictionary = {}
var _sigils: Dictionary = {}

func surface(width: float, depth: float, kind: String, detailed: bool) -> ArrayMesh:
	var builder := SurfaceTool.new()
	builder.begin(Mesh.PRIMITIVE_TRIANGLES)
	var noise := FastNoiseLite.new()
	noise.seed = 812
	noise.frequency = 0.7
	var segments := 24 if detailed else 1
	for x in range(segments):
		for z in range(segments):
			for corner in [Vector2(0, 0), Vector2(1, 0), Vector2(0, 1), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]:
				var u: float = (float(x) + corner.x) / float(segments)
				var v: float = (float(z) + corner.y) / float(segments)
				var px: float = (u - 0.5) * width
				var pz: float = (v - 0.5) * depth
				var elevation := maxf(-0.018, noise.get_noise_2d(px, pz) * 0.085) if detailed and kind in ["grass", "forest", "swamp", "sand", "snow", "rock", "cave"] else 0.0
				builder.set_uv(Vector2(u, v))
				builder.set_normal(Vector3.UP)
				builder.add_vertex(Vector3(px, elevation + 0.025, pz))
	builder.generate_normals()
	return builder.commit()

func ground_details(parent: Node3D, origin: Vector3, width: float, depth: float, kind: String, seed_value: int) -> int:
	if not kind in ["grass", "forest", "swamp", "farmland"]:
		return 0
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var builder := SurfaceTool.new()
	builder.begin(Mesh.PRIMITIVE_TRIANGLES)
	var colors := [Color("4e5b3b"), Color("68714a"), Color("686849"), Color("384833")]
	# Sparse perimeter growth is decorative ground-type art, never an obstacle.
	for tuft in range(72):
		var angle := rng.randf_range(0, TAU)
		var at := Vector3(rng.randf_range(-0.46, 0.46) * width, 0.05, rng.randf_range(-0.46, 0.46) * depth)
		if tuft % 3 != 0:
			if tuft % 2 == 0:
				at.x = rng.randf_range(0.34, 0.47) * width * (-1 if tuft % 4 == 0 else 1)
			else:
				at.z = rng.randf_range(0.34, 0.47) * depth * (-1 if tuft % 4 == 1 else 1)
		for blade in range(4):
			var offset := Vector3(rng.randf_range(-0.08, 0.08), 0, rng.randf_range(-0.08, 0.08))
			var height := rng.randf_range(0.06, 0.17) * (1.4 if kind == "swamp" else 1.0)
			var span := Vector3(cos(angle + blade), 0, sin(angle + blade)) * 0.026
			builder.set_color(colors[(tuft + blade) % colors.size()])
			builder.set_normal(Vector3.UP)
			builder.add_vertex(at + offset - span)
			builder.add_vertex(at + offset + span)
			builder.add_vertex(at + offset + Vector3(0.03, height, -0.02))
	var node := MeshInstance3D.new()
	node.name = "DecorativeGroundGrowth"
	node.mesh = builder.commit()
	node.position = origin
	node.set_meta("presentation_only", true)
	var material := StandardMaterial3D.new()
	material.vertex_color_use_as_albedo = true
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.roughness = 1.0
	node.material_override = material
	parent.add_child(node)
	return 72

func marker_texture(id: String, demo: bool, player: bool) -> Texture2D:
	# A name/deck never guesses race, gender, equipment, or creature appearance.
	# These existing portraits belong only to explicitly labelled sample IDs.
	if demo and PORTRAITS.has(id):
		if not _portraits.has(id):
			var path: String = PORTRAITS[id]
			if FileAccess.file_exists(path):
				var image := Image.new()
				if image.load_webp_from_buffer(FileAccess.get_file_as_bytes(path)) == OK:
					_portraits[id] = ImageTexture.create_from_image(image)
			if not _portraits.has(id) and ResourceLoader.exists(path):
				var imported = load(path)
				if imported is Texture2D:
					_portraits[id] = imported
		if _portraits.has(id):
			return _portraits[id]
	var key := "player" if player else "unknown"
	if not _sigils.has(key):
		# Original engraved emblems identify a representative marker rather
		# than claiming a photoreal likeness of an unknown live character.
		var svg := '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="376" viewBox="0 0 256 376"><defs><radialGradient id="g"><stop stop-color="#39464b"/><stop offset="1" stop-color="#121b21"/></radialGradient></defs><rect width="256" height="376" fill="url(#g)"/><rect x="14" y="14" width="228" height="348" rx="4" fill="none" stroke="#746d59" stroke-width="2"/><path d="M128 65L194 100V207Q180 254 128 284Q76 254 62 207V100Z" fill="#202c31" stroke="#b3a17a" stroke-width="3"/><path d="M128 96L153 153L179 176L145 198L128 248L111 198L77 176L103 153Z" fill="#b3a17a"/><path d="M128 119V225M97 176H159" stroke="#e3d6b8" stroke-width="3"/><path d="M75 316H181M98 329H158" stroke="#746d59" stroke-width="2"/></svg>'
		if not player:
			svg = svg.replace("#b3a17a", "#87979c").replace("#e3d6b8", "#b6c5c9")
		var image := Image.new()
		image.load_svg_from_string(svg)
		_sigils[key] = ImageTexture.create_from_image(image)
	return _sigils[key]
