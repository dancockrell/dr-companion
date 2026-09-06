extends SceneTree
var checked := 0
var failed := 0
func check(value: bool, label: String) -> void:
	checked += 1
	if not value:
		failed += 1
		push_error(label)
func _initialize() -> void:
	call_deferred("_run")
func _run() -> void:
	var loader = root.get_node("WorldManifestLoader")
	check(loader.load_from_path("res://assets/crossing/world.json"), "Full packaged Crossing loads")
	check(loader.cells.size() == 1060, "Every compiled room is available")
	var source: Dictionary = loader.get_cell("1-14").duplicate(true)
	var live := {"id": source.id, "title": source.title, "position": {"x": 901, "y": 17, "z": -23}, "board": source.board, "exits": [{"move": "verified-only", "targetCellId": null}]}
	var before := JSON.stringify(live)
	var enriched: Dictionary = loader._enrich_content(live, "1")
	check(enriched.get("sourceDescriptionHash") == source.sourceDescriptionHash, "Live identity gets compiled content")
	check(enriched.position == live.position and enriched.exits == live.exits and enriched.board == live.board, "Live geometry and exits win unchanged")
	check(JSON.stringify(live) == before, "Source snapshot not mutated")
	check(not loader._enrich_content(live, "TF1").has("contentEvidence"), "Other world refused")
	var wrong := live.duplicate(true)
	wrong.title = "Something else"
	check(not loader._enrich_content(wrong, "1").has("contentEvidence"), "Changed title refused")
	wrong = live.duplicate(true)
	wrong.sourceDescriptionHash = "changed-live-description"
	check(not loader._enrich_content(wrong, "1").has("contentEvidence"), "Conflicting live hash refused")
	var cell: Node3D = root.get_node("ContentRegistry").build_cell(enriched)
	check(cell.name == "AuthoredTownGreen", "Enriched live-shaped cell reaches actual content factory")
	cell.free()
	check(loader.get_cell("1-191").sourceDescriptionId == "1::Milgrym's Weapons, Showroom", "Weaponsmith no longer borrows Berolt")
	check(loader.get_cell("1-192").sourceDescriptionId == "1::Tembeg's Armory, Salesroom", "Armory no longer borrows food shop")
	print("%d checked, %d failed" % [checked, failed])
	quit(1 if failed else 0)
