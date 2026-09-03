extends RefCounted
## One presentation policy for live DragonRealms combat facts.
##
## Both the tabletop tokens and the accessible room inspector use this file,
## so "fresh", "stale", "unassessed", and player urgency cannot drift into
## two conflicting meanings. It formats bridge facts only. It never infers
## damage, range, duration, hostility, or an outcome.

const FRESH_ASSESS_SECONDS := 30.0
const AGING_ASSESS_SECONDS := 90.0
const ELANTHIPEDIA_SEARCH := "https://elanthipedia.play.net/Special:Search?search="

static func assessment_state(entity: Dictionary) -> String:
	var tactical_value = entity.get("tactical")
	if not tactical_value is Dictionary:
		return "unassessed"
	var age = tactical_value.get("enrichedAgeSeconds")
	if age == null:
		return "live-only"
	var seconds := maxf(0.0, float(age))
	if seconds <= FRESH_ASSESS_SECONDS:
		return "fresh"
	if seconds <= AGING_ASSESS_SECONDS:
		return "aging"
	return "stale"

static func tactical_summary(entity: Dictionary) -> String:
	var tactical_value = entity.get("tactical")
	if not tactical_value is Dictionary:
		return "Tactics not assessed"
	var tactical: Dictionary = tactical_value
	var parts: Array[String] = []
	if bool(tactical.get("dead", false)):
		parts.append("dead")
	elif bool(tactical.get("disengaged", false)):
		parts.append("disengaged")
	var range_name := str(tactical.get("range", "")).strip_edges()
	parts.append(range_name if not range_name.is_empty() else "range unknown")
	for status in _clean_strings(tactical.get("statuses", [])):
		parts.append(status)
	for condition in _clean_strings(tactical.get("conditions", [])):
		parts.append(condition)
	var state := assessment_state(entity)
	if state == "aging":
		parts.append("aging assess")
	elif state == "stale":
		parts.append("stale assess")
	elif state == "live-only":
		parts.append("assess unknown")
	return " · ".join(parts)

static func tactical_tooltip(entity: Dictionary) -> String:
	var lines: Array[String] = []
	var display_name := str(entity.get("name", "Unknown")).strip_edges()
	lines.append(display_name if not display_name.is_empty() else "Unknown")
	var tactical_value = entity.get("tactical")
	if not tactical_value is Dictionary:
		lines.append("Tactical state has not been assessed.")
	else:
		var tactical: Dictionary = tactical_value
		_add_fact(lines, "Range", tactical.get("range"))
		_add_fact(lines, "Position", tactical.get("relation"))
		_add_fact(lines, "Engaging", tactical.get("target"))
		_add_fact(lines, "Balance", tactical.get("balance"))
		if bool(tactical.get("offBalance", false)):
			lines.append("Off balance")
		if bool(tactical.get("disengaged", false)):
			lines.append("Disengaged from combat")
		if bool(tactical.get("dead", false)):
			lines.append("Dead")
		var statuses := _clean_strings(tactical.get("statuses", []))
		if not statuses.is_empty():
			lines.append("Live status: %s" % ", ".join(statuses))
		var conditions := _clean_strings(tactical.get("conditions", []))
		if not conditions.is_empty():
			lines.append("Assessed conditions: %s" % ", ".join(conditions))
		var age = tactical.get("enrichedAgeSeconds")
		if age == null:
			lines.append("No timed assess is available; pushed status may still be current.")
		else:
			lines.append("Assess age: %d seconds (%s)" % [maxi(0, int(age)), assessment_state(entity)])
	_append_lore(lines, entity)
	return "\n".join(lines)

static func player_view(player_value) -> Dictionary:
	if not player_value is Dictionary:
		return {
			"known": false,
			"state": "PLAYER STATE UNKNOWN",
			"healthKnown": false,
			"healthPercent": 0.0,
			"healthText": "Health not received",
			"roundtime": null,
			"flags": [],
		}
	var player: Dictionary = player_value
	var roundtime = player.get("roundtime")
	var state := "READY"
	if bool(player.get("cannotAct", false)):
		state = "CANNOT ACT"
	elif roundtime != null and float(roundtime) > 0.0:
		state = "ROUND TIME"
	var health = player.get("health")
	var health_known := health != null
	var fraction := clampf(float(health), 0.0, 1.0) if health_known else 0.0
	return {
		"known": true,
		"state": state,
		"healthKnown": health_known,
		"healthPercent": fraction * 100.0,
		"healthText": "%d%% health" % roundi(fraction * 100.0) if health_known else "Health not received",
		"roundtime": maxf(0.0, float(roundtime)) if roundtime != null else null,
		"flags": _clean_strings(player.get("situation", [])),
	}

static func elanthipedia_search_url(name: String) -> String:
	var query := name.strip_edges()
	return "" if query.is_empty() else ELANTHIPEDIA_SEARCH + query.uri_encode()

static func token_color(entity: Dictionary) -> Color:
	var deck := str(entity.get("deck", ""))
	var base := Color(0.58, 0.58, 0.65)
	match deck:
		"hostile": base = Color(0.88, 0.25, 0.22)
		"allied": base = Color(0.20, 0.72, 0.42)
		"people": base = Color(0.30, 0.58, 0.92)
	var tactical_value = entity.get("tactical")
	if tactical_value is Dictionary and bool(tactical_value.get("dead", false)):
		return Color(0.24, 0.23, 0.25)
	if assessment_state(entity) == "stale":
		return base.lerp(Color(0.42, 0.40, 0.38), 0.55)
	return base

static func assessment_color(state: String) -> Color:
	match state:
		"fresh": return Color(0.20, 0.82, 0.73)
		"aging": return Color(0.96, 0.67, 0.18)
		"stale": return Color(0.55, 0.39, 0.29)
		"live-only": return Color(0.42, 0.68, 0.90)
		_: return Color(0.48, 0.48, 0.52)

static func player_color(player_value) -> Color:
	var view := player_view(player_value)
	if not bool(view.get("known", false)):
		return Color(0.48, 0.48, 0.52)
	if str(view.get("state", "")) == "CANNOT ACT":
		return Color(0.96, 0.22, 0.18)
	var health_percent := float(view.get("healthPercent", 100.0))
	if bool(view.get("healthKnown", false)) and health_percent <= 35.0:
		return Color(0.95, 0.48, 0.15)
	if str(view.get("state", "")) == "ROUND TIME":
		return Color(0.95, 0.72, 0.22)
	return Color(0.24, 0.78, 0.52)

static func _add_fact(lines: Array[String], label: String, value) -> void:
	if value == null:
		return
	var text := str(value).strip_edges()
	if not text.is_empty():
		lines.append("%s: %s" % [label, text])

static func _clean_strings(values) -> Array[String]:
	var result: Array[String] = []
	if not values is Array:
		return result
	for value in values:
		var text := str(value).strip_edges()
		if not text.is_empty():
			result.append(text)
	return result

static func _append_lore(lines: Array[String], entity: Dictionary) -> void:
	var lore_value = entity.get("lore")
	if not lore_value is Dictionary:
		return
	var lore: Dictionary = lore_value
	lines.append("Elanthipedia lore%s:" % (" (approximate noun match)" if bool(entity.get("loreApproximate", false)) else ""))
	_add_fact(lines, "Level", lore.get("level"))
	_add_fact(lines, "Body", lore.get("bodyType"))
	_add_fact(lines, "Size", lore.get("bodySize"))
	_add_fact(lines, "Attack range", lore.get("attackRange"))
	var traits: Array[String] = []
	for pair in [["castsSpells", "spellcaster"], ["stealthy", "stealthy"], ["skinnable", "skinnable"], ["hasBoxes", "carries boxes"], ["hasCoins", "carries coins"], ["hasGems", "carries gems"]]:
		if bool(lore.get(pair[0], false)):
			traits.append(pair[1])
	if not traits.is_empty():
		lines.append("Known traits: %s" % ", ".join(traits))
