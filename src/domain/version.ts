/**
 * The version of the game-agnostic domain model.
 *
 * PROPOSAL — nothing imports this yet. See docs/ADAPTERS.md.
 *
 * # Why this exists before there is a second adapter
 *
 * The moment somebody else's adapter depends on these types, changing them
 * stops being free. Adding the version afterwards means the first cohort of
 * adapters targets an unnamed version, and every later compatibility question
 * gets answered by guessing which commit they were written against.
 *
 * One constant and one check, now, is the whole cost.
 *
 * # What the numbers mean
 *
 * - **major** — a field was removed, renamed, or re-typed. Existing adapters
 *   are expected to break, and the registry refuses to load one whose major
 *   differs rather than letting it half-work.
 * - **minor** — a field or event kind was added. Older adapters keep working;
 *   they simply never emit the new thing.
 * - **patch** — documentation and semantics clarified, no shape change.
 *
 * # This is NOT the presentation-bridge protocol version
 *
 * `docs/THREE_D_REBUILD_HANDOFF.md` defines `protocol: 1` for the
 * Tauri↔Godot WorldSnapshot/PresentationEvent messages. That number versions
 * the *wire format between the app and one renderer*. This one versions the
 * *model adapters produce*. They move for different reasons and must not be
 * conflated: a new MUD capability bumps this and leaves the bridge alone; a
 * change to how the 3D viewer is fed bumps that and leaves adapters alone.
 */
export const DOMAIN_SCHEMA_VERSION = '1.0.0'

/** Parsed form, so callers do not each re-split the string. */
export const DOMAIN_SCHEMA_MAJOR = 1

/**
 * Whether an adapter targeting `declared` can be loaded against this core.
 *
 * Deliberately strict on major and permissive on minor: an adapter written
 * against 1.0 runs on a 1.4 core (it just never emits the newer things), but
 * an adapter written against 2.0 does not run on a 1.x core at all. The
 * asymmetry is the point — a newer adapter may depend on fields this core
 * cannot supply, and discovering that as `undefined` at runtime is exactly the
 * silent-wrongness this whole model is built to avoid.
 */
export function isCompatibleSchema(declared: string): boolean {
  const major = Number(declared.split('.')[0])
  return Number.isInteger(major) && major === DOMAIN_SCHEMA_MAJOR
}
