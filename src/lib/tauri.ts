/**
 * Thin wrappers around Tauri APIs when running inside the native shell.
 * In the browser (vite dev) these no-op safely.
 * Uses dynamic import via Function to avoid hard dependency on @tauri-apps/api types.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
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

/** One component's real, detected state. Mirrors ComponentStatus in lib.rs. */
export interface DetectedComponent {
  id: string
  status: 'ready' | 'missing'
  detail: string
  path?: string | null
}

/**
 * Ask the native shell what is actually installed.
 *
 * Returns null in the browser, where we genuinely cannot look. Callers must
 * treat null as "unknown", never as "missing" and never as "ready" — the whole
 * point is to stop the wizard asserting things it has not checked.
 */
export async function detectComponents(): Promise<DetectedComponent[] | null> {
  if (!isTauri()) return null
  const res = await invokeTauri('detect_components')
  return Array.isArray(res) ? (res as DetectedComponent[]) : null
}

/** The exact command shown to the user before anything runs. */
export async function rubyInstallCommand(): Promise<string> {
  const cmd = await invokeTauri('ruby_install_command')
  return typeof cmd === 'string'
    ? cmd
    : 'winget install --id RubyInstallerTeam.RubyWithDevKit.3.3 --source winget'
}

/** Copy our own bridge script into Lich's scripts folder. */
export async function installBridgeScript(
  source: string
): Promise<string | null> {
  if (!isTauri()) return null
  const res = await invokeTauri('install_bridge_script', { source })
  return typeof res === 'string' ? res : null
}
