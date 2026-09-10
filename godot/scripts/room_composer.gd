extends RefCounted
# No `class_name`; see the note at the top of `room_primitives.gd`.
## Turn one `forge.compose.Scene` dictionary into a 2D isometric node tree.
##
## This is the whole Godot half of the room player, and it is deliberately a
## pure function of the spec: `compose(spec)` returns a detached `Node2D` and
## touches no singleton, no file and no clock. That is what lets the same code
## serve three callers without a second copy of it -
##
##   * `scenes/room.tscn` (`scripts/room_scene.gd`) for a human at a window,
##   * `scripts/room_server.gd` for the headless control API a bot drives,
##   * `tests/room_composer_test.gd` for the in-engine suite,
##
## - and it is why the report below describes the *tree that was built* rather
## than echoing the spec that asked for it. A report assembled from the input
## would pass every test while the composer emitted nothing at all.
##
## # Projection
##
##   screen_x = (gx - gy) * TILE_W / 2
##   screen_y = (gx + gy) * TILE_H / 2
##
## Grid axes are chosen so that compass words land where a player expects them
## on screen: -x-y is up (north), +x-y is right (east), +x+y is down (south),
## -x+y is left (west). The four intercardinals fall on the mid-points of the
## rendered diamond's edges. `RING` below is that mapping, and it is the one
## fact the layout, the openings and the tests all read from.
##
## # There is no art here on purpose
##
## Every node is a labelled `Polygon2D` from `RoomPrimitives`. Dropping real
## sprites in later changes `RoomPrimitives.TABLE` and the two lines in
## `_primitive()` that build the `Polygon2D`; footprints, anchors, heights,
## z-order and the whole layout stay exactly where they are. If adding art
## requires touching anything else in this file, the split was wrong.

const RoomPrimitives := preload("res://scripts/room_primitives.gd")

## Half-width of the room in ground cells. A square grid renders as a diamond
## in isometric, which is the shape a room should be, so the grid is square:
## (2*RADIUS+1)^2 = 81 ground tiles, 32 of them on the perimeter.
const RADIUS := 4

## How far overhead the canopy is drawn. Negative is up the screen.
const CANOPY_LIFT := -150.0

## Cells either side of an opening that are cleared from the boundary, so a
## doorway reads as a gap rather than a single missing brick.
const OPENING_HALF_GAP := 1

## Compass word -> grid cell. Derived from the projection above; see the class
## comment. Everything that places anything reads this and nothing else.
const RING := {
	"north": Vector2i(-RADIUS, -RADIUS),
	"northeast": Vector2i(0, -RADIUS),
	"east": Vector2i(RADIUS, -RADIUS),
	"southeast": Vector2i(RADIUS, 0),
	"south": Vector2i(RADIUS, RADIUS),
	"southwest": Vector2i(0, RADIUS),
	"west": Vector2i(-RADIUS, RADIUS),
	"northwest": Vector2i(-RADIUS, 0),
}

## Exits the game reports that are not points of the compass. They are real
## openings and they have no direction on the floor, so they are anchored in
## the middle and flagged `on_boundary: false` rather than being dropped or
## quietly assigned a bearing the room never stated.
const NON_COMPASS_OPENINGS := {
	"up": Vector2i(0, 0),
	"down": Vector2i(0, 0),
	"out": Vector2i(0, 0),
}

## Anchors for a `where` that is not a compass point.
const SPECIAL_WHERE := {
	"center": Vector2i(0, 0),
	"centre": Vector2i(0, 0),
	"ground": Vector2i(0, 0),
	"canopy": Vector2i(0, 0),
}

# z_index layering. Depth (gx+gy) dominates so nearer things draw later; the
# bias separates things standing in the same cell.
const Z_STEP := 4
const Z_GROUND := 0
const Z_OPENING := 1
const Z_BOUNDARY := 2
const Z_PLACEMENT := 3
const Z_CANOPY := 3000


## The isometric projection, and the only place it is written down.
static func iso(gx: float, gy: float) -> Vector2:
	return Vector2(
		(gx - gy) * RoomPrimitives.TILE_W * 0.5,
		(gx + gy) * RoomPrimitives.TILE_H * 0.5
	)


## The 32 perimeter cells, clockwise on screen starting at north.
##
## Ordered rather than a set because openings and edge-anchored placements both
## need to say "one third of the way round", and because the compass points
## land on exact multiples of RADIUS in this order, which is what makes the
## opening gaps checkable by arithmetic instead of by eye.
static func perimeter() -> Array:
	var cells := []
	for x in range(-RADIUS, RADIUS):
		cells.append(Vector2i(x, -RADIUS))       # north -> east
	for y in range(-RADIUS, RADIUS):
		cells.append(Vector2i(RADIUS, y))        # east -> south
	for x in range(RADIUS, -RADIUS, -1):
		cells.append(Vector2i(x, RADIUS))        # south -> west
	for y in range(RADIUS, -RADIUS, -1):
		cells.append(Vector2i(-RADIUS, y))       # west -> north
	return cells


static func _z_for(cell: Vector2i, bias: int) -> int:
	return (cell.x + cell.y) * Z_STEP + bias


## Build the tree. Never returns null and never throws: a spec this cannot read
## still produces a root whose report carries the problems, because a composer
## that refuses silently and a composer that works are the same empty output.
##
## The caller owns the returned node and must `free()` it.
static func compose(spec: Dictionary) -> Node2D:
	var problems: Array = []

	var root := Node2D.new()
	root.name = "RoomScene"

	var room_id: int = int(spec.get("room_id", -1))
	if not spec.has("room_id"):
		problems.append("spec has no room_id")

	var archetype := str(spec.get("archetype", ""))
	if archetype == "":
		problems.append("spec has no archetype")

	var ground_kind := str(spec.get("ground", ""))
	if ground_kind == "":
		problems.append("spec has no ground")
	var boundary_kind := str(spec.get("boundary", ""))
	if boundary_kind == "":
		problems.append("spec has no boundary")
	var canopy_kind := str(spec.get("canopy", ""))
	if canopy_kind == "":
		problems.append("spec has no canopy")

	var openings: Array = spec.get("openings", []) if spec.get("openings") is Array else []
	if not (spec.get("openings") is Array):
		problems.append("spec openings is not a list")
	var placements: Array = spec.get("placements", []) if spec.get("placements") is Array else []
	if not (spec.get("placements") is Array):
		problems.append("spec placements is not a list")

	var palette = spec.get("palette")
	var light = spec.get("light")

	var ring := perimeter()

	# ---- which perimeter cells an opening clears -------------------------
	var gap: Dictionary = {}
	var opening_rows: Array = []
	for raw_dir in openings:
		var dir := str(raw_dir)
		if RING.has(dir):
			var index := ring.find(RING[dir])
			for step in range(-OPENING_HALF_GAP, OPENING_HALF_GAP + 1):
				gap[ring[posmod(index + step, ring.size())]] = true
			opening_rows.append({"dir": dir, "cell": RING[dir], "on_boundary": true})
		elif NON_COMPASS_OPENINGS.has(dir):
			opening_rows.append({"dir": dir, "cell": NON_COMPASS_OPENINGS[dir], "on_boundary": false})
		else:
			problems.append("opening '%s' is not a direction this composer knows" % dir)
			opening_rows.append({"dir": dir, "cell": Vector2i(0, 0), "on_boundary": false})

	# ---- ground ----------------------------------------------------------
	var ground_group := Node2D.new()
	ground_group.name = "Ground"
	root.add_child(ground_group)
	for gx in range(-RADIUS, RADIUS + 1):
		for gy in range(-RADIUS, RADIUS + 1):
			var cell := Vector2i(gx, gy)
			var tile := _primitive(ground_kind, cell, Z_GROUND, 1.0, Color.WHITE)
			tile.name = "Ground_%d_%d" % [gx, gy]
			_tag(tile, {"role": "ground", "kind": ground_kind, "cell": cell})
			ground_group.add_child(tile)

	# ---- boundary --------------------------------------------------------
	#
	# An `open` boundary (the outdoor archetype) is a real answer, not a
	# missing one: nothing is built at the edge of a street. Those nodes are
	# still created, and hidden. Keeping them means the perimeter is the same
	# 32 cells whatever the archetype - a later horizon or fog sprite has a
	# place to attach, and a test's denominator does not silently collapse to
	# zero for half the map.
	var boundary_built: bool = boundary_kind != "open"
	var boundary_group := Node2D.new()
	boundary_group.name = "Boundary"
	root.add_child(boundary_group)
	var boundary_count := 0
	for cell in ring:
		if gap.has(cell):
			continue
		var seg := _primitive(boundary_kind, cell, Z_BOUNDARY, 1.0, Color.WHITE)
		seg.name = "Boundary_%d_%d" % [cell.x, cell.y]
		seg.visible = boundary_built
		_tag(seg, {"role": "boundary", "kind": boundary_kind, "cell": cell, "built": boundary_built})
		boundary_group.add_child(seg)
		boundary_count += 1

	# ---- openings --------------------------------------------------------
	var openings_group := Node2D.new()
	openings_group.name = "Openings"
	root.add_child(openings_group)
	for row in opening_rows:
		var marker := _primitive("open", row["cell"], Z_OPENING, 1.0, Color.WHITE)
		marker.name = "Opening_%s" % row["dir"]
		_tag(marker, {
			"role": "opening",
			"kind": "opening",
			"cell": row["cell"],
			"dir": row["dir"],
			"on_boundary": row["on_boundary"],
		})
		_label(marker, "> %s" % row["dir"])
		openings_group.add_child(marker)

	# ---- canopy ----------------------------------------------------------
	var canopy_group := Node2D.new()
	canopy_group.name = "Canopy"
	root.add_child(canopy_group)
	var canopy := _primitive(canopy_kind, Vector2i(0, 0), Z_CANOPY, float(RADIUS * 2 + 1), Color.WHITE)
	canopy.name = "Canopy"
	canopy.position += Vector2(0.0, CANOPY_LIFT)
	_tag(canopy, {"role": "canopy", "kind": canopy_kind, "cell": Vector2i(0, 0), "lift": CANOPY_LIFT})
	canopy_group.add_child(canopy)

	# ---- placements ------------------------------------------------------
	#
	# `where: "edge"` is what the forge gives a `go <something>` exit: a door
	# into a shop, with no bearing attached. Those are spread evenly round the
	# perimeter so fifteen temple archways do not stack on one brick. Every
	# other `where` is a compass point or one of SPECIAL_WHERE.
	var placements_group := Node2D.new()
	placements_group.name = "Placements"
	root.add_child(placements_group)

	var edge_total := 0
	for p in placements:
		if p is Dictionary and str(p.get("where", "")) == "edge":
			edge_total += 1
	var edge_seen := 0
	var occupancy: Dictionary = {}

	for i in range(placements.size()):
		var p = placements[i]
		if not (p is Dictionary):
			problems.append("placement %d is not an object" % i)
			continue
		var kind := str(p.get("kind", ""))
		var where := str(p.get("where", ""))
		var cell: Vector2i
		var anchor := where

		if where == "edge":
			var slot: int = 0
			if edge_total > 0:
				slot = int(round(float(edge_seen) * float(ring.size()) / float(edge_total))) % ring.size()
			cell = ring[slot]
			edge_seen += 1
		elif RING.has(where):
			cell = RING[where]
		elif SPECIAL_WHERE.has(where):
			cell = SPECIAL_WHERE[where]
		else:
			problems.append("placement %d has where '%s', which is not a position; anchored at center" % [i, where])
			cell = Vector2i(0, 0)
			anchor = "center"

		var stack: int = int(occupancy.get(cell, 0))
		occupancy[cell] = stack + 1

		var scale_word = p.get("scale")
		var tint_word = p.get("tint")
		var node := _primitive(
			kind, cell, Z_PLACEMENT + stack,
			RoomPrimitives.scale_of(scale_word),
			RoomPrimitives.tint_of(tint_word)
		)
		# Things sharing a cell are nudged apart so a stack of doors is
		# visibly a stack rather than one door. Recorded, so a reader of the
		# report can tell an offset from a position the spec asked for.
		var stack_offset := -6.0 * float(stack)
		if stack > 0:
			node.position += Vector2(0.0, stack_offset)
		node.name = "P%03d_%s" % [i, kind]
		var entry := RoomPrimitives.of(kind)
		_tag(node, {
			"role": "placement",
			"kind": kind,
			"cell": cell,
			"spec_index": i,
			"where": where,
			"anchor": anchor,
			"source": str(p.get("source", "")),
			"term": p.get("term"),
			"scale": scale_word,
			"scale_applied": RoomPrimitives.scale_known(scale_word),
			"tint": tint_word,
			"tint_applied": RoomPrimitives.tint_known(tint_word),
			"stack": stack,
			# Recorded, not just applied. Without it a reader of the report
			# cannot tell a nudge from a position the spec asked for, and
			# "the node is where the projection says" stops being checkable.
			"stack_offset": stack_offset,
			"unknown_kind": bool(entry["unknown"]),
		})
		_label(node, kind)
		placements_group.add_child(node)

	root.set_meta("room", {
		"room_id": room_id,
		"archetype": archetype,
		"ground": ground_kind,
		"ground_source": str(spec.get("ground_source", "")),
		"boundary": boundary_kind,
		"boundary_built": boundary_built,
		"canopy": canopy_kind,
		"light": light,
		"palette": palette,
		"unplaced_in_spec": int(spec.get("unplaced", 0)),
		"problems": problems,
		"boundary_count": boundary_count,
		"perimeter": ring.size(),
	})
	return root


static func _tag(node: Node2D, data: Dictionary) -> void:
	node.set_meta("rp", data)


static func _label(node: Node2D, text: String) -> void:
	# The label is created in every mode, headless included, where the dummy
	# text server draws nothing. Making it conditional would mean the tree the
	# bot inspects is not the tree a person sees, which is the one property
	# this whole API exists to provide.
	var tag := Label.new()
	tag.name = "Tag"
	tag.text = text
	tag.position = Vector2(-30.0, -14.0)
	tag.size = Vector2(60.0, 14.0)
	tag.add_theme_font_size_override("font_size", 9)
	node.add_child(tag)


## One primitive: a holder at the cell's screen position, a `Polygon2D` named
## `Shape` inside it. The holder carries position, z-order and meta; the shape
## carries size and colour. That division is what a real sprite replaces - the
## `Polygon2D` goes, a `Sprite2D` arrives, nothing above it moves.
static func _primitive(kind: String, cell: Vector2i, z_bias: int, size: float, tint: Color) -> Node2D:
	var entry := RoomPrimitives.of(kind)
	var holder := Node2D.new()
	holder.position = iso(float(cell.x), float(cell.y))
	holder.z_index = clampi(_z_for(cell, z_bias), -4000, 4000)

	var shape := Polygon2D.new()
	shape.name = "Shape"
	shape.polygon = RoomPrimitives.outline(int(entry["shape"]), float(entry["height"]))
	shape.color = (entry["color"] as Color) * tint
	shape.scale = Vector2(size, size)
	holder.add_child(shape)
	return holder


## What the tree actually contains, walked out of the tree itself.
##
## Deliberately not assembled from the spec. The bot's whole question is
## whether what it asked for got built, and a report generated from the request
## answers a different question perfectly.
static func report(root: Node2D) -> Dictionary:
	var room: Dictionary = root.get_meta("room", {}) if root.has_meta("room") else {}
	var nodes: Array = []
	var counts := {"ground": 0, "boundary": 0, "opening": 0, "canopy": 0, "placement": 0}
	var unknown_kinds: Array = []
	var openings: Array = []
	var node_total := 0

	var stack: Array = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		node_total += 1
		for child in node.get_children():
			stack.push_back(child)
		if not node.has_meta("rp"):
			continue
		var meta: Dictionary = node.get_meta("rp")
		var cell: Vector2i = meta["cell"]
		var node2d := node as Node2D
		var row := {
			"path": str(root.get_path_to(node)),
			"name": String(node.name),
			"role": meta["role"],
			"kind": meta["kind"],
			"grid": [cell.x, cell.y],
			"pos": [node2d.position.x, node2d.position.y],
			"z": node2d.z_index,
			"visible": node2d.visible,
		}
		for extra in ["spec_index", "where", "anchor", "source", "term", "scale",
				"scale_applied", "tint", "tint_applied", "stack", "stack_offset",
				"unknown_kind", "dir", "on_boundary", "built", "lift"]:
			if meta.has(extra):
				row[extra] = meta[extra]
		nodes.append(row)
		counts[meta["role"]] = int(counts[meta["role"]]) + 1
		if meta.get("unknown_kind", false) and not unknown_kinds.has(meta["kind"]):
			unknown_kinds.append(meta["kind"])
		if meta["role"] == "opening":
			openings.append({
				"dir": meta["dir"],
				"grid": [cell.x, cell.y],
				"pos": [node2d.position.x, node2d.position.y],
				"on_boundary": meta["on_boundary"],
			})

	# Stable order, so two reports of the same room are byte-comparable and a
	# diff between them means something changed rather than that the walk
	# happened to pop in a different order.
	nodes.sort_custom(func(a, b): return str(a["path"]) < str(b["path"]))
	openings.sort_custom(func(a, b): return str(a["dir"]) < str(b["dir"]))

	counts["node_total"] = node_total
	counts["tagged"] = nodes.size()

	return {
		"room": room,
		"counts": counts,
		"nodes": nodes,
		"openings": openings,
		"unknown_kinds": unknown_kinds,
		"projection": {
			"tile_w": RoomPrimitives.TILE_W,
			"tile_h": RoomPrimitives.TILE_H,
			"radius": RADIUS,
			"formula": "x=(gx-gy)*tile_w/2, y=(gx+gy)*tile_h/2",
		},
	}
