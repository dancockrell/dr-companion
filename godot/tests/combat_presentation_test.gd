extends SceneTree
## Honest live-combat presentation policy gate.

const CombatPresentation := preload("res://scripts/combat_presentation.gd")

var _checked := 0
var _failed := 0

func _initialize() -> void:
	print("-- DR Companion 3D combat presentation gate --")
	var unassessed := {"name": "a wild boar", "deck": "hostile"}
	_ok("absence stays explicitly unassessed", CombatPresentation.assessment_state(unassessed) == "unassessed")
	_ok("unassessed never receives a guessed range", CombatPresentation.tactical_summary(unassessed) == "Tactics not assessed")

	var fresh := {
		"name": "a wild boar",
		"deck": "hostile",
		"tactical": {
			"range": "melee", "relation": "in front of you", "target": "you",
			"balance": "off", "offBalance": true, "disengaged": false, "dead": false,
			"statuses": ["stunned"], "conditions": ["cursed"], "enrichedAgeSeconds": 12,
		},
		"lore": {"level": 3, "attackRange": "Melee", "skinnable": true},
	}
	_ok("a recent assess is fresh", CombatPresentation.assessment_state(fresh) == "fresh")
	_ok("summary carries exact range and live status", CombatPresentation.tactical_summary(fresh).contains("melee") and CombatPresentation.tactical_summary(fresh).contains("stunned"))
	var detail := CombatPresentation.tactical_tooltip(fresh)
	_ok("detail carries relation, target, balance, age, and sourced lore", detail.contains("Position: in front of you") and detail.contains("Engaging: you") and detail.contains("Balance: off") and detail.contains("Assess age: 12 seconds") and detail.contains("Elanthipedia lore"))

	var stale: Dictionary = fresh.duplicate(true)
	stale["tactical"]["enrichedAgeSeconds"] = 121
	_ok("an old assess is marked stale", CombatPresentation.assessment_state(stale) == "stale" and CombatPresentation.tactical_summary(stale).contains("stale assess"))
	_ok("stale tactical paint is visibly muted", CombatPresentation.token_color(stale) != CombatPresentation.token_color(fresh))
	_ok("assessment ages have distinct marker colors", CombatPresentation.assessment_color("fresh") != CombatPresentation.assessment_color("stale") and CombatPresentation.assessment_color("unassessed") != CombatPresentation.assessment_color("fresh"))

	var unknown_player := CombatPresentation.player_view(null)
	_ok("missing player data is unknown, never healthy", not unknown_player.healthKnown and unknown_player.state == "PLAYER STATE UNKNOWN")
	var locked_player := CombatPresentation.player_view({"cannotAct": true, "roundtime": 8, "health": 0.43, "situation": ["in_combat", "stunned"]})
	_ok("bridge action lock remains the urgent state", locked_player.state == "CANNOT ACT")
	_ok("health is clamped and presented as a percentage", locked_player.healthPercent == 43.0 and locked_player.healthText == "43% health")
	_ok("roundtime and verbatim flags survive presentation", locked_player.roundtime == 8.0 and locked_player.flags == ["in_combat", "stunned"])
	_ok("an action lock visibly outranks ordinary ready state", CombatPresentation.player_color({"cannotAct": true, "health": 1.0}) != CombatPresentation.player_color({"cannotAct": false, "health": 1.0}))
	_ok("wiki action is an encoded Elanthipedia search", CombatPresentation.elanthipedia_search_url("a wild boar") == "https://elanthipedia.play.net/Special:Search?search=a%20wild%20boar")

	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
