extends Node
## Turns a click (or, in tests, a direct call) into a `PresentationIntent` —
## and never anything more than a request.
##
## This is the first of two gates a click passes through. `IntentSender`
## refuses to construct an intent at all when the exit isn't real, so an
## invalid click never even reaches `BridgeClient`; `BridgeClient` re-checks
## anyway (see its own comment) because a defensive boundary that trusts its
## only caller is not really a boundary. Neither gate is allowed to skip the
## other — that duplication is the point, not a mistake to clean up later.

signal intent_created(intent: Dictionary)
signal intent_refused(reason: String)

## Builds and sends a `walk` intent for `exit_move` out of `from_room_id`.
## Returns true if the intent was constructed and handed to the bridge —
## true does NOT mean the walk succeeded, only that a legitimate request was
## made; `BridgeClient.snapshot_updated` / `intent_rejected` carry the actual
## outcome, exactly as a real click's game command would need to be
## confirmed by the game before this viewer believes it happened.
func request_walk(from_room_id: String, exit_move: String) -> bool:
	if not WorldManifestLoader.is_true_exit(from_room_id, exit_move):
		intent_refused.emit("'%s' is not a true exit of %s" % [exit_move, from_room_id])
		return false
	var intent := {
		"kind": "walk",
		"fromRoomId": from_room_id,
		"exitMove": exit_move,
	}
	intent_created.emit(intent)
	BridgeClient.send_intent(intent)
	return true

## Read-only intents (inspect-entity / inspect-ground-item / focus-room)
## never mutate presentation state, so they skip BridgeClient.send_intent
## entirely — there is nothing for the bridge to confirm, only something for
## a UI panel to display from data the viewer already has.
func request_focus_room(room_id: String) -> bool:
	if not WorldManifestLoader.has_cell(room_id):
		intent_refused.emit("unknown room id: %s" % room_id)
		return false
	var intent := {"kind": "focus-room", "roomId": room_id}
	intent_created.emit(intent)
	return true
