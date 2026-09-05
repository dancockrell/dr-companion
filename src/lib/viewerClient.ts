/**
 * Talking to the Godot world viewer and to the bridge that serves it.
 *
 * Split out of `presentationBridge.ts`, which compiles and publishes the world
 * snapshot. These three calls do neither: they ask Rust whether a viewer is
 * installed or running, start one, and report the port and token file a client
 * needs to dial in. A settings panel wants exactly this and none of the
 * compiler, so it should not have to import the compiler to get it.
 */
import { invokeTauri } from './tauri.ts'

/** What a Godot client needs to connect: the port it should dial, and where
 * its token lives. Same shape as `pythonTasks.ts`'s `ScriptApiInfo` - the
 * Rust command was written mirroring `script_api_info` for exactly this use
 * (a settings panel confirming the socket is up, or pointing a non-Godot
 * client at it by hand) and had no caller until now. */
export type PresentationBridgeInfo = {
  /** `null` before `presentation_bridge::start` has bound the listener. */
  port: number | null
  tokenPath: string
}

/**
 * Whether the Godot world viewer can be started, and whether it is up.
 *
 * `runningKnown` is false when the process list could not be read at all -
 * never collapse that into `running: false`, because "no viewer" and "could
 * not look" send a person to two different places. Same three-state contract
 * as the Rust side and as `lich.rs` before it.
 */
export type ViewerStatus = {
  installed: boolean
  /** Where the executable is, so a person can confirm which build they are
   * about to run. Null when none was found. */
  path: string | null
  running: boolean
  runningKnown: boolean
  /** The exit status of the viewer this app started, once it has one. Null
   * when none was launched this session or one is still running, so it is
   * only meaningful beside `running` - `viewerExitNote` is the one place that
   * reads the pair. */
  exitCode: number | null
}

export async function viewerStatus(): Promise<ViewerStatus> {
  const raw = (await invokeTauri('viewer_status')) as Partial<ViewerStatus> | undefined
  return {
    installed: raw?.installed ?? false,
    path: raw?.path ?? null,
    running: raw?.running ?? false,
    runningKnown: raw?.runningKnown ?? false,
    // ?? not ||, because 0 is the ordinary exit code of a viewer somebody
    // closed themselves and is exactly the case worth telling apart.
    exitCode: raw?.exitCode ?? null,
  }
}

/**
 * The one word the bridge panel shows for the viewer's state.
 *
 * Pure and here rather than as a ternary inside the component, because the
 * interesting cases are the ones nothing renders in a browser preview: no
 * viewer built, and a process list that could not be read. Both used to be
 * unreachable from any test, and "cannot tell" collapsing into "ready" is
 * exactly the confusion this three-state contract exists to prevent.
 */
export function viewerStateLabel(status: ViewerStatus | null, checking: boolean): string {
  if (!status) return checking ? 'checking…' : '—'
  if (!status.installed) return 'not built yet'
  if (status.running) return 'open'
  if (viewerExitNote(status)) return 'exited'
  if (!status.runningKnown) return 'installed, cannot tell if open'
  return 'ready'
}

/**
 * What to say about a viewer that is no longer running, or null when there is
 * nothing to say.
 *
 * Pure, and kept out of the panel, because the interesting part is which
 * combinations mean nothing: a null code is "never launched, or still up",
 * and saying "exited" over either of those is worse than saying nothing at
 * all.
 */
export function viewerExitNote(status: ViewerStatus | null): string | null {
  if (!status || status.running || status.exitCode === null) return null
  return status.exitCode === 0
    ? 'The viewer was closed.'
    : `The viewer exited (code ${status.exitCode}).`
}

/** Starts the viewer. Rejects with a readable reason when there is nothing to
 * start or one is already open; the caller shows it rather than swallowing it. */
export async function launchViewer(): Promise<string> {
  return (await invokeTauri('launch_viewer')) as string
}

export async function presentationBridgeInfo(): Promise<PresentationBridgeInfo> {
  const raw = (await invokeTauri('presentation_bridge_info')) as
    | { port?: number | null; tokenPath?: string }
    | undefined
  return { port: raw?.port ?? null, tokenPath: raw?.tokenPath ?? '' }
}

/**
 * One confirmed thing that happened, for the ordered stream Godot's
 * `event_player.gd` consumes.
 *
 * Mirrors the Rust `PresentationEvent` (`presentation_bridge.rs`), which
 * serialises camelCase. `authoritativeText` is the name the contract gives it
 * and it is not decoration: Godot presents what the game said, and never
 * decides for itself whether something happened.
 */
export interface PresentationEvent {
  protocol: 1
  sequence: number
  roomId: string
  kind: string
  sourceEntityId?: string
  targetEntityId?: string
  authoritativeText: string
  range?: number
}

/**
 * The sequence every published event carries.
 *
 * Module-level and monotonic, because the stream is ordered and a consumer
 * that cannot tell two events apart cannot replay them. Separate from
 * `presentationBridge.ts`'s snapshot sequence on purpose - snapshots and
 * events are two streams, and sharing one counter would make a gap in either
 * look like a dropped message in the other.
 */
let eventSequence = 0

/** The next sequence, without publishing. For a test that needs to know where
 * the counter is rather than inferring it from a publish. */
export function presentationEventSequence(): number {
  return eventSequence
}

/**
 * Publish one event to every connected viewer.
 *
 * `publish_presentation_event` has existed on the Rust side since the bridge
 * was written and nothing called it - the callerless-command sweep has been
 * listing it ever since. This is the caller.
 *
 * The sequence only advances once Rust has accepted the publish, the same rule
 * `publishWorldSnapshotIfChanged` follows: a failed native call throws, and a
 * counter advanced before the failure would leave a permanent hole that looks
 * to Godot like a message it never received.
 */
export async function publishPresentationEvent(
  event: Omit<PresentationEvent, 'protocol' | 'sequence'>
): Promise<number> {
  const sequence = eventSequence + 1
  await invokeTauri('publish_presentation_event', {
    event: { protocol: 1, sequence, ...event },
  })
  eventSequence = sequence
  return sequence
}
