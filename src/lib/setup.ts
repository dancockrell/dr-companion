/**
 * Typed wrappers over the native setup commands.
 *
 * Nothing here downloads anything on its own. `planSetup` looks and reports;
 * every fetch is a separate call the user triggered after seeing what it is.
 */

import { isTauri, invokeTauri, listenTauri } from './tauri'

export type Presence = 'present' | 'outdated' | 'missing' | 'unknown'

export type Remedy =
  | {
      kind: 'download'
      label: string
      url: string
      bytes: number
      sha256: string
      version: string
      dest: string
      /** 'extract' unpacks it for you; 'installer' needs a second yes. */
      after: 'extract' | 'installer'
      note: string
    }
  | { kind: 'manual'; instructions: string; link: string }
  | { kind: 'none' }

export interface ComponentPlan {
  id: string
  label: string
  presence: Presence
  detail: string
  path: string | null
  required: boolean
  remedy: Remedy
}

export interface SetupPlan {
  components: ComponentPlan[]
  ready: boolean
  offlineNote: string | null
}

export interface Progress {
  id: string
  received: number
  total: number
  phase: 'downloading' | 'verified'
}

export interface DownloadResult {
  path: string
  bytes: number
  sha256: string
  verified: boolean
}

/** Look at the machine. Returns null in the browser, where we cannot look. */
export async function planSetup(): Promise<SetupPlan | null> {
  if (!isTauri()) return null
  const res = (await invokeTauri('plan_setup')) as
    | (Omit<SetupPlan, 'offlineNote'> & { offline_note: string | null })
    | undefined
  if (!res) return null
  return {
    components: res.components,
    ready: res.ready,
    offlineNote: res.offline_note ?? null,
  }
}

export async function downloadComponent(
  id: string,
  url: string,
  sha256: string,
  dest: string
): Promise<DownloadResult> {
  const res = (await invokeTauri('download_component', {
    id,
    url,
    expectedSha256: sha256,
    dest,
  })) as DownloadResult | undefined
  if (!res) throw new Error('download did not complete')
  return res
}

export async function extractLich(archive: string): Promise<string> {
  const res = (await invokeTauri('extract_lich', { archive })) as string
  return res
}

export async function installBridgeScript(): Promise<string> {
  return (await invokeTauri('install_bridge_script')) as string
}

export async function revealFile(path: string): Promise<void> {
  await invokeTauri('reveal_file', { path })
}

/** Separate from downloading, on purpose. Running something is its own yes. */
export async function runInstaller(path: string): Promise<void> {
  await invokeTauri('run_installer', { path })
}

export async function appDataPath(): Promise<string> {
  return ((await invokeTauri('app_data_path')) as string) ?? ''
}

export function onSetupProgress(fn: (p: Progress) => void) {
  return listenTauri<Progress>('setup://progress', fn)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
