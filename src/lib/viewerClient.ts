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
}

export async function viewerStatus(): Promise<ViewerStatus> {
  const raw = (await invokeTauri('viewer_status')) as Partial<ViewerStatus> | undefined
  return {
    installed: raw?.installed ?? false,
    path: raw?.path ?? null,
    running: raw?.running ?? false,
    runningKnown: raw?.runningKnown ?? false,
  }
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
