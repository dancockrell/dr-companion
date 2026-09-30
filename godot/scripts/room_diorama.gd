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

# A deliberately small verified recipe catalog. These dimensions and placements
# are illustrative composition inside the display footprint, not game coordinates.
const DESCRIBED_RECIPES := {
	"1::Town Green North": {
		"sha256": "f73bd5e2ac6e412c02fb053987ead2987d48a2c87a25f8b4090fcf6301e9aab0",
		"features": ["cobblestones", "privet_hedge"],
		"source": "data/art/room-prompts-priority.json:1::Town Green North:lore (source=description)",
	}
}

func described_features(parent: Node3D, origin: Vector3, width: float, depth: float, cell: Dictionary) -> Array[String]:
	var rendered: Array[String] = []
	var provenance = cell.get("descriptionSource", {})
	if not provenance is Dictionary or width <= 0.0 or depth <= 0.0:
		return rendered
	var source_id := str(provenance.get("sourceId", ""))
	if not DESCRIBED_RECIPES.has(source_id):
		return rendered
	var recipe: Dictionary = DESCRIBED_RECIPES[source_id]
	# Require both trustworthy provenance and the actual source prose. A stale
	# source ID/hash must never apply a recipe to a changed live description.
	if provenance.get("kind", "") != "reference" or provenance.get("game", "") != "DragonRealms":
		return rendered
	if provenance.get("sha256", "") != recipe.sha256 or str(cell.get("description", "")).sha256_text() != recipe.sha256:
		return rendered
	var root := Node3D.new()
	root.name = "DescribedRoomFeatures"
	root.position = origin
	root.set_meta("presentation_only", true)
	root.set_meta("source_id", source_id)
	root.set_meta("source_sha256", recipe.sha256)
	root.set_meta("source_record", recipe.source)
	root.set_meta("arrangement", "representative cosmetic composition; no game coordinates")
	parent.add_child(root)
	var stones := Node3D.new()
	stones.name = "DescribedCobblestones"
	stones.set_meta("feature", "cobblestones")
	root.add_child(stones)
	# Presentation-only irregular flattened stones, in a narrow stretch.
	var rng := RandomNumberGenerator.new()
	rng.seed = 114
	for row in range(3):
		for column in range(12):
			var position := Vector3((float(column) - 5.5) * width * 0.067 + rng.randf_range(-0.006, 0.006) * width, 0.055, depth * (0.23 + float(row) * 0.046) + rng.randf_range(-0.004, 0.004) * depth)
			var tone := Color("555950").lightened(rng.randf_range(0.0, 0.065))
			_cosmetic_cluster(stones, position, Vector3(width * rng.randf_range(0.058, 0.068), 0.065, depth * rng.randf_range(0.039, 0.048)), tone, 8)
	var hedge := Node3D.new()
	hedge.name = "DescribedPrivetHedge"
	hedge.set_meta("feature", "privet_hedge")
	root.add_child(hedge)
	# Overlapping muted leaf masses read as one clipped hedge. Cluster texture
	# is representative art, not additional vegetation facts from the source.
	for section in range(12):
		var height := minf(width, depth) * 0.135
		for cluster in range(3):
			var center := Vector3((float(section) - 5.5) * width * 0.067 + (float(cluster) - 1.0) * width * 0.019, height * (0.42 + float(cluster % 2) * 0.08) + 0.03, depth * (0.409 + float(cluster % 2) * 0.018))
			_cosmetic_cluster(hedge, center, Vector3(width * 0.073, height * 0.94, depth * 0.092), Color("263b23").lightened(rng.randf_range(0.0, 0.04)), 9)
	for feature in recipe.features:
		rendered.append(str(feature))
	root.set_meta("features", rendered.duplicate())
	return rendered

func _cosmetic_cluster(parent: Node3D, position: Vector3, size: Vector3, color: Color, segments: int) -> void:
	var node := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.5
	mesh.height = 1.0
	mesh.radial_segments = segments
	mesh.rings = 4
	node.scale = size
	node.mesh = mesh
	node.position = position
	node.set_meta("presentation_only", true)
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 1.0
	node.material_override = material
	parent.add_child(node)

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
