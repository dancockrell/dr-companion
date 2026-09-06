/**
 * What happens to Lich when this app closes. Issue #488 §3.
 *
 * # The decision, stated once
 *
 * A Lich this app started is a character somebody is playing. Closing a
 * companion window is not a request to log them out, so **nothing on the exit
 * path ends a Lich by itself** - not `RunEvent::Exit`, not a dropped `Child`
 * handle, not a crash. That is the same rule `lich.rs` has always followed for
 * a Lich it did not start ("this app does not end a Lich it did not start
 * ending"), and `src-tauri/src/lich.rs`'s `LichProcess` is where the lifetime
 * is written down on the Rust side.
 *
 * What the app *did* have was no way to say any of that to the player, and no
 * way for them to disagree. So closing asks, once, and only when there is
 * something to ask about: a Lich this app started that is still running. Rust
 * raises `lich-close-prompt` and holds the window shut; this module holds the
 * answer.
 *
 * Two answers, and they are the two the Rust side exposes:
 *
 * - **Leave it running** (the default, and what every unanswered case does
 *   anyway) - `lich_release`. The handle is given up and the process is not
 *   touched. The next start of the app finds it through the existing
 *   already-running detection and offers Attach.
 * - **Stop Lich** - `lich_stop`. Killed by the handle this app holds, never by
 *   image name: more than one Lich runs on this machine and a name-based kill
 *   would take somebody else's character offline.
 *
 * # Why this is not in the component
 *
 * So it can be driven without a DOM. The component below it renders two
 * buttons; every decision - when to prompt, which command each answer sends,
 * and that the window closes either way - is here, where a test can run it.
 */
import { invokeTauri, listenTauri } from './tauri.ts'

/** The payload `lib.rs` emits with `lich-close-prompt`. Rust's `OwnedLich`. */
export interface OwnedLich {
  ours: boolean
  running: boolean
  exit_code: number | null
}

/** What `lich_stop` says it did. Rust's `StopOutcome`. */
export type StopOutcome = 'not_ours' | 'already_gone' | 'killed'

/**
 * Whether the prompt should be on screen.
 *
 * Three things must all be true, and they are asserted here rather than in the
 * component so a test can state them: the app started the Lich, it is still
 * running, and Rust actually asked. A prompt for a Lich the player started
 * themselves would be offering to end a session this app has no business
 * ending; a prompt for an exited one would be asking about a process that is
 * not there.
 */
export function shouldPromptOnClose(owned: OwnedLich | null): boolean {
  return owned !== null && owned.ours && owned.running
}

/** Subscribe to the close question. Returns the unsubscribe. */
export function onLichClosePrompt(handler: (owned: OwnedLich) => void): () => void {
  return listenTauri<OwnedLich>('lich-close-prompt', handler)
}

/**
 * "Stop Lich", then close.
 *
 * The close happens whichever way the stop went, including a failure: the
 * player asked to leave, and a window that refuses to shut because a kill
 * returned an error is a worse outcome than a Lich that outlived the app -
 * which is the state everything else here is built to tolerate anyway.
 */
export async function stopLichAndClose(): Promise<StopOutcome | null> {
  let outcome: StopOutcome | null = null
  try {
    const said = await invokeTauri('lich_stop')
    outcome = typeof said === 'string' ? (said as StopOutcome) : null
  } catch (e) {
    console.warn('lich_stop failed; closing anyway and leaving Lich running', e)
  }
  await closeMainWindow()
  return outcome
}

/**
 * "Leave it running", then close. The default answer, and the one every
 * unanswered case (a crash, a kill, a webview that never replies) produces by
 * itself.
 */
export async function leaveLichRunningAndClose(): Promise<boolean> {
  let released = false
  try {
    released = (await invokeTauri('lich_release')) === true
  } catch (e) {
    console.warn('lich_release failed; closing anyway', e)
  }
  await closeMainWindow()
  return released
}

/**
 * Finish the close Rust prevented.
 *
 * `close_main_window` destroys rather than closes, so `CloseRequested` does not
 * fire again and ask the same question twice.
 */
async function closeMainWindow(): Promise<void> {
  try {
    await invokeTauri('close_main_window')
  } catch (e) {
    // Nothing left to try, and swallowing it silently would leave a window
    // that will not shut with no reason anywhere.
    console.warn('could not close the main window', e)
  }
}
