extends Node
## Loads a deterministic world manifest (a compiled Crossing zone, or the
## checked-in mock fixture) into the shapes this viewer works with.
##
## This is the only place that reads a manifest file. It never invents a
## cell, an exit, or a position that is not already in the JSON — the
## manifest is compiled upstream, by `tools/build-primitive-world-manifest.mjs`
## from the room graph and map data, and this loader's whole job is to trust
## that compilation and hand back typed data, not to re-derive topology.
##
## `WorldSnapshot` (the live bridge message, once it exists) and a loaded
## manifest file share the same cell shape on purpose: `BridgeClient`'s mock
## mode constructs its `WorldSnapshot` directly from a loaded manifest, so
## there is one code path for "what a cell looks like," not two that could
## drift.

signal manifest_loaded(cell_count: int, route_count: int)
signal manifest_load_failed(reason: String)

## Cell id -> Dictionary, in the shape produced by
## build-primitive-world-manifest.mjs's `cells` array (id, roomId, title,
## position, exits, tags, primitives, palette, ...).
var cells: Dictionary = {}

## The full parsed manifest, kept for fields callers may need
## (schemaVersion, bounds, generatedFrom) without a second read.
var manifest: Dictionary = {}

var _loaded: bool = false

func is_loaded() -> bool:
	return _loaded

## Loads a manifest (or mock fixture) from an absolute `res://` path.
## Returns true on success. Never partially populates `cells` on failure —
## a bad load leaves the previous state (or empty) untouched, so a caller
## can tell "nothing loaded" from "something wrong loaded" by checking the
## return value, not by inspecting `cells` afterward.
func load_from_path(path: String) -> bool:
	if not FileAccess.file_exists(path):
		manifest_load_failed.emit("no such file: %s" % path)
		return false
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		manifest_load_failed.emit("could not open: %s" % path)
		return false
	var text := file.get_as_text()
	file.close()

	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		manifest_load_failed.emit("manifest is not a JSON object: %s" % path)
		return false
	if not parsed.has("cells") or typeof(parsed["cells"]) != TYPE_ARRAY:
		manifest_load_failed.emit("manifest has no 'cells' array: %s" % path)
		return false

	var next_cells: Dictionary = {}
	for raw_cell in parsed["cells"]:
		if typeof(raw_cell) != TYPE_DICTIONARY or not raw_cell.has("id"):
			manifest_load_failed.emit("a cell is missing its id in: %s" % path)
			return false
		next_cells[raw_cell["id"]] = raw_cell

	cells = next_cells
	manifest = parsed
	_loaded = true
	var route_count: int = parsed["routes"].size() if parsed.has("routes") and typeof(parsed["routes"]) == TYPE_ARRAY else _count_exits()
	manifest_loaded.emit(cells.size(), route_count)
	return true

func get_cell(cell_id: String) -> Dictionary:
	return cells.get(cell_id, {})

func has_cell(cell_id: String) -> bool:
	return cells.has(cell_id)

## The only exits this viewer is allowed to draw for a cell: exactly what the
## manifest carries for it, nothing inferred and nothing added. An exit whose
## `targetCellId` is null is a real exit the mock/manifest could not resolve
## locally (points outside the loaded subset, or is marked `external`) — it
## is still a true exit and still gets an anchor, it just has nowhere local
## to walk the camera to yet.
func true_exits(cell_id: String) -> Array:
	var cell := get_cell(cell_id)
	if cell.is_empty() or not cell.has("exits"):
		return []
	return cell["exits"]

## Whether `exit_move` is one of `cell_id`'s real, manifest-carried exits.
## `IntentSender` calls this before it will ever construct a walk intent —
## the one place in this viewer a click could otherwise turn into a made-up
## exit if this check were skipped.
func is_true_exit(cell_id: String, exit_move: String) -> bool:
	for exit in true_exits(cell_id):
		if exit.get("move", "") == exit_move:
			return true
	return false

func _count_exits() -> int:
	var total := 0
	for cell_id in cells.keys():
		total += cells[cell_id].get("exits", []).size()
	return total
