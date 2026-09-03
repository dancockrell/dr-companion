extends SceneTree
## Camera-control gate: all view choices are presentation-only, explicit, and
## reachable through the same public request signal.

const WorldControls := preload("res://scripts/world_controls.gd")

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var controls: CanvasLayer = WorldControls.new()
	var requested: Array = []
	controls.view_requested.connect(func(view_id): requested.append(view_id))
	controls._activate("world")
	controls._activate("route")
	controls._activate("room")
	controls._activate("not-a-view")
	_ok("every documented view mode emits an explicit request", requested == ["world", "route", "room"])
	_ok("unknown view labels cannot request a camera change", not requested.has("not-a-view"))
	controls.free()
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
