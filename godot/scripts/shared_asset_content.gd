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

const SHARED_ROOT := "res://shared-assets/resource-packs"
const ROCK_SMALL_A := SHARED_ROOT + "/geometry/geology/tabletop-weathered-stone-v1/models/rock_smallA.glb"
const ROCK_SMALL_B := SHARED_ROOT + "/geometry/geology/tabletop-weathered-stone-v1/models/rock_smallB.glb"
const BRIDGE_WOOD := SHARED_ROOT + "/source/cc0/kenney/nature-kit-2.1/bridge_woodNarrow.glb"

var _shared_available := false
var _warned_missing_shared_assets := false

func _enter_tree() -> void:
	# Register while autoloads enter the tree.  Headless acceptance scripts run
	# from SceneTree._initialize(), before ordinary _ready() callbacks, so doing
	# this later would make the test see a false, timing-dependent empty registry.
	ensure_registration()

func ensure_registration() -> void:
	ContentRegistry.register("terrain-cell-5m", _build_terrain)
	ContentRegistry.register("interior-floor-5m", _build_interior_floor)
	ContentRegistry.register("water-ribbon-5m", _build_water)
	ContentRegistry.register("rough-edge-boundary-kit", _build_boundary)
	ContentRegistry.register("bridge-span-5m", _build_bridge)

func _ready() -> void:
	_shared_available = ResourceLoader.exists(ROCK_SMALL_A) and ResourceLoader.exists(BRIDGE_WOOD)

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

func _build_terrain(_cell: Dictionary, _primitive: Dictionary) -> Node3D:
	return _plane_piece("TerrainCell", Color("#58724b"), 5.0, 5.0, 0.0)

func _build_interior_floor(_cell: Dictionary, _primitive: Dictionary) -> Node3D:
	# An intentionally neutral floor: an interior remains a documented content
	# slot until a room's description produces a reviewed composition recipe.
	return _plane_piece("InteriorFloor", Color("#5a5046"), 5.0, 5.0, 0.015)

func _build_water(_cell: Dictionary, _primitive: Dictionary) -> Node3D:
	var water := _plane_piece("WaterRibbon", Color("#3b7699"), 5.0, 5.0, 0.03)
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
