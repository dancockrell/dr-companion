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

func _placeholder(cell: Dictionary, primitive: Dictionary) -> Node3D:
	var mesh_instance := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(4.5, 0.3, 4.5)
	mesh_instance.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = _placeholder_color(primitive.get("role", "base"))
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
