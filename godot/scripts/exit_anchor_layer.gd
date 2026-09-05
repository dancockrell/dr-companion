extends Node3D
## Labeled, clickable presentation anchors for exact manifest exits.
##
## An anchor is a request affordance, not a route predictor. It is made only
## from a real current-room exit, emits the exact move text, and is positioned
## toward a loaded target cell when one is known. External exits retain their
## real command label but never receive a fabricated destination direction.

signal exit_requested(from_room_id: String, exit_move: String)

## The script rather than the `ContentRegistry` autoload: the block geometry is
## static, and naming the singleton here is a compile error in any test that
## `preload`s this file, because a `--script` run compiles it before the
## SceneTree's autoloads exist. Measured on exit_anchor_layer_test.gd:
## "Compile Error: Identifier not found: ContentRegistry".
const ContentRegistryScript := preload("res://scripts/content_registry.gd")

## The chevron's own thickness, and the hair of clearance kept between its
## underside and the block's top face so the two do not z-fight where they
## meet. Neither is a board dimension - the board's dimensions belong to the
## manifest and reach this file through ContentRegistry.block_top_y().
const MARKER_THICKNESS_METRES := 0.12
const MARKER_CLEARANCE_METRES := 0.03

## How far a written exit label floats above its own chevron. Measured from the
## marker rather than from the ground, so a label rises with the block for the
## same reason the chevron does.
const LABEL_LIFT_METRES := 0.71

var _current_room_id := ""
var _visible_moves: Dictionary = {}
var _position_states: Dictionary = {}

func render_exits(room_id: String, cells: Dictionary) -> void:
	_clear()
	_current_room_id = room_id
	if room_id.is_empty() or not cells.has(room_id):
		return
	var source: Dictionary = cells[room_id]
	var base := _cell_position(source)
	# Asked once per room, from the registry that draws the block, so every
	# chevron clears the block this room actually has rather than the one the
	# viewer had when this line was written.
	var block_top := ContentRegistryScript.block_top_y(source)
	var exits: Array = source.get("exits", [])
	for index in range(exits.size()):
		var exit: Dictionary = exits[index]
		var move := str(exit.get("move", ""))
		if move.is_empty():
			continue
		var anchor := Node3D.new()
		anchor.name = "Exit_%s" % move
		var placement := _anchor_placement(exit, index, cells)
		anchor.position = base + placement["offset"]
		anchor.set_meta("move", move)
		anchor.set_meta("fromRoomId", room_id)
		anchor.set_meta("positionState", placement["state"])
		add_child(anchor)
		_visible_moves[move] = true
		_position_states[move] = placement["state"]
		_add_visuals(anchor, move, placement["state"] == "resolved", block_top)

func request_exit(from_room_id: String, exit_move: String) -> bool:
	if from_room_id != _current_room_id or not _visible_moves.has(exit_move):
		return false
	exit_requested.emit(from_room_id, exit_move)
	return true

func visible_moves() -> Array:
	return _visible_moves.keys()

func position_state_for(exit_move: String) -> String:
	return str(_position_states.get(exit_move, "absent"))

## A flat chevron lying in the gutter, pointing the way out.
##
## This was an upright cylinder standing at the anchor, and Dan found both
## things wrong with it by playing: "the exits are sometimes hard to find", and
## a marker wants to be "on the edge actually... but not on the block itself,
## it won't be readable".
##
## Upright is the harder half. At a fixed isometric camera a standing post is
## seen nearly end-on, so it covers very few pixels and hides behind whatever
## the room contains. A flat shape lying on the ground keeps its whole area
## turned toward the camera wherever it sits on the board. The wedge also
## carries direction, which a cylinder cannot: it points out of the room, so
## eight of them read as eight ways out rather than eight identical bollards.
##
## And it belongs in the gutter between this block and the next rather than on
## the block, for the reason Dan gave - against room content it is not
## readable. The gutter is empty by construction (CELL_GAP_METRES in
## src/lib/isometric-board-layout.mjs), so a marker there competes with
## nothing, and a mark drawn between two tiles is what a doorway between two
## rooms actually is.
func _add_visuals(anchor: Node3D, move: String, resolved: bool, block_top: float) -> void:
	var marker := MeshInstance3D.new()
	var mesh := PrismMesh.new()
	# Wide across the edge it sits on, shallow along the direction of travel,
	# and thin: a chevron painted on the floor, not an object in the room.
	mesh.size = Vector3(1.2, MARKER_THICKNESS_METRES, 0.9)
	marker.mesh = mesh
	# The prism's point faces +Z. Turn it to face away from the room centre so
	# it reads as an arrow out rather than a wedge lying at some angle.
	var outward := Vector3(anchor.position.x, 0.0, anchor.position.z)
	if outward.length_squared() > 0.0001:
		marker.rotation.y = atan2(outward.x, outward.z)
	# Cyan, not gold.
	#
	# The markers used to be Color(0.95, 0.85, 0.30), which is very nearly the
	# gold of an ordinary street cell, so on the capture they read as part of
	# the block they sat on - findable only once you knew where to look, which
	# is the complaint. Cyan is far from every terrain colour the palette uses
	# (gold street, green grass, brown earth) and matches the blue already
	# outlining the current room, so an exit looks like it belongs to the
	# selection language rather than to the ground.
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.45, 0.85, 1.0) if resolved else Color(0.52, 0.55, 0.58)
	material.emission_enabled = resolved
	material.emission = Color(0.10, 0.35, 0.50) if resolved else Color.BLACK
	marker.material_override = material
	# Clear of the block's top face, not inside it.
	#
	# A marker at 0.08 was buried in the upper half of a block that spans -0.15
	# to +0.15, which is why the first capture showed the chevrons as small
	# clipped slivers. It was raised to a hand-typed 0.24: the block's top plus
	# half this mesh's own thickness plus a hair against z-fighting, worked out
	# on paper from a block height that was itself typed into
	# content_registry.gd.
	#
	# Both halves of that have moved. The block's height is whatever the cell
	# published (1 m for a room, 3 m for an interior cutaway), so there is no
	# single right answer to type, and a chevron pinned at 0.24 would sit inside
	# every block taller than a slab - the same burial, one manifest field
	# later (issue #362). `block_top` is measured off the block the registry
	# draws, so the arithmetic below is the only thing this file has to be
	# right about.
	marker.position.y = block_top + MARKER_THICKNESS_METRES * 0.5 + MARKER_CLEARANCE_METRES
	anchor.add_child(marker)

	# A name only where the shape cannot say it.
	#
	# Every exit used to carry a floating billboard label, and with eight of
	# them around one block the captured board showed "southwest", "go green
	# pond", "west", "south", "north", "east", "southeast" and "go
	# weaponsmith's" overlapping into an illegible crowd - which is the
	# readability problem, not the fix for it.
	#
	# A compass chevron already says which way it points, so it needs no word.
	# An exit like `go weaponsmith's` has no direction to draw and would be an
	# unlabelled wedge at the room's edge meaning nothing, so it keeps its
	# label. That leaves at most a couple of words on a board instead of eight.
	#
	# Nothing is lost for a player who wants the list: the viewer's own
	# "Current exits" panel names every exit including the compass ones, and it
	# is the accessible equivalent the contract requires.
	if not _is_compass(move):
		var label := Label3D.new()
		label.text = move
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.outline_size = 4
		label.font_size = 40
		label.position.y = marker.position.y + LABEL_LIFT_METRES
		anchor.add_child(label)

	var body := StaticBody3D.new()
	body.name = "WalkTarget"
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.5
	shape.shape = sphere
	body.add_child(shape)
	body.input_event.connect(_on_anchor_clicked.bind(_current_room_id, move))
	anchor.add_child(body)

func _on_anchor_clicked(_camera: Node, event: InputEvent, _position: Vector3, _normal: Vector3, _shape_idx: int, from_room_id: String, exit_move: String) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		request_exit(from_room_id, exit_move)

func _anchor_placement(exit: Dictionary, index: int, cells: Dictionary) -> Dictionary:
	var board_anchor = exit.get("boardAnchor")
	if board_anchor is Dictionary:
		return {"offset": Vector3(float(board_anchor.get("x", 0.0)), float(board_anchor.get("y", 0.0)), float(board_anchor.get("z", 0.0))), "state": "resolved"}
	var target_id := str(exit.get("targetCellId", ""))
	if not target_id.is_empty() and cells.has(target_id):
		var from_position := _cell_position(cells[_current_room_id])
		var delta := _cell_position(cells[target_id]) - from_position
		delta.y = 0.0
		if delta.length_squared() > 0.0001:
			return {"offset": delta.normalized() * 2.4, "state": "resolved"}
	# A real but directionless/external exit remains actionable without being
	# assigned a fabricated compass edge. Stack it above the room centre as an
	# explicitly neutral affordance; the accessible exit list remains primary.
	return {"offset": Vector3(0.0, 1.2 + float(index) * 0.35, 0.0), "state": "unpositioned"}

func _clear() -> void:
	for child in get_children():
		child.free()
	_visible_moves.clear()
	_position_states.clear()
	_current_room_id = ""

func _cell_position(cell: Dictionary) -> Vector3:
	var p: Dictionary = cell.get("position", {})
	return Vector3(p.get("x", 0.0), p.get("y", 0.0), p.get("z", 0.0))

## The eight directions a chevron can point. Anything else - `go door`,
## `climb ladder`, `out` - has no compass bearing, so its wedge cannot say
## what it is and it keeps a written name.
const COMPASS_MOVES := [
	"north", "northeast", "east", "southeast",
	"south", "southwest", "west", "northwest",
]

func _is_compass(move: String) -> bool:
	return COMPASS_MOVES.has(move.to_lower())
