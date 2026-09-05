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

## How thick a placeholder slab is drawn. Not a board dimension - the board
## publishes width and depth, and this is the visual thickness of the stand-in
## that sits between them. `exit_anchor_layer.gd` raises its chevrons clear of
## this height.
const PLACEHOLDER_SLAB_METRES := 0.3

## The width and depth this cell published, in metres, or an empty Dictionary
## when it published none.
##
## Empty is the third state on purpose: not "a block of some default size", but
## "this cell did not say", which is the distinction the caller has to be able
## to act on. Public so a test can ask both questions directly.
func footprint_metres(cell: Dictionary) -> Dictionary:
	var board_value = cell.get("board", {})
	if not (board_value is Dictionary):
		return {}
	var footprint_value = (board_value as Dictionary).get("footprint", {})
	if not (footprint_value is Dictionary):
		return {}
	var footprint: Dictionary = footprint_value
	var width = footprint.get("width")
	var depth = footprint.get("depth")
	if not (width is float or width is int):
		return {}
	if not (depth is float or depth is int):
		return {}
	return {"width": float(width), "depth": float(depth)}

func _placeholder(cell: Dictionary, primitive: Dictionary) -> Node3D:
	var mesh_instance := MeshInstance3D.new()
	var box := BoxMesh.new()
	var footprint := footprint_metres(cell)
	var color := _placeholder_color(primitive.get("role", "base"))
	if footprint.is_empty():
		push_error("ContentRegistry: cell '%s' published no board.footprint, so its block size is unknown. Drawing the %s m missing-footprint marker rather than inventing one; the size belongs to the manifest (see src/lib/isometric-board-layout.mjs)." % [cell.get("id", "<unknown>"), MISSING_FOOTPRINT_MARKER_METRES])
		box.size = Vector3(MISSING_FOOTPRINT_MARKER_METRES, PLACEHOLDER_SLAB_METRES, MISSING_FOOTPRINT_MARKER_METRES)
		color = MISSING_FOOTPRINT_MARKER_COLOR
	else:
		box.size = Vector3(footprint["width"], PLACEHOLDER_SLAB_METRES, footprint["depth"])
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
