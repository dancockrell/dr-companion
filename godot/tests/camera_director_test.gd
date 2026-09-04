extends SceneTree
## Fixed-isometric camera gate: framing scale may change, orientation may not.

const CameraDirector := preload("res://scripts/camera_director.gd")

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var camera: Camera3D = CameraDirector.new()
	camera._ready()
	_ok("the board uses orthographic projection", camera.projection == Camera3D.PROJECTION_ORTHOGONAL)

	camera._apply_immediate(camera.Mode.WORLD, Vector3.ZERO)
	var world_basis := camera.transform.basis
	var world_size := camera.size
	_ok("the fixed heading uses equal X and Z offsets", is_equal_approx(absf(camera.transform.origin.x), absf(camera.transform.origin.z)))

	camera._apply_immediate(camera.Mode.ROOM, Vector3(12.0, 0.0, -7.0))
	_ok("world and room modes retain one board orientation", camera.transform.basis.is_equal_approx(world_basis))
	_ok("room mode changes framing scale instead of perspective", camera.size < world_size and camera.projection == Camera3D.PROJECTION_ORTHOGONAL)

	camera.free()
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
