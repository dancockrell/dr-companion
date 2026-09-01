/**
 * Thin wrappers around Tauri APIs when running inside the native shell.
 * In the browser these no-op safely, so the demo works with no backend.
 *
 * **The imports below are static on purpose.**
 *
 * They used to be hidden inside `new Function('m', 'return import(m)')`, so a
 * web build would not need the package. That works under `npm run dev`,
 * because Vite's dev server resolves bare specifiers on request. It fails in
 * every packaged build, because the string is invisible to the bundler and a
 * browser cannot resolve `@tauri-apps/api/core` by itself.
 *
 * So every native command failed in the shipped app: no detection, no
 * downloads, no installs, no bridge, no window pinning. It ran the demo and
 * nothing else. Nobody saw it because the failure was caught and returned as
 * `undefined`, and the setup screen read that as "nothing is required" and
 * printed the word "Ready".
 *
 * A static import costs a few KB in the web build and cannot break this way.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export function isTauri(): boolean {
  // Some browser/dev shims declare the property with an undefined value.
  // Presence alone made the web preview render native-only controls whose
  // backend could never exist, producing buttons that appeared to do nothing.
  return (
    typeof window !== 'undefined' &&
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  )
}

/**
 * Call into Rust.
 *
 * Returns `undefined` only in the browser, where there is genuinely no backend
 * to call. Inside the app a failure **throws**, so callers have to decide what
 * to do about it. Swallowing it is what let the bug above ship.
 */
export async function invokeTauri(
  cmd: string,
  args?: Record<string, unknown>
): Promise<unknown> {
  if (!isTauri()) return undefined
  return await invoke(cmd, args)
}

export async function setAlwaysOnTop(value: boolean): Promise<void> {
  await invokeTauri('set_always_on_top', { value })
}

export async function getBridgeDefaultUrl(): Promise<string> {
  const url = await invokeTauri('bridge_default_url')
  return typeof url === 'string' ? url : 'ws://127.0.0.1:7415/companion'
}


/**
 * Subscribe to a Tauri event. No-ops in the browser.
 * Returns an unsubscribe function (a no-op when not running natively).
 */
export function listenTauri<T>(
  event: string,
  handler: (payload: T) => void
): () => void {
  if (!isTauri()) return () => {}
  let disposed = false
  let unlisten: (() => void) | null = null

  void listen<T>(event, (ev) => handler(ev.payload))
    .then((off) => {
      if (disposed) off()
      else unlisten = off
    })
    // Kept as a warning rather than a throw: this returns an unsubscribe
    // function synchronously, so there is no caller to hand an error to. The
    // only consequence is missing progress updates, not a wrong answer.
    .catch((e) => console.warn('Tauri listen failed', event, e))

  return () => {
    disposed = true
    unlisten?.()
  }
}
