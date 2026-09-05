extends Node3D
## Snapshot-only tabletop token projection for the continuous 3D viewer.
##
## The game remains a room-node MUD: this layer receives entities and ground
## items that have already been confirmed by the bridge and puts a small,
## deterministic visual token *under that room's tether*. The local angle is
## purely presentation spacing. When the bridge supplies one of DragonRealms'
## exact assessed range buckets, the local radius uses that band; it is never
## converted into physical distance and cannot carry a token into another room.

var _tethers: Dictionary = {}
var _projected_ids: Dictionary = {}
var _target_links: Dictionary = {}
const CombatPresentation := preload("res://scripts/combat_presentation.gd")

## The registry that draws the block, so this layer asks the same question about
## a cell's height that `exit_anchor_layer.gd` asks about the same cell.
##
## The script rather than the `ContentRegistry` autoload, for the reason that
## file records: a `--script` run compiles a preloaded consumer before the
## SceneTree's autoloads exist, so naming the singleton here is a compile error
## in any test that preloads this file and nowhere else.
const ContentRegistryScript := preload("res://scripts/content_registry.gd")

## The lift given to a token whose cell published no spawn point for its role:
## none at all, so the token's origin sits exactly on the block's top face and
## the token is visibly half sunk into it.
##
## Deliberately not a plausible height. A cell with no spawn points has a broken
## board contract, and a guess that looked about right here would be exactly the
## invented number issue #373 is about - the same choice `content_registry.gd`
## makes with its deliberately implausible 1 m missing-footprint marker cube.
const UNPLACED_TOKEN_LIFT_METRES := 0.0

## The hair of clearance between the range bands and the block's top face, so
## the two do not z-fight where they meet. Not a board dimension: a cell's
## height reaches this file only through ContentRegistry.block_top_y().
const BAND_CLEARANCE_METRES := 0.015

## How far below its own token the assessment-age ring is drawn, and how far
## above it an engagement line is. Both are measured from the token rather than
## from the board, so they follow it up a taller block without knowing there is
## one - but they are named rather than typed, so that a bare height literal
## appearing anywhere in this file is always a mistake.
const ASSESSMENT_RING_DROP_METRES := 0.39
const ENGAGEMENT_LINE_LIFT_METRES := 0.08

## The ground-item token's own box. Its height is named for the same reason: a
## token is centred on its anchor, so half of this is the lift
## `src/lib/isometric-board-layout.mjs` publishes for the `item` role, and the
## two want to be readable against each other rather than one being a bare
## number inside a Vector3.
const ITEM_TOKEN_PLAN_METRES := 0.28
const ITEM_TOKEN_HEIGHT_METRES := 0.12

signal inspect_entity_requested(entity_id: String)
signal inspect_ground_item_requested(item_id: String)

func project_snapshot(snapshot: Dictionary, room_holders: Dictionary) -> void:
	_clear_projection()
	_project_player(snapshot, room_holders)
	for entity_value in snapshot.get("entities", []):
		if entity_value is Dictionary:
			_project_entity(entity_value, room_holders)
	for item_value in snapshot.get("groundItems", []):
		if item_value is Dictionary:
			_project_ground_item(item_value, room_holders)
	_project_engagements(snapshot)

func visible_ids() -> Array:
	return _projected_ids.keys()

func tether_room_for(projected_id: String) -> String:
	var token: Node3D = _projected_ids.get(projected_id)
	if token == null or not is_instance_valid(token):
		return ""
	return String(token.get_meta("roomId", ""))

func token_for(projected_id: String) -> Node3D:
	var token: Node3D = _projected_ids.get(projected_id)
	return token if token != null and is_instance_valid(token) else null

func local_slot_for(projected_id: String) -> Vector3:
	var token: Node3D = _projected_ids.get(projected_id)
	if token == null or not is_instance_valid(token):
		return Vector3.ZERO
	return token.position

func target_for(projected_id: String) -> String:
	return str(_target_links.get(projected_id, ""))

func target_link_count() -> int:
	return _target_links.size()

func _clear_projection() -> void:
	for tether in _tethers.values():
		if tether != null and is_instance_valid(tether):
			tether.free()
	_tethers.clear()
	_projected_ids.clear()
	_target_links.clear()

func _project_entity(entity: Dictionary, room_holders: Dictionary) -> void:
	var entity_id := String(entity.get("id", ""))
	var room_id := String(entity.get("roomId", ""))
	if entity_id.is_empty() or room_id.is_empty():
		return
	var tether := _tether_for(room_id, room_holders)
	if tether == null:
		return

	var token := MeshInstance3D.new()
	token.name = "Entity_%s" % entity_id
	token.mesh = _entity_mesh(String(entity.get("deck", "")))
	token.material_override = _token_material(CombatPresentation.token_color(entity))
	var tactical_value = entity.get("tactical")
	var role := "hostile" if String(entity.get("deck", "")) == "hostile" else "occupant"
	token.position = _token_slot(tether, role, entity_id, _range_radius(entity), tactical_value is Dictionary)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "entity")
	token.set_meta("entityName", String(entity.get("name", "")))
	token.set_meta("assessmentState", CombatPresentation.assessment_state(entity))
	token.set_meta("tacticalSummary", CombatPresentation.tactical_summary(entity))
	token.set_meta("tooltip", CombatPresentation.tactical_tooltip(entity))
	tether.add_child(token)
	_add_assessment_ring(token, CombatPresentation.assessment_state(entity))
	_add_inspect_hitbox(token, "entity", entity_id)
	_projected_ids[entity_id] = token

func _project_player(snapshot: Dictionary, room_holders: Dictionary) -> void:
	var player_value = snapshot.get("player")
	var room_id := str(snapshot.get("currentRoomId", ""))
	if not player_value is Dictionary or room_id.is_empty():
		return
	var tether := _tether_for(room_id, room_holders)
	if tether == null:
		return
	var token := MeshInstance3D.new()
	token.name = "PlayerSelf"
	var pawn := CapsuleMesh.new()
	pawn.radius = 0.28
	pawn.height = 0.94
	token.mesh = pawn
	token.material_override = _token_material(CombatPresentation.player_color(player_value))
	token.position = _token_slot(tether, "player", "player:self", 0.0, false)
	var view := CombatPresentation.player_view(player_value)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "player")
	token.set_meta("combatState", view.get("state", "PLAYER STATE UNKNOWN"))
	token.set_meta("healthPercent", view.get("healthPercent", 0.0))
	tether.add_child(token)
	_add_range_bands(tether)
	_projected_ids["player:self"] = token

func _add_range_bands(tether: Node3D) -> void:
	if tether.has_node("RangeBands"):
		return
	var bands := Node3D.new()
	bands.name = "RangeBands"
	for definition in [["melee", 0.78, Color(0.95, 0.30, 0.24, 0.24)], ["pole", 1.24, Color(0.96, 0.67, 0.18, 0.20)], ["missile", 1.72, Color(0.35, 0.64, 0.96, 0.17)]]:
		var ring := MeshInstance3D.new()
		ring.name = "RangeBand_%s" % definition[0]
		var torus := TorusMesh.new()
		torus.inner_radius = float(definition[1]) - 0.025
		torus.outer_radius = float(definition[1]) + 0.025
		ring.mesh = torus
		ring.material_override = _transparent_material(definition[2])
		# On the block's top face, like the tokens the bands are there to
		# measure. They were drawn at the tether origin, which is the block's
		# centre - inside it for a room and 1.5 m inside it for an interior
		# cutaway, so the rings a player reads a hostile's range off were buried
		# in the same solid the tokens were (issue #373).
		ring.position.y = _block_top(tether) + BAND_CLEARANCE_METRES
		bands.add_child(ring)
	tether.add_child(bands)

func _add_assessment_ring(token: MeshInstance3D, state: String) -> void:
	var ring := MeshInstance3D.new()
	ring.name = "AssessmentRing"
	var torus := TorusMesh.new()
	torus.inner_radius = 0.39
	torus.outer_radius = 0.46
	ring.mesh = torus
	ring.material_override = _token_material(CombatPresentation.assessment_color(state))
	ring.position.y = -ASSESSMENT_RING_DROP_METRES
	token.add_child(ring)

func _project_ground_item(item: Dictionary, room_holders: Dictionary) -> void:
	var item_id := String(item.get("id", ""))
	var room_id := String(item.get("roomId", ""))
	if item_id.is_empty() or room_id.is_empty():
		return
	var tether := _tether_for(room_id, room_holders)
	if tether == null:
		return

	var token := MeshInstance3D.new()
	token.name = "GroundItem_%s" % item_id
	var mesh := BoxMesh.new()
	mesh.size = Vector3(ITEM_TOKEN_PLAN_METRES, ITEM_TOKEN_HEIGHT_METRES, ITEM_TOKEN_PLAN_METRES)
	token.mesh = mesh
	token.material_override = _token_material(Color(0.94, 0.71, 0.18))
	token.position = _token_slot(tether, "item", item_id, 1.55, false)
	token.set_meta("roomId", room_id)
	token.set_meta("snapshotKind", "ground-item")
	token.set_meta("itemName", String(item.get("name", "")))
	tether.add_child(token)
	_add_inspect_hitbox(token, "ground-item", item_id)
	_projected_ids[item_id] = token

func _project_engagements(snapshot: Dictionary) -> void:
	var names: Dictionary = {"you": ["player:self"]} if _projected_ids.has("player:self") else {}
	for entity_value in snapshot.get("entities", []):
		if not entity_value is Dictionary:
			continue
		var entity_id := str(entity_value.get("id", ""))
		if not _projected_ids.has(entity_id):
			continue
		var entity_name := str(entity_value.get("name", "")).strip_edges().to_lower()
		if not entity_name.is_empty():
			if not names.has(entity_name):
				names[entity_name] = []
			names[entity_name].append(entity_id)
	for entity_value in snapshot.get("entities", []):
		if not entity_value is Dictionary:
			continue
		var source_id := str(entity_value.get("id", ""))
		var tactical_value = entity_value.get("tactical")
		if not tactical_value is Dictionary or bool(tactical_value.get("dead", false)) or bool(tactical_value.get("disengaged", false)):
			continue
		var target_name := str(tactical_value.get("target", "")).strip_edges().to_lower()
		var candidates: Array = names.get(target_name, [])
		if candidates.size() != 1:
			continue
		var target_id := str(candidates[0])
		if source_id == target_id or not _projected_ids.has(source_id) or not _projected_ids.has(target_id):
			continue
		_add_target_link(source_id, target_id, CombatPresentation.assessment_color(CombatPresentation.assessment_state(entity_value)))

func _add_target_link(source_id: String, target_id: String, color: Color) -> void:
	var source: Node3D = _projected_ids[source_id]
	var target: Node3D = _projected_ids[target_id]
	if source.get_parent() != target.get_parent():
		return
	var line_mesh := ImmediateMesh.new()
	line_mesh.surface_begin(Mesh.PRIMITIVE_LINES, _transparent_material(Color(color.r, color.g, color.b, 0.68)))
	line_mesh.surface_add_vertex(source.position + Vector3(0.0, ENGAGEMENT_LINE_LIFT_METRES, 0.0))
	line_mesh.surface_add_vertex(target.position + Vector3(0.0, ENGAGEMENT_LINE_LIFT_METRES, 0.0))
	line_mesh.surface_end()
	var line := MeshInstance3D.new()
	line.name = "Target_%s_to_%s" % [source_id, target_id]
	line.mesh = line_mesh
	source.get_parent().add_child(line)
	_target_links[source_id] = target_id

func _add_inspect_hitbox(token: MeshInstance3D, snapshot_kind: String, snapshot_id: String) -> void:
	var body := StaticBody3D.new()
	body.name = "InspectTarget"
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.42 if snapshot_kind == "entity" else 0.24
	shape.shape = sphere
	body.add_child(shape)
	body.input_event.connect(_on_inspect_target_clicked.bind(snapshot_kind, snapshot_id))
	token.add_child(body)

func _on_inspect_target_clicked(_camera: Node, event: InputEvent, _position: Vector3, _normal: Vector3, _shape_idx: int, snapshot_kind: String, snapshot_id: String) -> void:
	if not (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT):
		return
	if snapshot_kind == "entity":
		inspect_entity_requested.emit(snapshot_id)
	else:
		inspect_ground_item_requested.emit(snapshot_id)

func _tether_for(room_id: String, room_holders: Dictionary) -> Node3D:
	var existing: Node3D = _tethers.get(room_id)
	if existing != null and is_instance_valid(existing):
		return existing
	var room_holder: Node3D = room_holders.get(room_id)
	if room_holder == null or not is_instance_valid(room_holder):
		return null
	var tether := Node3D.new()
	tether.name = "RoomTether_%s" % room_id
	tether.set_meta("roomId", room_id)
	tether.set_meta("board", room_holder.get_meta("board", {}))
	room_holder.add_child(tether)
	_tethers[room_id] = tether
	return tether

func _entity_mesh(deck: String) -> PrimitiveMesh:
	if deck == "hostile":
		var sphere := SphereMesh.new()
		sphere.radius = 0.34
		sphere.height = 0.68
		return sphere
	var pawn := CylinderMesh.new()
	pawn.top_radius = 0.18
	pawn.bottom_radius = 0.38
	pawn.height = 0.8
	return pawn

func _token_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.06
	material.roughness = 0.42
	return material

func _transparent_material(color: Color) -> StandardMaterial3D:
	var material := _token_material(color)
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return material

func _range_radius(entity: Dictionary) -> float:
	var tactical_value = entity.get("tactical")
	if not tactical_value is Dictionary:
		return 1.50
	match str(tactical_value.get("range", "")):
		"melee": return 0.78
		"pole": return 1.24
		"missile": return 1.72
		_: return 1.50

## How high the top face of this room's block is, in the tether's own frame.
##
## The tether is parented to the cell holder, whose position is the manifest's,
## and the block is a BoxMesh centred on that origin - so the registry's
## `block_top_y()` is measured in exactly the frame a token's `position` is
## written in. Asked through the registry that draws the block rather than
## worked out here, so a token cannot go on being right about a height the
## viewer has stopped drawing.
func _block_top(tether: Node3D) -> float:
	return ContentRegistryScript.block_top_y({"id": String(tether.get_meta("roomId", "")), "board": tether.get_meta("board", {})})

## The spawn point this cell publishes for `role`, chosen deterministically from
## the ones it has, or an empty Dictionary when it publishes none for that role.
func _spawn_point_for(tether: Node3D, role: String, stable_id: String) -> Dictionary:
	var board_value = tether.get_meta("board", {})
	if not (board_value is Dictionary):
		return {}
	var matches: Array = []
	for point in (board_value as Dictionary).get("spawnPoints", []):
		if point is Dictionary and str(point.get("role", "")) == role:
			matches.append(point)
	if matches.is_empty():
		return {}
	return matches[_stable_hash(stable_id) % matches.size()]

## The deterministic ring a token is staged on when the board does not place it:
## an angle and a distance from one stable hash, in the horizontal plane only.
## It has no opinion about height, which is the point - height has one source
## and this is not it.
func _ring_offset(stable_id: String, radius: float) -> Vector2:
	var hash_value := _stable_hash(stable_id)
	var angle := TAU * float(hash_value % 360) / 360.0
	var distance := radius * (0.94 + float((hash_value / 360) % 13) / 100.0)
	return Vector2(cos(angle) * distance, sin(angle) * distance)

## Where a token stands, in its room tether's frame. Every token in this layer
## comes through here, and this is the only line in the file that decides a
## height.
##
## One rule: x and z are the board's, and y is the top face of the block this
## cell published plus how far above that surface this kind of thing stands.
## `src/lib/isometric-board-layout.mjs` publishes the second half as each spawn
## point's `anchor.y`, measured from the top face rather than from the cell
## origin, so a room and a 3 m interior cutaway need no different answer here.
##
## `prefer_ring` is the tactical case, and it is why the anchors are published
## relative rather than absolute. A confirmed tactical entity is staged on the
## range band its assessed range names, so its x and z come from the ring above
## and never from a spawn point - but its height does not, and that is the half
## this file used to get wrong. It stands on the same face as everything else,
## at the lift the board publishes for its role.
##
## Three numbers stood here instead: `0.4` in the ring, `0.4` again as the
## default for a missing anchor y, and `-0.32` subtracted for an item. All three
## were right against a placeholder block that was a 0.3 m slab with its top
## face at 0.15. #365 gave the placeholder the cell's published footprint, the
## top face moved to 0.5 for a room and 1.5 for a cutaway, and none of the three
## moved with it: 117 of 133 anchors in the checked-in world ended up below the
## top of the block their own cell publishes, and on the three cutaway cells all
## 21 were 1.0 to 1.4 m inside it (issue #373). There is no height typed into
## this file now, so there is nothing left here for the manifest to disagree
## with.
func _token_slot(tether: Node3D, role: String, stable_id: String, ring_radius: float, prefer_ring: bool) -> Vector3:
	var point := _spawn_point_for(tether, role, stable_id)
	var lift := UNPLACED_TOKEN_LIFT_METRES
	var ground := Vector2.ZERO
	var placed := false
	if not point.is_empty():
		var anchor_value = point.get("anchor", {})
		if anchor_value is Dictionary:
			var anchor: Dictionary = anchor_value
			lift = float(anchor.get("y", UNPLACED_TOKEN_LIFT_METRES))
			ground = Vector2(float(anchor.get("x", 0.0)), float(anchor.get("z", 0.0)))
			placed = true
	if prefer_ring or not placed:
		ground = _ring_offset(stable_id, ring_radius)
	return Vector3(ground.x, _block_top(tether) + lift, ground.y)

func _stable_hash(value: String) -> int:
	var result := 17
	for i in range(value.length()):
		result = (result * 31 + value.unicode_at(i)) & 0x7fffffff
	return result
