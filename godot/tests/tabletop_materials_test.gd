extends SceneTree
const Materials := preload("res://scripts/tabletop_materials.gd")
var checked := 0
var failed := 0

func _initialize() -> void:
	var art := Materials.new()
	var color := Color("557450")
	var grass: StandardMaterial3D = art.terrain("grass", color)
	_ok("terrain retains its confirmed classification palette", grass.albedo_color == color)
	_ok("surface art has a bounded texture footprint and mipmaps", grass.albedo_texture.get_width() == 256 and grass.albedo_texture.get_image().has_mipmaps())
	_ok("identical terrain surfaces reuse one material", art.terrain("grass", color) == grass)
	_ok("palette variants share the same generated surface texture", art.terrain("grass", color.lightened(0.1)).albedo_texture == grass.albedo_texture)
	var water: StandardMaterial3D = art.terrain("water", Color("387e9c"))
	_ok("water and grass have distinct readable surface treatment", water.roughness < grass.roughness and water.albedo_texture.get_image().get_data() != grass.albedo_texture.get_image().get_data())
	var fresh := Materials.new()
	_ok("generated surface art is deterministic across scene reloads", fresh.terrain("grass", color).albedo_texture.get_image().get_data() == grass.albedo_texture.get_image().get_data())
	var unknown: StandardMaterial3D = art.terrain("unclassified", Color("7e735e"))
	_ok("unknown terrain gets neutral grain without a fabricated terrain class", unknown.albedo_color == Color("7e735e") and unknown.roughness == grass.roughness)
	_ok("pawn finish is cached and more tactile than terrain", art.pawn(color) == art.pawn(color) and art.pawn(color).roughness < grass.roughness)
	print("%d checked, %d failed" % [checked, failed])
	quit(1 if failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		failed += 1
		print("FAIL %s" % label)
