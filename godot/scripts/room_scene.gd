extends Node2D
## The main scene: what a person sees when the project runs.
##
## Until this file existed the project had no `run/main_scene` at all - the 3D
## WorldRoot was deleted and nothing 2D replaced it, so `godot --path godot`
## opened nothing. This is the replacement, and it is thin on purpose: it picks
## a scene spec, hands it to `RoomComposer`, and points a camera at the result.
## Every decision about what a room looks like lives in the composer and the
## primitive table, so the headless API and the window are looking at the same
## tree rather than at two implementations that will drift.
##
## Which room:
##
##   godot --path godot                            # the checked-in sample
##   DRC_ROOM_SCENE=C:/tmp/room.json godot ...     # any forge Scene dict
##   godot --path godot -- --live-presentation     # the player's own world
##
## The sample under `res://mock/` is a real room out of Lich's DragonRealms map
## database, composed by `forge/`, not a hand-written idealisation of one.
##
## # This script owns the launch mode, and it is the only one that may
##
## `src-tauri/src/viewer.rs` launches the viewer with `-- --live-presentation`
## and has a test that finds *whichever* script under `godot/scripts` reads
## Godot's user arguments and asserts it reads that same flag. It is located by
## behaviour rather than by filename precisely so that renaming or replacing the
## main scene cannot quietly disarm it, and it panics if two scripts read them,
## because two scripts deciding whether the viewer shows the player's world or a
## mock of it is the bug it exists to prevent. That test had been reporting NOT
## CHECKED since the 3D main script was deleted: nothing read the flag, so every
## launch flag the app passed went to nobody.
##
## So the read in `_ready()` is this project's only one - `room_server.gd` takes
## its port from the environment for the same reason - and it must stay a single
## line of the `....has(<const>)` shape, which is what that test's parser reads.
##
## That parser searches the source as plain text, so it counts a mention of the
## function's name in a *comment* exactly as it counts a call. That is why
## neither this paragraph nor `room_server.gd` spells it out: doing so made the
## test report two readers where there was one.

const RoomComposer := preload("res://scripts/room_composer.gd")
const SAMPLE_SPEC := "res://mock/sample_room_scene.json"

## Must equal `viewer::LIVE_FLAG` in `src-tauri/src/viewer.rs`. Nothing but the
## test named above compares the two, because they are in different languages.
const LIVE_PRESENTATION := "--live-presentation"

var _room: Node2D = null
var _report: Dictionary = {}


func _ready() -> void:
	# The one command-line read in this project. Keep it on one line and in
	# this shape; see the class comment.
	var live_requested: bool = OS.get_cmdline_user_args().has(LIVE_PRESENTATION)
	if live_requested:
		# Refusing rather than falling back, deliberately. The app asks for the
		# player's own world with this flag; drawing the checked-in Muspar'i
		# street instead would look exactly like a working viewer, and that
		# precise failure - "every viewer the app had ever started came up in
		# the mock Crossing fixture, showing a world that was not the player's"
		# - is what `src-tauri/src/viewer.rs` was written after. Room sourcing
		# from the live bridge is not built in this lane; saying so is the only
		# honest thing this scene can do about it.
		_show_banner(
			"live presentation requested (%s)\nbut no live room source is wired to this scene yet.\n"
			% LIVE_PRESENTATION
			+ "Nothing is drawn on purpose: showing the checked-in sample here\n"
			+ "would be indistinguishable from a working viewer.",
			Color(1.0, 0.8, 0.45)
		)
		return

	var source := _spec_path()
	var loaded := _load_spec(source)
	if not loaded["ok"]:
		# A window that says why it is empty, rather than an empty window.
		# The failure that produced this project's missing main scene was
		# invisible until somebody tried to run it.
		_show_banner("no room to draw\n%s\n%s" % [source, loaded["error"]], Color(1, 0.45, 0.45))
		push_error("room_scene: %s" % loaded["error"])
		return

	_room = RoomComposer.compose(loaded["spec"])
	add_child(_room)
	_report = RoomComposer.report(_room)

	var camera := Camera2D.new()
	camera.name = "RoomCamera"
	# The composed room is centred on the grid origin, which projects to (0,0).
	camera.position = Vector2(0.0, RoomComposer.CANOPY_LIFT * 0.35)
	camera.zoom = Vector2(1.0, 1.0)
	camera.enabled = true
	add_child(camera)

	var room: Dictionary = _report["room"]
	var counts: Dictionary = _report["counts"]
	var problems: Array = room.get("problems", [])
	_show_banner(
		"room %s  (%s)\nground %s / boundary %s / canopy %s\n%d ground, %d boundary, %d openings, %d placements\n%s"
		% [
			str(room.get("room_id", "?")), str(room.get("archetype", "?")),
			str(room.get("ground", "?")), str(room.get("boundary", "?")), str(room.get("canopy", "?")),
			int(counts["ground"]), int(counts["boundary"]), int(counts["opening"]), int(counts["placement"]),
			("no problems" if problems.is_empty() else "%d problem(s): %s" % [problems.size(), str(problems[0])]),
		],
		Color(0.85, 0.88, 0.92) if problems.is_empty() else Color(1.0, 0.8, 0.45)
	)


## `DRC_ROOM_SCENE`, else the checked-in sample. In the environment rather than
## on the command line so this script keeps exactly one command-line read; see
## the class comment.
func _spec_path() -> String:
	if OS.has_environment("DRC_ROOM_SCENE"):
		var named := OS.get_environment("DRC_ROOM_SCENE")
		if named != "":
			return named
	return SAMPLE_SPEC


## Read and parse, saying which of the two failed. "Missing file" and "bad
## JSON" want different things from whoever is standing there.
func _load_spec(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"ok": false, "error": "no such file"}
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		return {"ok": false, "error": "file is empty (or unreadable: %d)" % FileAccess.get_open_error()}
	var parsed = JSON.parse_string(text)
	if not (parsed is Dictionary):
		return {"ok": false, "error": "not a JSON object"}
	return {"ok": true, "spec": parsed as Dictionary}


func _show_banner(text: String, color: Color) -> void:
	# Also to stdout. A `--headless --quit-after` run of the project draws
	# nothing anybody can look at, so without this there is no way to tell
	# "composed a room" from "loaded a scene that did nothing" - which is the
	# state this project was actually in before `run/main_scene` was set.
	print(text)
	var layer := CanvasLayer.new()
	layer.name = "HUD"
	var label := Label.new()
	label.name = "Banner"
	label.text = text
	label.position = Vector2(12.0, 10.0)
	label.add_theme_color_override("font_color", color)
	layer.add_child(label)
	add_child(layer)


## The same structural report the headless API returns, for anything driving
## this scene in-process. One report, one composer, no second opinion.
func report() -> Dictionary:
	return _report
