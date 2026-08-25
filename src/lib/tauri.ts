/**
 * Thin wrappers around Tauri APIs when running inside the native shell.
 * In the browser (vite dev) these no-op safely.
 * Uses dynamic import via Function to avoid hard dependency on @tauri-apps/api types.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  if (!isTauri()) return undefined
  // Avoid static resolve of @tauri-apps/api so web builds don't need the package
  const importer = new Function('m', 'return import(m)') as (m: string) => Promise<{
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  }>
  try {
    const mod = await importer('@tauri-apps/api/core')
    return await mod.invoke(cmd, args)
  } catch (e) {
    console.warn('Tauri invoke failed', cmd, e)
    return undefined
  }
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

  const importer = new Function('m', 'return import(m)') as (m: string) => Promise<{
    listen: (
      e: string,
      cb: (ev: { payload: T }) => void
    ) => Promise<() => void>
  }>

  void importer('@tauri-apps/api/event')
    .then(async (mod) => {
      const off = await mod.listen(event, (ev) => handler(ev.payload))
      if (disposed) off()
      else unlisten = off
    })
    .catch((e) => console.warn('Tauri listen failed', event, e))

  return () => {
    disposed = true
    unlisten?.()
  }
}
