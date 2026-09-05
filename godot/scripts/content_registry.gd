extends Node
## The stable content-registration contract content packs build against.
##
## This is the boundary the brief calls out explicitly: "Claude supplies
## stable scene slots, schemas, a content-registration API, and test
## fixtures. Claude does not hand-place or invent town content." Every slot
## kind below is a place content can register a scene/mesh factory; this
## file never hand-places a specific building, prop, or landmark — it only
## defines the categories a cell's `primitives` array (from the compiled
## manifest) can ask for, and falls back to an honest placeholder shape when
## nothing has registered a real one yet, so the viewer is exercisable
## before any content exists.
##
## A "slot kind" here is the same string a manifest cell's `primitives[].kind`
## carries (see `tools/build-primitive-world-manifest.mjs`'s `primitiveRecipe`)
## — terrain-cell-5m, water-ribbon-5m, bridge-span-5m, guild-threshold-kit,
## and so on. Content registers a `Callable` under that exact string; this
## registry does not interpret or validate the meaning of a kind, only routes
## it to whichever factory (if any) claims it.

## kind (String) -> Callable(cell: Dictionary, primitive: Dictionary) -> Node3D
var _factories: Dictionary = {}

## Registers (or replaces) the factory for one primitive kind. Called by a
## content pack's own autoload/init code, never by this file. Replacing an
## existing registration is allowed on purpose — a content pack iterating on
## one kind should not have to restart the whole registry.
func register(kind: String, factory: Callable) -> void:
	_factories[kind] = factory

func is_registered(kind: String) -> bool:
	return _factories.has(kind)

func registered_kinds() -> Array:
	return _factories.keys()

## Builds one primitive instance for a cell. Falls back to a flat-colored
## placeholder box when no content pack has registered `primitive.kind` yet
## — visibly a placeholder (wireframe-ish flat unlit material, not something
## that could pass for finished art), so an unregistered slot is obvious in
## the viewer rather than silently invisible.
func build(cell: Dictionary, primitive: Dictionary) -> Node3D:
	var kind: String = primitive.get("kind", "")
	if _factories.has(kind):
		var node: Node3D = _factories[kind].call(cell, primitive)
		if node != null:
			return node
	return _placeholder(cell, primitive)

## The block is the size the manifest published for this cell, never a number
## invented here.
##
## It used to be a hardcoded 4.5 while the manifest said 5 and the selection box
## said 4.5 again - three numbers for one dimension, none derived from another,
## so a change to the board's spacing could not reach the thing a player looks
## at. The compiler now leaves a deliberate gutter between neighbouring blocks
## (see CELL_GAP_METRES in src/lib/isometric-board-layout.mjs: without it the
## tiles meet exactly, the board reads as one continuous surface, and the exits
## - which live at the edges - have no edge to live on).
##
## A `FALLBACK_BLOCK_METRES := 4.4` stood here next, described as being only for
## a cell whose manifest predates the field. It was a fourth copy of the same
## dimension: 4.4 is CELL_PITCH_METRES - CELL_GAP_METRES typed out again,
## agreeing with its source by hand rather than deriving from it. And it was not
## the legacy path - `tools/build-godot-mock-fixture.mjs` stripped `board` from
## every cell, so the checked-in mock world took this branch in 19 cells out of
## 19 and the real one never ran. Nothing on screen could show it, because the
## typed number happened to be right (issue #345).
##
## The generator carries `board` through verbatim now, so both worlds publish
## their own footprint and there is no number here to disagree with theirs.
##
## A cell that still arrives without one is a broken contract rather than an old
## manifest, so it says so on the console and gets the marker below. The marker
## is deliberately not a plausible block size: a cube that is obviously wrong is
## a bug report, and one that looks about right is the silent guess this whole
## comment is about.
const MISSING_FOOTPRINT_MARKER_METRES := 1.0
const MISSING_FOOTPRINT_MARKER_COLOR := Color(1.0, 0.0, 1.0, 1.0)

## A `PLACEHOLDER_SLAB_METRES := 0.3` stood here and decided every block's
## height, while the manifest published `footprint.height` - 1 for a room, 3 for
## an `interior-cutaway` - and nothing read it. That is the same defect as the
## width one line above, in the one dimension #345 left alone: a number typed
## into GDScript deciding what a player sees while the manifest's own answer
## went unread. `exit_anchor_layer.gd` then derived its chevron height from that
## 0.3 by hand, so the first block taller than a slab would have buried the
## markers inside it - the exact failure the board-legibility pass had just
## fixed once (docs/verification/board-legibility-2026-09-05.md, issue #362).
##
## Height comes from the cell now, through the two functions below, and there is
## no number here for the manifest to disagree with.

## The width, depth and height this cell published, in metres, or an empty
## Dictionary when it published none.
##
## Empty is the third state on purpose: not "a block of some default size", but
## "this cell did not say", which is the distinction the caller has to be able
## to act on. Public so a test can ask both questions directly.
##
## All three are required together. A cell publishing width and depth but no
## height is not a lesser failure than one publishing no board at all: it is the
## same broken contract, and answering it with a default height would be exactly
## the invented number this file exists to refuse.
## Static, and so are the two below: they read the cell and nothing else, and a
## caller must be able to ask them without holding the autoload. A test that
## `preload`s a consumer script compiles it before the SceneTree's autoloads
## exist, so naming the `ContentRegistry` singleton inside one is a compile
## error there and nowhere else - measured, on exit_anchor_layer_test.gd:
## "Identifier not found: ContentRegistry". Consumers preload this script and
## call these three on it, which is the same file the autoload runs.
static func footprint_metres(cell: Dictionary) -> Dictionary:
	var board_value = cell.get("board", {})
	if not (board_value is Dictionary):
		return {}
	var footprint_value = (board_value as Dictionary).get("footprint", {})
	if not (footprint_value is Dictionary):
		return {}
	var footprint: Dictionary = footprint_value
	var width = footprint.get("width")
	var depth = footprint.get("depth")
	var height = footprint.get("height")
	if not (width is float or width is int):
		return {}
	if not (depth is float or depth is int):
		return {}
	if not (height is float or height is int):
		return {}
	return {"width": float(width), "depth": float(depth), "height": float(height)}

## The size, in metres, of the block this cell is actually drawn at: the
## published footprint, or the missing-footprint marker cube when it published
## none.
##
## Every consumer of a cell's geometry comes through here - the placeholder
## block below, the ground plane in `shared_asset_content.gd`, and
## `block_top_y()` for anything that has to sit clear of the block - so a second
## opinion about how big a cell is cannot exist.
##
## The broken contract is reported here rather than at one call site, so a cell
## with no footprint says so however it is drawn. A cell that publishes one
## costs nothing.
static func block_size_metres(cell: Dictionary) -> Vector3:
	var footprint := footprint_metres(cell)
	if footprint.is_empty():
		push_error("ContentRegistry: cell '%s' published no complete board.footprint (width, depth and height), so its block size is unknown. Drawing the %s m missing-footprint marker rather than inventing one; the size belongs to the manifest (see src/lib/isometric-board-layout.mjs)." % [cell.get("id", "<unknown>"), MISSING_FOOTPRINT_MARKER_METRES])
		return Vector3(MISSING_FOOTPRINT_MARKER_METRES, MISSING_FOOTPRINT_MARKER_METRES, MISSING_FOOTPRINT_MARKER_METRES)
	return Vector3(footprint["width"], footprint["height"], footprint["depth"])

## The ground square this cell owns, in metres - the pitch, so one room's ground
## meets the next room's - or the missing-ground marker when it published none.
##
## It is deliberately bigger than the block, and that is what a player sees as
## the gutter: the ground showing round the block's edge. `shared_asset_content`
## drew this as a hand-typed `5.0, 5.0` with the cell thrown away, which was the
## right size for the wrong reason and could not follow the manifest anywhere
## (issue #362). Shrinking it to the block was the obvious fix and is wrong -
## two captures of a board at the minimum pitch are in
## docs/verification/terrain-gutter-2026-09-05.md.
static func ground_size_metres(cell: Dictionary) -> Vector2:
	var board_value = cell.get("board", {})
	var ground_value = (board_value as Dictionary).get("ground", {}) if board_value is Dictionary else {}
	if ground_value is Dictionary:
		var ground: Dictionary = ground_value
		var width = ground.get("width")
		var depth = ground.get("depth")
		if (width is float or width is int) and (depth is float or depth is int):
			return Vector2(float(width), float(depth))
	push_error("ContentRegistry: cell '%s' published no board.ground, so how much ground it owns is unknown. Drawing the %s m marker rather than inventing one; the size belongs to the manifest (see src/lib/isometric-board-layout.mjs)." % [cell.get("id", "<unknown>"), MISSING_FOOTPRINT_MARKER_METRES])
	return Vector2(MISSING_FOOTPRINT_MARKER_METRES, MISSING_FOOTPRINT_MARKER_METRES)

## How far above the cell origin the top face of that block sits.
##
## The block is a BoxMesh centred on the origin, so this is half the height that
## is actually drawn - computed from `block_size_metres()` rather than restated
## from it. A consumer that has to clear the block asks here, so it cannot go on
## being right about a height the viewer has stopped drawing.
static func block_top_y(cell: Dictionary) -> float:
	return block_size_metres(cell).y * 0.5

func _placeholder(cell: Dictionary, primitive: Dictionary) -> Node3D:
	var mesh_instance := MeshInstance3D.new()
	var box := BoxMesh.new()
	var color := _placeholder_color(primitive.get("role", "base"))
	if footprint_metres(cell).is_empty():
		color = MISSING_FOOTPRINT_MARKER_COLOR
	box.size = block_size_metres(cell)
	mesh_instance.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh_instance.material_override = material
	mesh_instance.name = "Placeholder_%s" % primitive.get("kind", "unknown")
	return mesh_instance

func _placeholder_color(role: String) -> Color:
	match role:
		"landform":
			return Color(0.25, 0.55, 0.75, 0.6)
		"landmark":
			return Color(0.85, 0.65, 0.2, 0.6)
		"shell":
			return Color(0.5, 0.4, 0.3, 0.6)
		"boundary":
			return Color(0.3, 0.3, 0.35, 0.4)
		_:
			return Color(0.4, 0.45, 0.4, 0.6)
