extends SceneTree
## Extract only the declared models, preserving native materials; no geometry generation.
## Run with --path godot --script ../tools/package-crossing-content.gd -- <shared repo>
func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	assert(args.size() == 1, "Supply the shared catalog checkout")
	var shared: String = args[0]
	var selections: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/shared_asset_selections.json"))
	var spec: Dictionary = selections.nativeCatalog
	var report: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(shared.path_join("docs/river-port-build/catalog/build-report.json")))
	var source_path := shared.path_join(spec.source)
	var source := (load(source_path) as PackedScene).instantiate()
	var output := Node3D.new()
	output.name = "TownGreenLibrary"
	var records: Array = []
	for record in report.assets:
		if not record.assetId in spec.assetIds:
			continue
		var model: Node3D = source.get_node(record.nativeNode).duplicate()
		output.add_child(model)
		model.visible = false
		_own(model, output)
		records.append(record)
	assert(records.size() == spec.assetIds.size(), "Missing requested model")
	DirAccess.make_dir_recursive_absolute("res://assets/crossing")
	var packed := PackedScene.new()
	assert(packed.pack(output) == OK)
	assert(ResourceSaver.save(packed, spec.runtimePath, ResourceSaver.FLAG_BUNDLE_RESOURCES) == OK)
	var provenance := {"repository": spec.repository, "revision": spec.revision,
		"sourceSha256": FileAccess.get_sha256(source_path), "runtimeSha256": FileAccess.get_sha256(spec.runtimePath),
		"materialSources": report.materialSources, "assets": records, "creditsConsumed": 0,
		"geometryLicense": "Project-authored; upstream records retained", "transformation": "Native subset only; textures and full geometry preserved"}
	var file := FileAccess.open(spec.provenancePath, FileAccess.WRITE)
	file.store_string(JSON.stringify(provenance, "\t") + "\n")
	file.close()
	source.free()
	output.free()
	print("Packaged %d native models" % records.size())
	quit()

func _own(node: Node, owner_root: Node) -> void:
	node.owner = owner_root
	for child in node.get_children():
		_own(child, owner_root)
