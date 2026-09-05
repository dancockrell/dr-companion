extends SceneTree
## Every live-connection state the bridge client can emit must move the banner.
##
## `_show_live_status`'s docstring promises "the label can never outlive the
## condition it describes". It could: `bridge_client.gd` emitted
## `"server-error"`, `world_root.gd`'s match had no arm for it and neither
## prefix in the default caught it, so a server error arriving after
## `"connecting"` left "Connecting to DR Companion…" on screen for good
## (issue #341). One producer, zero consumers, and nothing could see it,
## because the state list lived twice: once as eleven `emit` calls and once as
## the arms of a `match` nobody diffed against them.
##
## So this test does not carry a list. It reads `bridge_client.gd` and pulls
## the states out of the emit sites themselves, which is the only version that
## cannot drift: a state added to the producer arrives here on the next run
## whether or not anyone remembered this file.
##
## Two things about the harness, both engine constraints rather than choices:
##
## - `world_root.gd` names the `BridgeClient` autoload at compile time, and an
##   autoload identifier is not resolvable while a `--script` run is loading
##   its own preloads. `load()` inside `_initialize` runs after they exist.
## - The viewer stays out of the scene tree, because entering it runs `_ready`
##   against eight sibling nodes that only `WorldRoot.tscn` supplies. That
##   leaves `_begin_live_retry()` unable to start a Timer, so a stand-in timer
##   is seeded before each call: `_begin_live_retry()` finds one already live
##   and leaves it alone. The banner, which is what is under test here, is
##   untouched either way.

const BRIDGE_SOURCE := "res://scripts/bridge_client.gd"
const WORLD_ROOT_SOURCE := "res://scripts/world_root.gd"

## What the banner is set to before each state is delivered. Any state that
## leaves this on screen has reproduced #341.
const SENTINEL := "PREVIOUS CONDITION, NOW OVER"

## Substitutions for the two format-string emits, so a `%s`/`%d` template is
## exercised as the concrete string a running viewer would actually receive.
const SAMPLE_REASON := "presentation bridge authentication failed"
const SAMPLE_ATTEMPT := "3"

## Nine distinct states exist today. Far enough below that adding or removing
## one never touches this, high enough that a regex which stops matching
## reports itself instead of certifying an empty list.
const MIN_STATES := 8

## GDScript has no catchable exception: a null dereference halfway through
## aborts the function and still lets the count print. The floor is what turns
## that into a failure instead of "0 checked, 0 failed".
const MIN_EXPECTED_CHECKS := 20

var _checked := 0
var _failed := 0

func _initialize() -> void:
	var source := _read(BRIDGE_SOURCE)
	var states := _emitted_states(source)

	_ok("the emit sites parse out of the bridge source (%d distinct states)" % states.size(),
		states.size() >= MIN_STATES)
	# A zero is a claim about the instrument first: these two are known to be
	# in that file, so a parser that misses them is broken rather than reading
	# a tree with nothing in it.
	_ok("the parser sees real emit sites, not an empty read",
		states.has("authenticated") and states.has("server-error"))
	# The regex only understands a literal first argument. If the producer ever
	# emits a variable, the list above silently shrinks and every per-state
	# check below passes on a smaller population — so count both.
	var total_emits := _count(source, 'live_connection_changed[.]emit[(]')
	var literal_emits := _count(source, 'live_connection_changed[.]emit[(]["]')
	_ok("every emit site passes a string literal the parser can read (%d of %d)" % [literal_emits, total_emits],
		total_emits > 0 and literal_emits == total_emits)

	var world = load(WORLD_ROOT_SOURCE).new()
	world._build_live_status()

	# Read out of the viewer rather than retyped here, for the same reason the
	# state list is: a copy of a string is a second thing that answers one
	# question, and the two drift.
	var constants: Dictionary = world.get_script().get_script_constant_map()
	var fallback: String = constants.get("LIVE_STATUS_UNRECOGNISED", "")
	var server_error_banner: String = constants.get("LIVE_STATUS_SERVER_ERROR", "")
	_ok("the viewer names its unrecognised-state banner, so a fall-through can be told apart from a handled state",
		fallback.contains("%s") and server_error_banner != "" and server_error_banner != fallback)

	# Two ways a state can be unhandled, and only the first is what #341 looked
	# like from the screen. The second is what it would look like once the
	# catch-all below exists: a banner that changed, said nothing useful, and
	# passed a "did the banner change" test.
	var stranded: Array = []
	var fell_through: Array = []
	for state in states:
		_deliver(world, state)
		var shown: String = world._live_status.text
		if shown == SENTINEL:
			stranded.append(state)
		elif shown == fallback % state:
			fell_through.append(state)
	_ok("no state the bridge emits leaves the previous banner standing (%d states, stranded: %s)"
		% [states.size(), str(stranded)], stranded.is_empty())
	_ok("every state the bridge emits is handled by name, not by the catch-all (fell through: %s)"
		% str(fell_through), fell_through.is_empty())
	for state in states:
		_deliver(world, state)
		_ok("the %s status replaces the previous banner" % state, world._live_status.text != SENTINEL)
		_ok("the %s status is handled by name" % state, world._live_status.text != fallback % state)

	# The specific defect, stated the way the issue does: a server error
	# arriving after "connecting" must not leave the connecting banner up.
	_deliver(world, "connecting")
	var connecting_text: String = world._live_status.text
	_deliver_without_reset(world, "server-error")
	_ok("a server-error replaces the connecting banner rather than sitting under it",
		world._live_status.text != connecting_text and not world._live_status.text.is_empty())
	_ok("a server-error is reported as a server error",
		world._live_status.text == server_error_banner)

	# The class, not just the instance: a state added to the producer tomorrow
	# and forgotten here must still say something.
	_deliver(world, "no-such-state-exists")
	_ok("an unhandled future state still replaces the banner",
		world._live_status.text != SENTINEL and not world._live_status.text.is_empty())

	_deliver(world, "authenticated")
	_ok("an authenticated bridge clears the banner", world._live_status.text.is_empty())
	_ok("a cleared banner is hidden rather than blank", not world._live_status.visible)
	_deliver(world, "connection-failed")
	_ok("a banner with text is visible", world._live_status.visible)

	if world._live_retry != null:
		world._live_retry.free()
	world.free()

	_ok("this script asserted at least %d checks" % MIN_EXPECTED_CHECKS, _checked >= MIN_EXPECTED_CHECKS)
	print("%d checked, %d failed" % [_checked, _failed])
	quit(1 if _failed > 0 else 0)

## Put a known previous condition on the banner, then deliver `state`.
func _deliver(world, state: String) -> void:
	world._show_live_status(SENTINEL)
	_deliver_without_reset(world, state)

func _deliver_without_reset(world, state: String) -> void:
	if world._live_retry == null:
		world._live_retry = Timer.new()
	world._on_live_connection_changed(state)

## The states `bridge_client.gd` can emit, read out of its emit sites. Format
## templates become the concrete strings a viewer would receive.
func _emitted_states(source: String) -> Array:
	var re := RegEx.new()
	re.compile('live_connection_changed[.]emit[(]["]([^"]*)["]')
	var states: Array = []
	for hit in re.search_all(source):
		var state: String = hit.get_string(1).replace("%s", SAMPLE_REASON).replace("%d", SAMPLE_ATTEMPT)
		if state != "" and not states.has(state):
			states.append(state)
	return states

func _count(source: String, pattern: String) -> int:
	var re := RegEx.new()
	re.compile(pattern)
	return re.search_all(source).size()

func _read(path: String) -> String:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return ""
	return file.get_as_text()

func _ok(label: String, condition: bool) -> void:
	_checked += 1
	if condition:
		print("OK   %s" % label)
	else:
		_failed += 1
		print("FAIL %s" % label)
