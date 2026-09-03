extends Camera3D
## The continuous world / route / room camera. One camera, one director —
## never a hard cut between separate map/radar/battle views, which is the
## whole point of the single-viewer requirement. Distance and framing change
## smoothly (via a Tween); the *mode* is which framing rule is currently
## driving that tween, not a different camera or a different scene.

enum Mode { WORLD, ROUTE, ROOM }

## How far above the focus point the camera sits at each distance, and how
## wide a footprint it frames. These are deliberately generous starting
## values for a placeholder-content viewer, not tuned final camera work —
## Codex's content and later playtesting will retune them; nothing here
## claims to be final art direction.
const FRAMING := {
	Mode.WORLD: {"height": 140.0, "pitch_deg": -55.0, "fov": 55.0},
	Mode.ROUTE: {"height": 45.0, "pitch_deg": -50.0, "fov": 50.0},
	Mode.ROOM: {"height": 14.0, "pitch_deg": -42.0, "fov": 45.0},
}

const TRANSITION_SECONDS := 0.6

var mode: Mode = Mode.WORLD
var focus_position: Vector3 = Vector3.ZERO

var _tween: Tween

func _ready() -> void:
	_apply_immediate(Mode.WORLD, Vector3.ZERO)

## Smoothly moves the camera to frame `position` at `to_mode`'s distance.
## Called by whatever is driving the current focus (a room-change snapshot,
## a player selecting a route, a "back to the whole city" control) — this
## function itself has no opinion on when those happen, only how the camera
## gets there once told to.
func focus_on(to_mode: Mode, position: Vector3) -> void:
	mode = to_mode
	focus_position = position
	var framing: Dictionary = FRAMING[to_mode]
	var target_transform := _transform_for(position, framing["height"], framing["pitch_deg"])

	if _tween != null and _tween.is_valid():
		_tween.kill()
	_tween = create_tween()
	_tween.set_parallel(true)
	_tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_tween.tween_property(self, "global_transform", target_transform, TRANSITION_SECONDS)
	_tween.tween_property(self, "fov", framing["fov"], TRANSITION_SECONDS)

func _apply_immediate(to_mode: Mode, position: Vector3) -> void:
	mode = to_mode
	focus_position = position
	var framing: Dictionary = FRAMING[to_mode]
	global_transform = _transform_for(position, framing["height"], framing["pitch_deg"])
	fov = framing["fov"]

func _transform_for(position: Vector3, height: float, pitch_deg: float) -> Transform3D:
	# A fixed compass heading (looking north-ish along -Z, offset south so the
	# focus point isn't directly underfoot) kept simple on purpose: an
	# orbit/rotate control is real future work, not something this
	# foundation slice needs to claim.
	var pitch: float = deg_to_rad(pitch_deg)
	var back_offset: float = height / maxf(0.001, tan(-pitch))
	var eye := position + Vector3(0, height, back_offset)
	var t := Transform3D()
	t.basis = Basis.looking_at(position - eye, Vector3.UP)
	t.origin = eye
	return t
