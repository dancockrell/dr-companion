extends Camera3D
## The fixed-view isometric world / route / room camera. One camera, one director —
## never a hard cut between separate map/radar/battle views, which is the
## whole point of the single-viewer requirement. Distance and framing change
## smoothly (via a Tween); the compass heading, projection, and angle stay
## locked. The *mode* is which framing rule is currently
## driving that tween, not a different camera or a different scene.

enum Mode { WORLD, ROUTE, ROOM }

## How far above the focus point the camera sits at each distance, and how
## wide a footprint it frames. These are deliberately generous starting
## values for a placeholder-content viewer, not tuned final camera work —
## Codex's content and later playtesting will retune them; nothing here
## claims to be final art direction.
const FRAMING := {
	Mode.WORLD: {"height": 140.0, "size": 220.0},
	Mode.ROUTE: {"height": 45.0, "size": 70.0},
	Mode.ROOM: {"height": 14.0, "size": 24.0},
}

const ISOMETRIC_PITCH_DEG := -35.264
const ISOMETRIC_YAW_DEG := 45.0

const TRANSITION_SECONDS := 0.6

var mode: Mode = Mode.WORLD
var focus_position: Vector3 = Vector3.ZERO

var _tween: Tween

func _ready() -> void:
	projection = Camera3D.PROJECTION_ORTHOGONAL
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
	var target_transform := _transform_for(position, framing["height"])

	if _tween != null and _tween.is_valid():
		_tween.kill()
	_tween = create_tween()
	_tween.set_parallel(true)
	_tween.set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	_tween.tween_property(self, "global_transform", target_transform, TRANSITION_SECONDS)
	_tween.tween_property(self, "size", framing["size"], TRANSITION_SECONDS)

func _apply_immediate(to_mode: Mode, position: Vector3) -> void:
	mode = to_mode
	focus_position = position
	var framing: Dictionary = FRAMING[to_mode]
	global_transform = _transform_for(position, framing["height"])
	size = framing["size"]

func _transform_for(position: Vector3, height: float) -> Transform3D:
	# True isometric framing: equal X/Z heading and the classic 35.264 degree
	# elevation. Rotation is intentionally not an interactive control.
	var pitch: float = deg_to_rad(ISOMETRIC_PITCH_DEG)
	var horizontal_offset: float = height / maxf(0.001, tan(-pitch))
	var yaw: float = deg_to_rad(ISOMETRIC_YAW_DEG)
	var eye := position + Vector3(sin(yaw) * horizontal_offset, height, cos(yaw) * horizontal_offset)
	var t := Transform3D()
	t.basis = Basis.looking_at(position - eye, Vector3.UP)
	t.origin = eye
	return t
