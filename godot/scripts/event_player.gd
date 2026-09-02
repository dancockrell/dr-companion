extends Node
## Plays `PresentationEvent`s in strict sequence order.
##
## Nothing plays a tactical effect ahead of its confirmed event, and nothing
## plays an event out of order — a `hit` arriving before its `attack` would
## visually claim an outcome before the swing existed. This slice has no
## live event source yet (that is Slice 3's "tactical table"), so this file
## is exercised today only by its own tests, but the ordering contract is
## real from the start: content packs building effects in a later slice
## register against `event_played`, not against a raw event stream, so this
## file is the only place sequence gaps get handled.

signal event_played(event: Dictionary)
## Emitted when a gap is detected (an event arrived whose sequence is more
## than one past the last played event) — the same "dropped event" case the
## brief's recovery contract covers. This file does not resolve the gap
## itself; it is `BridgeClient`'s job to request a fresh snapshot when this
## fires, the same as any other reconnect.
signal sequence_gap_detected(expected: int, received: int)

var _last_played_sequence: int = 0
## Events that arrived out of order, held until the gap before them fills
## or a snapshot reset clears them. Keyed by sequence number so a duplicate
## delivery of the same event is naturally deduplicated.
var _pending: Dictionary = {}

## Resets ordering state to `sequence` — called whenever `BridgeClient`
## delivers a fresh snapshot (initial load, reconnect, or a recovery after a
## detected gap), since a snapshot is itself the authoritative "here is
## where the sequence stands now," not something this file should second-
## guess by continuing to wait for older events.
func reset_to(sequence: int) -> void:
	_last_played_sequence = sequence
	_pending.clear()

## Feeds one event in. Plays it immediately if it is exactly the next one in
## sequence, then drains any pending events that chain on from it. Emits
## `sequence_gap_detected` (once per gap, not once per event) if it arrives
## ahead of where playback is.
func offer(event: Dictionary) -> void:
	var seq: int = event.get("sequence", -1)
	if seq <= _last_played_sequence:
		return  # Already played, or older than our reset point - not a gap, just a duplicate/stale delivery.
	if seq == _last_played_sequence + 1:
		_play(event)
		_drain_pending()
		return
	if not _pending.has(seq):
		_pending[seq] = event
		sequence_gap_detected.emit(_last_played_sequence + 1, seq)

func _drain_pending() -> void:
	while _pending.has(_last_played_sequence + 1):
		var next_seq := _last_played_sequence + 1
		var event: Dictionary = _pending[next_seq]
		_pending.erase(next_seq)
		_play(event)

func _play(event: Dictionary) -> void:
	_last_played_sequence = event.get("sequence", _last_played_sequence)
	event_played.emit(event)
