extends RefCounted
## Original, deterministic surface art. These small repeating textures decorate
## confirmed board cells; they contain no props, routes, elevation, or game state.
const TEXTURE_SIZE := 96
var textures: Dictionary = {}
var materials: Dictionary = {}

func terrain(kind: String, color: Color) -> StandardMaterial3D:
	var key := "terrain:%s:%s" % [kind, color.to_html()]
	if materials.has(key):
		return materials[key]
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.albedo_texture = surface_texture(kind)
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	material.roughness = 0.93
	if kind == "water":
		material.roughness = 0.3
		material.metallic = 0.12
	elif kind in ["interior", "street", "rock"]:
		material.roughness = 0.76
	materials[key] = material
	return material

func pawn(color: Color) -> StandardMaterial3D:
	var key := "pawn:" + color.to_html()
	if materials.has(key):
		return materials[key]
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.32
	material.metallic = 0.25
	materials[key] = material
	return material

func surface_texture(kind: String) -> ImageTexture:
	if textures.has(kind):
		return textures[kind]
	var noise := FastNoiseLite.new()
	noise.seed = 417 + int(kind.hash() % 10000)
	noise.frequency = 0.14
	var image := Image.create(TEXTURE_SIZE, TEXTURE_SIZE, false, Image.FORMAT_RGBA8)
	for y in range(TEXTURE_SIZE):
		for x in range(TEXTURE_SIZE):
			var fine := noise.get_noise_2d(x * 3.0, y * 3.0)
			var broad := noise.get_noise_2d(x * 0.5, y * 0.5)
			var value := 0.93 + fine * 0.075 + broad * 0.06
			match kind:
				"street", "rock", "cave":
					# A staggered stone finish, not a second movement grid.
					var row := y / 24
					if y % 24 == 0 or (x + (row % 2) * 24) % 48 == 0:
						value -= 0.15
				"interior":
					value += sin(float(y) * 1.8 + broad * 4.0) * 0.035
					if x % 24 == 0:
						value -= 0.16
				"water":
					value = 0.91 + sin(float(y) * 0.4 + sin(float(x) * 0.15)) * 0.07 + fine * 0.025
				"grass", "forest", "swamp", "farmland":
					value += noise.get_noise_2d(x * 5.0, y * 1.5) * 0.08
				"snow", "sand":
					value = 0.96 + fine * 0.04 + broad * 0.025
			image.set_pixel(x, y, Color(value, value, value, 1.0))
	image.generate_mipmaps()
	var texture := ImageTexture.create_from_image(image)
	textures[kind] = texture
	return texture
