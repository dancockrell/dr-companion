export type StopBackend = () => Promise<unknown>

/**
 * Attempt both independent task stops and contain either failure.
 *
 * Kept free of Tauri imports so the safety contract can be exercised with
 * real rejecting promises instead of a browser-preview mock.
 */
export function stopAllTaskBackends(
  stopPython: StopBackend,
  stopTypeScript: StopBackend
): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled([stopPython(), stopTypeScript()])
}
