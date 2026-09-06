extends Node
## The first deliberately small DR Companion content pack.
##
## It draws only on neutral reusable geometry from the shared resource-pack
## library.  It registers terrain language, not DragonRealms fiction: no
## generic "guild", "shop", or "temple" mesh may be substituted for a room
## whose set-piece has not been authored and reviewed yet.  That keeps the
## viewer useful while being honest about unmade content.
##
## Visual meshes in this file are presentation only.  WorldRoot's manifest is
## still the sole topology source and its ClickTarget remains the fallback
## interaction surface.  Do not add collision, navigation, or move rules here.

## The script, not the autoload. `ContentRegistry.register()` below needs the
## live singleton; the block geometry is static and is asked for through the
## script, so a test that preloads this file compiles before the autoloads exist
## without a "Identifier not found: ContentRegistry" compile error.
const ContentRegistryScript := preload("res://scripts/content_registry.gd")

const SHARED_ROOT := "res://shared-assets/resource-packs"
const ROCK_SMALL_A := SHARED_ROOT + "/geometry/geology/tabletop-weathered-stone-v1/models/rock_smallA.glb"
const ROCK_SMALL_B := SHARED_ROOT + "/geometry/geology/tabletop-weathered-stone-v1/models/rock_smallB.glb"
const BRIDGE_WOOD := SHARED_ROOT + "/source/cc0/kenney/nature-kit-2.1/bridge_woodNarrow.glb"

var _shared_available := false
var _warned_missing_shared_assets := false
var _native_source: Node3D
var _native_records: Dictionary = {}
var _room_compositions: Dictionary = {}
var _native_attempted := false

func _enter_tree() -> void:
	# Register while autoloads enter the tree.  Headless acceptance scripts run
	# from SceneTree._initialize(), before ordinary _ready() callbacks, so doing
	# this later would make the test see a false, timing-dependent empty registry.
	ensure_registration()

func ensure_registration() -> void:
	ContentRegistry.register_room(build_room_composition)
	ContentRegistry.register("terrain-cell-5m", _build_terrain)
	ContentRegistry.register("interior-floor-5m", _build_interior_floor)
	ContentRegistry.register("water-ribbon-5m", _build_water)
	ContentRegistry.register("rough-edge-boundary-kit", _build_boundary)
	ContentRegistry.register("bridge-span-5m", _build_bridge)

func _ready() -> void:
	_shared_available = ResourceLoader.exists(ROCK_SMALL_A) and ResourceLoader.exists(BRIDGE_WOOD)

func _exit_tree() -> void:
	if is_instance_valid(_native_source):
		_native_source.free()

func _load_native_catalog() -> void:
	if _native_attempted:
		return
	_native_attempted = true
	var selections: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/shared_asset_selections.json"))
	for recipe in selections.get("roomCompositions", []):
		_room_compositions[recipe.cellId] = recipe
	var spec: Dictionary = selections.get("nativeCatalog", {})
	var path: String = spec.get("runtimePath", "")
	if path.is_empty() or not ResourceLoader.exists(path):
		return
	var provenance: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(spec.provenancePath))
	_native_source = (load(path) as PackedScene).instantiate()
	for record in provenance.assets:
		_native_records[record.assetId] = record

## Match both identity and the source-description hash. A renamed/re-described
## room must not silently inherit old art. Positions/links remain untouched.
func build_room_composition(cell: Dictionary) -> Node3D:
	_load_native_catalog()
	var recipe: Dictionary = _room_compositions.get(cell.get("id", ""), {})
	if recipe.is_empty() or _native_source == null:
		return null
	if cell.get("sourceDescriptionHash", "") != recipe.descriptionHash:
		return null
	var size := ContentRegistryScript.block_size_metres(cell)
	var ground_top := ContentRegistryScript.block_top_y(cell)
	var holder := Node3D.new()
	holder.name = "AuthoredTownGreen"
	holder.set_meta("review_status", recipe.status)
	holder.set_meta("missing_content", recipe.missing)
	holder.set_meta("description_hash", recipe.descriptionHash)
	for placement in recipe.pieces:
		var record: Dictionary = _native_records.get(placement.assetId, {})
		if record.is_empty():
			holder.free()
			return null
		var model: Node3D = _native_source.get_node(record.nativeNode).duplicate()
		var dimensions: Array = record.bounds.size
		var yaw := deg_to_rad(float(placement.yawDegrees))
		var rotated_width: float = absf(cos(yaw)) * dimensions[0] + absf(sin(yaw)) * dimensions[2]
		var rotated_depth: float = absf(sin(yaw)) * dimensions[0] + absf(cos(yaw)) * dimensions[2]
		var factor := minf(size.x * placement.envelope[0] / rotated_width, size.z * placement.envelope[1] / rotated_depth)
		model.scale = Vector3.ONE * factor
		model.rotation.y = yaw
		model.position = Vector3(placement.center[0] * size.x, ground_top + placement.lift, placement.center[1] * size.z)
		if placement.assetId.ends_with(".grass-verge"):
			# This ground kit is rectangular. Fill the published footprint exactly;
			# keep its top at the height already used by tokens and exit anchors.
			model.scale.x = size.x / dimensions[0]
			model.scale.z = size.z / dimensions[2]
			model.position.y = ground_top - dimensions[1] * factor
		model.visible = true
		model.set_meta("asset_id", placement.assetId)
		holder.add_child(model)
	return holder

func shared_asset_status() -> Dictionary:
	# Validate the exact reviewed glTF files, rather than trusting the editor's
	# generated import cache. This keeps a fresh headless checkout honest and
	# avoids importing the complete shared catalog just to use two models.
	var stone := _load_shared_gltf(ROCK_SMALL_A)
	var bridge := _load_shared_gltf(BRIDGE_WOOD)
	_shared_available = stone != null and bridge != null
	if stone != null:
		stone.free()
	if bridge != null:
		bridge.free()
	return {
		"sharedLibraryAvailable": _shared_available,
		"registeredKinds": ["terrain-cell-5m", "interior-floor-5m", "water-ribbon-5m", "rough-edge-boundary-kit", "bridge-span-5m"],
		"fallbackPolicy": "matte procedural geometry when the pinned shared submodule is unavailable",
	}

## The ground a cell stands on is the ground that cell published.
##
## These three read `5.0, 5.0` and discarded their cell argument. That number
## was CELL_PITCH_METRES retyped, so the largest surface a player looks at could
## not follow the manifest anywhere: a board compiled at a different spacing
## would have kept drawing 5 m planes (issue #362, and the same defect #345 took
## out of content_registry.gd).
##
## What it is *not* is a missing gutter, which is what the issue expected and
## what the obvious fix - shrink the ground to the block - would have acted on.
## Two captures of a board at the minimum pitch settled that by looking:
## docs/verification/terrain-gutter-2026-09-05.md. With the ground cut down to
## the block, neighbouring blocks have nothing between them but their own
## unshaded risers, and at the fixed isometric camera they merge into one
## unbroken mass with no room boundaries left. The pitch-sized ground is what
## draws each room's outline - the gutter a player sees is the ground showing
## round the block's edge, not a hole in the world.
##
## So the size still comes from the cell, through `board.ground`, which the
## compiler publishes as one pitch square per room. The value is the same 5 m it
## always was; the difference is that it is now the manifest's number rather
## than this file's.
func _build_terrain(cell: Dictionary, _primitive: Dictionary) -> Node3D:
	var ground := ContentRegistryScript.ground_size_metres(cell)
	return _plane_piece("TerrainCell", Color("#58724b"), ground.x, ground.y, 0.0)

func _build_interior_floor(cell: Dictionary, _primitive: Dictionary) -> Node3D:
	# An intentionally neutral floor: an interior remains a documented content
	# slot until a room's description produces a reviewed composition recipe.
	var ground := ContentRegistryScript.ground_size_metres(cell)
	return _plane_piece("InteriorFloor", Color("#5a5046"), ground.x, ground.y, 0.015)

func _build_water(cell: Dictionary, _primitive: Dictionary) -> Node3D:
	var ground := ContentRegistryScript.ground_size_metres(cell)
	var water := _plane_piece("WaterRibbon", Color("#3b7699"), ground.x, ground.y, 0.03)
	var material := water.get_child(0).material_override as StandardMaterial3D
	material.metallic = 0.08
	material.roughness = 0.28
	return water

func _build_boundary(_cell: Dictionary, _primitive: Dictionary) -> Node3D:
	var holder := Node3D.new()
	holder.name = "RoughEdgeBoundary"
	var left := _shared_or_fallback(ROCK_SMALL_A, "BoundaryRockA", Vector3(0.9, 0.9, 0.9))
	left.position = Vector3(-1.6, 0.14, 0.6)
	left.rotation.y = 0.35
	holder.add_child(left)
	var right := _shared_or_fallback(ROCK_SMALL_B, "BoundaryRockB", Vector3(0.72, 0.72, 0.72))
	right.position = Vector3(1.2, 0.1, -0.65)
	right.rotation.y = -0.5
	holder.add_child(right)
	return holder

func _build_bridge(_cell: Dictionary, _primitive: Dictionary) -> Node3D:
	var bridge := _shared_or_fallback(BRIDGE_WOOD, "BridgeSpan", Vector3.ONE)
	bridge.position.y = 0.08
	return bridge

func _plane_piece(piece_name: String, color: Color, width: float, depth: float, y: float) -> Node3D:
	var holder := Node3D.new()
	holder.name = piece_name
	var mesh_instance := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(width, depth)
	mesh_instance.mesh = plane
	mesh_instance.material_override = _matte_material(color)
	holder.add_child(mesh_instance)
	holder.position.y = y
	return holder

func _shared_or_fallback(resource_path: String, piece_name: String, scale_value: Vector3) -> Node3D:
	var holder := Node3D.new()
	holder.name = piece_name
	var instance := _load_shared_gltf(resource_path)
	if instance != null:
		instance.scale = scale_value
		holder.add_child(instance)
		return holder
	_warn_shared_assets_once(resource_path)
	var fallback := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(1.2, 0.35, 0.8)
	fallback.mesh = box
	fallback.material_override = _matte_material(Color("#77695a"))
	holder.add_child(fallback)
	return holder

func _load_shared_gltf(resource_path: String) -> Node3D:
	# A release export contains Godot's imported PackedScene, not the raw GLB
	# bytes. Prefer that representation when it exists. Fresh headless checkouts
	# deliberately do not import the entire shared catalog, so retain a raw-GLB
	# fallback for the exact reviewed file selected by this content pack.
	if ResourceLoader.exists(resource_path):
		var imported := load(resource_path)
		if imported is PackedScene:
			return (imported as PackedScene).instantiate() as Node3D
	if not FileAccess.file_exists(resource_path):
		return null
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	if document.append_from_file(resource_path, state) != OK:
		return null
	return document.generate_scene(state) as Node3D

func _matte_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.92
	material.metallic = 0.0
	return material

func _warn_shared_assets_once(resource_path: String) -> void:
	if _warned_missing_shared_assets:
		return
	_warned_missing_shared_assets = true
	push_warning("Shared asset library is unavailable or not imported (%s). Using honest matte fallback geometry; initialise the godot/shared-assets submodule for vetted source models." % resource_path)
