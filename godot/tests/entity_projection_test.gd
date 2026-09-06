extends SceneTree
## Snapshot-token contract gate, runnable headlessly:
##
##   Godot_v4.7.2-stable_win64_console.exe --headless --path godot \
##     --script res://tests/entity_projection_test.gd
##
## This test deliberately supplies a small fixture instead of pretending the
## mock bridge has a live room population.  It proves the renderer's only
## spatial rule: confirmed entities/items appear under their reported room's
## tether; unknown rooms, missing identifiers, and stale data do not render.
##
## # And the height, tested where the wrong answer is available
##
## The two rooms below publish blocks of deliberately different heights - 0.3 m,
## which is what the placeholder used to be, and 3 m, which is what an
## `interior-cutaway` publishes today. A token's height is the top face of its
## own cell's block plus the lift its spawn point carries, so a viewer that
## typed one number instead would pass on one room and fail on the other. That
## is the shape `exit_anchor_layer_test.gd` already uses for the exit chevrons,
## and its absence here is why issue #373 survived: this test never varied
## `footprint.height`, so `0.4`, `0.4` and `-0.32` typed into
## `entity_projection_layer.gd` looked correct for as long as every block was a
## slab.
##
## Both expected heights below are computed from the fixture's own published
## footprint, never written out, so a test that agreed with the viewer by
## having the same number typed into it cannot exist.

const LAYER_SCRIPT := preload("res://scripts/entity_projection_layer.gd")

## The block each room publishes. Different on purpose: see the header.
## Deliberately not the board's real 4.4 m plan: this test is about height, and
## `tools/board-geometry-drift-test.mjs` refuses the published block dimension
## as a literal anywhere under godot/, tests included.
const BLOCK_PLAN_METRES := 2.0
const SHORT_BLOCK_METRES := 0.3
const TALL_BLOCK_METRES := 3.0

## # And the token's own size, which is the other half of the same rule
##
## Until issue #385 this fixture published a lift and nothing else, and the
## viewer built each token out of dimensions typed into
## `entity_projection_layer.gd`. Two statements of one rule in two languages:
## changing `sphere.height` there from 0.68 to 1.60 left the hostile token
## 0.46 m inside the block it stands on, and this test, the drift scan and the
## fixture contract test all stayed green, because none of them could see both
## numbers at once.
##
## So the board publishes each token's mesh beside its lift, the viewer builds
## the mesh the cell published, and this fixture states each token's *height*
## only. Every lift below is derived from that height here, exactly as
## `tokenLiftFor()` derives it in the layout module, so no assertion in this file
## can agree with the viewer by having the same number typed into both.
const PLAYER_TOKEN_HEIGHT_METRES := 0.94
const OCCUPANT_TOKEN_HEIGHT_METRES := 0.8
const HOSTILE_TOKEN_HEIGHT_METRES := 0.68
const ITEM_TOKEN_HEIGHT_METRES := 0.12

## The height the chooser below republishes the hostile token at. Deliberately
## more than twice its own, and more than the whole of the short block, so a
## viewer that kept a size of its own cannot land on the face by luck.
const HOSTILE_REPUBLISHED_HEIGHT_METRES := 1.6

## A token is centred on its anchor, so it stands half its own height above the
## face. One expression, used for the fixture's anchors and for what is expected
## of them; a lift written out separately would be this test forking the rule it
## is here to check.
const PLAYER_LIFT_METRES := PLAYER_TOKEN_HEIGHT_METRES * 0.5
const OCCUPANT_LIFT_METRES := OCCUPANT_TOKEN_HEIGHT_METRES * 0.5
const HOSTILE_LIFT_METRES := HOSTILE_TOKEN_HEIGHT_METRES * 0.5
const ITEM_LIFT_METRES := ITEM_TOKEN_HEIGHT_METRES * 0.5

## Room-scale tolerance. The numbers under test differ by whole metres between
## the two rooms, so nothing here turns on floating-point noise.
const TOLERANCE_METRES := 0.0005

var _checked := 0
var _failed := 0

## One published spawn point, its lift derived from the height beside it.
func _spawn(id: String, role: String, x: float, z: float, socket: String, token: Dictionary) -> Dictionary:
	return {
		"id": id,
		"role": role,
		"anchor": {"x": x, "y": float(token["height"]) * 0.5, "z": z},
		"rigSocket": socket,
		"token": token,
	}

func _spawn_points(hostile_height: float) -> Array:
	return [
		_spawn("player", "player", 0.0, 0.0, "humanoid-root", {"shape": "capsule", "height": PLAYER_TOKEN_HEIGHT_METRES, "radius": 0.28}),
		_spawn("occupant", "occupant", 1.15, 0.75, "humanoid-root", {"shape": "cylinder", "height": OCCUPANT_TOKEN_HEIGHT_METRES, "topRadius": 0.18, "bottomRadius": 0.38}),
		_spawn("hostile", "hostile", -1.35, -1.15, "creature-root", {"shape": "sphere", "height": hostile_height, "radius": hostile_height * 0.5}),
		_spawn("item", "item", 1.55, 1.55, "item-root", {"shape": "box", "height": ITEM_TOKEN_HEIGHT_METRES, "width": 0.28, "depth": 0.28}),
	]

func _board(height: float, hostile_height: float = HOSTILE_TOKEN_HEIGHT_METRES) -> Dictionary:
	return {
		"footprint": {"width": BLOCK_PLAN_METRES, "depth": BLOCK_PLAN_METRES, "height": height},
		"selectionBounds": {"width": BLOCK_PLAN_METRES, "depth": BLOCK_PLAN_METRES, "height": height},
		"spawnPoints": _spawn_points(hostile_height),
	}

## How tall the mesh a token is actually drawn as is. Read off the primitive the
## viewer built rather than off what the board published, which is the point:
## these two agreeing is the thing being checked, so the measurement may not
## take the published number as its answer.
func _mesh_height(mesh: Mesh) -> float:
	if mesh is BoxMesh:
		return (mesh as BoxMesh).size.y
	if mesh is CapsuleMesh:
		return (mesh as CapsuleMesh).height
	if mesh is CylinderMesh:
		return (mesh as CylinderMesh).height
	if mesh is SphereMesh:
		return (mesh as SphereMesh).height
	return 0.0

func _initialize() -> void:
	print("-- DR Companion 3D entity projection gate --")
	var world := Node3D.new()
	root.add_child(world)
	var room_one := Node3D.new()
	room_one.name = "Cell_crossing-1"
	room_one.set_meta("board", _board(SHORT_BLOCK_METRES))
	world.add_child(room_one)
	var room_two := Node3D.new()
	room_two.name = "Cell_crossing-2"
	room_two.set_meta("board", _board(TALL_BLOCK_METRES))
	world.add_child(room_two)
	# A third cell whose board is complete except that it places nothing. The
	# degraded path has to be reachable on purpose, or nobody can show it was
	# fixed: a token here gets no lift at all and sits with its origin exactly
	# on the top face, which is deliberately not a plausible-looking guess.
	var room_three := Node3D.new()
	room_three.name = "Cell_crossing-3"
	room_three.set_meta("board", {
		"footprint": {"width": BLOCK_PLAN_METRES, "depth": BLOCK_PLAN_METRES, "height": TALL_BLOCK_METRES},
		"selectionBounds": {"width": BLOCK_PLAN_METRES, "depth": BLOCK_PLAN_METRES, "height": TALL_BLOCK_METRES},
		"spawnPoints": [],
	})
	world.add_child(room_three)
	var layer: Node3D = LAYER_SCRIPT.new()
	world.add_child(layer)

	var rooms := {"crossing-1": room_one, "crossing-2": room_two, "crossing-3": room_three}
	var short_top := SHORT_BLOCK_METRES * 0.5
	var tall_top := TALL_BLOCK_METRES * 0.5
	var fixture := {
		"currentRoomId": "crossing-1",
		"player": {"cannotAct": true, "roundtime": 4, "health": 0.45, "situation": ["stunned"]},
		"entities": [
			{"id": "creature-1", "roomId": "crossing-1", "name": "a troll", "deck": "hostile", "tactical": {"range": "melee", "target": "you", "disengaged": false, "dead": false, "statuses": ["stunned"], "conditions": [], "enrichedAgeSeconds": 8}},
			{"id": "person-1", "roomId": "crossing-2", "name": "Kethrai", "deck": "people"},
			# Every token kind on both blocks, so the bottom-face check below has
			# a capsule, a cylinder, a sphere and a box to measure on a 0.3 m
			# block and on a 3 m one. A viewer holding a size of its own passes on
			# neither, and one holding a lift of its own passes on at most one.
			{"id": "person-short", "roomId": "crossing-1", "name": "Ilvane", "deck": "people"},
			{"id": "creature-2", "roomId": "crossing-2", "name": "a second troll", "deck": "hostile"},
			{"id": "unknown-room", "roomId": "crossing-404", "name": "nothing", "deck": "hostile"},
			{"id": "", "roomId": "crossing-1", "name": "missing id", "deck": "people"},
			{"id": "unplaced-1", "roomId": "crossing-3", "name": "Nobody", "deck": "people"},
		],
		"groundItems": [
			{"id": "item-1", "roomId": "crossing-1", "name": "a rusty dagger"},
			{"id": "item-2", "roomId": "crossing-2", "name": "a dropped lantern"},
			{"id": "unknown-item", "roomId": "crossing-404", "name": "not in this world"},
		]
	}
	layer.project_snapshot(fixture, rooms)
	_ok("confirmed player plus snapshot entries with a known room and stable id render", layer.visible_ids().size() == 8)
	_ok("the player's own token stays at the confirmed current room node", layer.tether_room_for("player:self") == "crossing-1")
	_ok("the player token carries the bridge-decided action lock", layer.token_for("player:self").get_meta("combatState") == "CANNOT ACT")
	_ok("the player occupies the manifest's rig-ready spawn point", layer.local_slot_for("player:self").is_equal_approx(Vector3(0.0, short_top + PLAYER_LIFT_METRES, 0.0)))
	_ok("a hostile token stays tethered to its reported room", layer.tether_room_for("creature-1") == "crossing-1")
	_ok("a person token stays tethered to its reported room", layer.tether_room_for("person-1") == "crossing-2")
	_ok("a ground-item token stays tethered to its reported room", layer.tether_room_for("item-1") == "crossing-1")
	_ok("an unknown room never creates an entity token", layer.tether_room_for("unknown-room") == "")
	_ok("each confirmed entity token has an inspect hit target", layer.token_for("creature-1").has_node("InspectTarget"))
	_ok("entity token carries the shared tactical freshness policy", layer.token_for("creature-1").get_meta("assessmentState") == "fresh")
	_ok("entity token visibly carries one assessment-age ring", layer.token_for("creature-1").has_node("AssessmentRing"))
	_ok("entity token carries the exact projected tactical summary", String(layer.token_for("creature-1").get_meta("tacticalSummary")).contains("melee"))
	# Horizontal, because the two tokens now stand on blocks of different
	# heights and a 3-D length would compare those rather than the staging this
	# check is about. The rule was always about how far out on the board a melee
	# contact sits.
	var melee_out := Vector2(layer.local_slot_for("creature-1").x, layer.local_slot_for("creature-1").z).length()
	var neutral_out := Vector2(layer.local_slot_for("person-1").x, layer.local_slot_for("person-1").z).length()
	_ok("melee staging stays inside an unassessed neutral slot", melee_out < neutral_out)
	_ok("the player room exposes all three exact DR range bands", layer.token_for("player:self").get_parent().has_node("RangeBands/RangeBand_melee") and layer.token_for("player:self").get_parent().has_node("RangeBands/RangeBand_pole") and layer.token_for("player:self").get_parent().has_node("RangeBands/RangeBand_missile"))
	_ok("an exact 'you' target produces one engagement line", layer.target_link_count() == 1 and layer.target_for("creature-1") == "player:self")
	_ok("unassessed people stay explicitly unassessed", layer.token_for("person-1").get_meta("assessmentState") == "unassessed")
	_ok("each confirmed ground-item token has an inspect hit target", layer.token_for("item-1").has_node("InspectTarget"))
	_ok("ground items consume their declared board formation", layer.local_slot_for("item-1").is_equal_approx(Vector3(1.55, short_top + ITEM_LIFT_METRES, 1.55)))

	# -- the height, on two blocks that cannot both be satisfied by one number --
	#
	# Every expectation here is the cell's own published height plus the lift the
	# cell's own spawn point carries. A viewer that typed a height would land on
	# one of these two rooms and miss the other by 1.35 m.
	var player_y: float = layer.local_slot_for("player:self").y
	_ok("a token on the 0.3 m block stands on that block's top face, not inside it",
		absf(player_y - (short_top + PLAYER_LIFT_METRES)) < TOLERANCE_METRES)
	print("     player on a %.2f m block: y = %.3f, top face %.3f, lift %.2f" % [SHORT_BLOCK_METRES, player_y, short_top, PLAYER_LIFT_METRES])
	var tall_y: float = layer.local_slot_for("person-1").y
	_ok("a token on the 3 m block stands on that block's top face, not 1.35 m inside it",
		absf(tall_y - (tall_top + OCCUPANT_LIFT_METRES)) < TOLERANCE_METRES)
	print("     occupant on a %.2f m block: y = %.3f, top face %.3f, lift %.2f" % [TALL_BLOCK_METRES, tall_y, tall_top, OCCUPANT_LIFT_METRES])
	_ok("and the two answers differ by exactly the difference between the two blocks",
		absf((tall_y - OCCUPANT_LIFT_METRES) - (player_y - PLAYER_LIFT_METRES) - (tall_top - short_top)) < TOLERANCE_METRES,
		)
	# The tactical path, which no published anchor can reach: a confirmed
	# tactical entity is staged on its range band, so its x and z come from the
	# ring - and it still stands on the same face at its role's published lift.
	# This is the token that carried the hand-typed 0.4 all the way through.
	var melee_y: float = layer.local_slot_for("creature-1").y
	_ok("a range-band staged token clears the block too, at its role's published lift",
		absf(melee_y - (short_top + HOSTILE_LIFT_METRES)) < TOLERANCE_METRES)
	print("     range-banded hostile: y = %.3f, top face %.3f, lift %.2f" % [melee_y, short_top, HOSTILE_LIFT_METRES])
	_ok("every rendered token is at or above the top of the block its own cell published",
		_all_tokens_clear_their_block(layer, rooms))
	# The range bands measure distance across the block's top face, so they have
	# to be drawn on it. They were drawn at the tether origin, which is the
	# block's centre.
	var band: Node3D = layer.token_for("player:self").get_parent().get_node("RangeBands/RangeBand_melee")
	_ok("the range bands are drawn on the block's top face, not through its middle",
		band.position.y > short_top and absf(band.position.y - short_top) < 0.05)
	# And the degraded case, reachable on purpose: a cell that publishes a block
	# but places nothing gets no invented lift.
	_ok("a token whose cell publishes no spawn point for its role gets no invented height",
		absf(layer.local_slot_for("unplaced-1").y - tall_top) < TOLERANCE_METRES)
	# ...and no invented size either. A cell that placed nothing published no
	# token to draw, so the viewer draws the marker rather than something of a
	# plausible size, which is what makes a broken board contract visible instead
	# of merely wrong.
	_ok("and no invented size either: an unplaced token is the marker, not a plausible one",
		absf(_mesh_height(layer.token_for("unplaced-1").mesh) - 1.0) < TOLERANCE_METRES)

	# -- the mesh's own bottom face, which is what a player actually sees --
	#
	# Everything above measures a token's *origin*. That was the whole hole issue
	# #385 reported: a token is centred on its anchor, so its origin can be above
	# the block's top face with half the token still inside it, and every check in
	# this repository said the placement was correct. The mesh the viewer built is
	# the other half, and it is measured here off the primitive itself.
	_ok("every rendered token's mesh sits on the top face of its own block, on a 0.3 m block and on a 3 m one",
		_tokens_sit_on_their_block(layer, rooms, "current room crossing-1"))
	# The player is the one kind tied to `currentRoomId`, so the tall block is
	# only reachable for it by moving the player there.
	var moved: Dictionary = fixture.duplicate(true)
	moved["currentRoomId"] = "crossing-2"
	layer.project_snapshot(moved, rooms)
	_ok("and the player's own capsule sits on the face of whichever block it is standing on",
		_tokens_sit_on_their_block(layer, rooms, "current room crossing-2"))
	print("     player capsule on the %.2f m block: bottom %.3f, top face %.3f" % [
		TALL_BLOCK_METRES,
		layer.local_slot_for("player:self").y - _mesh_height(layer.token_for("player:self").mesh) * 0.5,
		tall_top,
	])

	# -- and the chooser, where the wrong answer is available --
	#
	# The lift has to follow the height. Republish the hostile token at 1.6 m -
	# more than twice its own size, and taller than the whole of the short block -
	# and its bottom face must still land on the same surface. A viewer that kept
	# a mesh height of its own passes every check above and fails this one by
	# 0.46 m, which is exactly the drift the issue demonstrated; a viewer that
	# read the published height but ignored the published lift fails it too.
	var grown_rooms := {}
	for room_id in ["crossing-1", "crossing-2"]:
		var room: Node3D = rooms[room_id]
		var height: float = SHORT_BLOCK_METRES if room_id == "crossing-1" else TALL_BLOCK_METRES
		room.set_meta("board", _board(height, HOSTILE_REPUBLISHED_HEIGHT_METRES))
		grown_rooms[room_id] = room
	grown_rooms["crossing-3"] = rooms["crossing-3"]
	layer.project_snapshot(fixture, grown_rooms)
	var grown_height: float = _mesh_height(layer.token_for("creature-2").mesh)
	_ok("a token republished at a different height is drawn at that height, not at the viewer's own",
		absf(grown_height - HOSTILE_REPUBLISHED_HEIGHT_METRES) < TOLERANCE_METRES)
	var grown_bottom: float = layer.local_slot_for("creature-2").y - grown_height * 0.5
	_ok("and its bottom face still lands on the block top, so the lift followed the height",
		absf(grown_bottom - tall_top) < TOLERANCE_METRES)
	print("     hostile republished at %.2f m: drawn %.3f m, bottom %.3f, top face %.3f" % [
		HOSTILE_REPUBLISHED_HEIGHT_METRES, grown_height, grown_bottom, tall_top,
	])
	_ok("every token still sits on its block once one kind's published height has changed",
		_tokens_sit_on_their_block(layer, grown_rooms, "hostile republished at %.2f m" % HOSTILE_REPUBLISHED_HEIGHT_METRES))
	# Restore the boards, so nothing below reads a chooser's fixture.
	for room_id in ["crossing-1", "crossing-2"]:
		(rooms[room_id] as Node3D).set_meta("board", _board(SHORT_BLOCK_METRES if room_id == "crossing-1" else TALL_BLOCK_METRES))
	layer.project_snapshot(fixture, rooms)

	var first_slot: Vector3 = layer.local_slot_for("creature-1")
	layer.project_snapshot(fixture, rooms)
	_ok("room-local slots are deterministic across equivalent snapshots", first_slot.is_equal_approx(layer.local_slot_for("creature-1")))
	layer.project_snapshot({"entities": [], "groundItems": []}, rooms)
	_ok("a later empty confirmed snapshot clears stale tokens", layer.visible_ids().is_empty())

	world.free()
	print("%d checked, %d failed" % [_checked, _failed])
	if _failed > 0:
		quit(1)
	else:
		print("all passed")
		quit(0)

## Every rendered token against the top face of its own room's block, with the
## denominator printed.
##
## The count that goes to zero when this stops measuring anything is the number
## of tokens examined, not the number that failed - "no token is inside a block"
## is also what a layer that rendered nothing says.
func _all_tokens_clear_their_block(layer: Node3D, rooms: Dictionary) -> bool:
	var examined := 0
	var clear := 0
	var worst := ""
	for projected_id in layer.visible_ids():
		var room_id := String(layer.tether_room_for(projected_id))
		if not rooms.has(room_id):
			continue
		var board: Dictionary = (rooms[room_id] as Node3D).get_meta("board", {})
		var footprint: Dictionary = board.get("footprint", {})
		if not footprint.has("height"):
			continue
		var top: float = float(footprint["height"]) * 0.5
		var y: float = layer.local_slot_for(projected_id).y
		examined += 1
		if y >= top - TOLERANCE_METRES:
			clear += 1
		elif worst.is_empty():
			worst = "%s at y = %.3f, %.3f m inside a %.2f m block" % [projected_id, y, top - y, footprint["height"]]
	print("     %d of %d rendered tokens at or above their own block's top face%s" % [clear, examined, "" if worst.is_empty() else " - " + worst])
	return examined >= 4 and clear == examined

## Every placed token's *mesh bottom* against the top face of its own room's
## block, with the denominators printed.
##
## Three numbers have to be non-zero for a pass here, and each of them goes to
## zero for a different broken instrument: the tokens examined (a layer that
## rendered nothing), the kinds of mesh among them (a fixture that lost every
## shape but one), and the block heights they stood on (a fixture whose two
## rooms stopped differing, which is the case one typed height would satisfy).
##
## A token whose cell published no spawn point is not examined: it is drawn as
## the marker at no lift on purpose, which is the degraded state asserted
## separately above rather than a placement to be measured.
func _tokens_sit_on_their_block(layer: Node3D, rooms: Dictionary, what: String) -> bool:
	var examined := 0
	var seated := 0
	var shapes := {}
	var tops := {}
	var worst := ""
	for projected_id in layer.visible_ids():
		var room_id := String(layer.tether_room_for(projected_id))
		if not rooms.has(room_id):
			continue
		var board: Dictionary = (rooms[room_id] as Node3D).get_meta("board", {})
		var footprint: Dictionary = board.get("footprint", {})
		if not footprint.has("height"):
			continue
		if (board.get("spawnPoints", []) as Array).is_empty():
			continue
		var token: MeshInstance3D = layer.token_for(projected_id)
		var height := _mesh_height(token.mesh)
		if height <= 0.0:
			continue
		var top: float = float(footprint["height"]) * 0.5
		var bottom: float = layer.local_slot_for(projected_id).y - height * 0.5
		examined += 1
		shapes[token.mesh.get_class()] = true
		tops[top] = true
		if absf(bottom - top) < TOLERANCE_METRES:
			seated += 1
		elif worst.is_empty():
			worst = "%s: a %.2f m %s with its bottom at %.3f, %.3f m from the %.2f m block's face" % [
				projected_id, height, token.mesh.get_class(), bottom, bottom - top, footprint["height"],
			]
	print("     [%s] %d of %d token meshes seated on their own block's top face, %d mesh kinds across %d block heights%s" % [
		what, seated, examined, shapes.size(), tops.size(), "" if worst.is_empty() else " - " + worst,
	])
	return examined >= 4 and seated == examined and shapes.size() >= 3 and tops.size() >= 2

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
