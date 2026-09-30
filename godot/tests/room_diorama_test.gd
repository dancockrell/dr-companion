extends SceneTree
const Diorama := preload("res://scripts/room_diorama.gd")
var checked := 0
var failed := 0

func _initialize() -> void:
	var art := Diorama.new()
	var surface := art.surface(4.4, 4.4, "grass", true)
	_ok("room art creates a continuous detailed surface", surface.get_surface_count() == 1 and surface.surface_get_array_len(0) > 100)
	var normals = surface.surface_get_arrays(0)[Mesh.ARRAY_NORMAL]
	var faces_up := true
	for normal in normals:
		faces_up = faces_up and normal.y > 0.9
	_ok("terrain front faces and generated normals face the viewing hemisphere", faces_up)
	_ok("sculpted surface stays above its earth substrate", surface.get_aabb().position.y > 0.0)
	_ok("surface art stays within the authoritative footprint", surface.get_aabb().size.x <= 4.401 and surface.get_aabb().size.z <= 4.401)
	_ok("unknown terrain receives no invented sculpting", is_zero_approx(art.surface(4.4, 4.4, "unknown", true).get_aabb().size.y))
	var parent := Node3D.new()
	_ok("grass supports bounded decorative vegetation", art.ground_details(parent, Vector3.ZERO, 4.4, 4.4, "grass", 123) == 72 and parent.get_child_count() == 1)
	_ok("decorative growth has no gameplay collider", parent.get_child(0) is MeshInstance3D and parent.get_child(0).get_meta("presentation_only") == true)
	_ok("unclassified ground gains no invented vegetation", art.ground_details(parent, Vector3.ZERO, 4.4, 4.4, "unknown", 123) == 0 and parent.get_child_count() == 1)
	var demo: Texture2D = art.marker_texture("demo:town-guard", true, false)
	var live: Texture2D = art.marker_texture("demo:town-guard", false, false)
	_ok("sample portraits are restricted to explicit demo mode", demo != live and demo.get_image().get_data() != live.get_image().get_data())
	_ok("unknown live identities share an honest representative sigil", live == art.marker_texture("unidentified-creature", false, false))
	_ok("player marker is distinct without inventing a likeness", art.marker_texture("player", false, true) != live)
	parent.free()
	print("%d checked, %d failed" % [checked, failed])
	quit(1 if failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		failed += 1
		print("FAIL %s" % label)
