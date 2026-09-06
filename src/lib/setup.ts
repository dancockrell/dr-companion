/**
 * Typed wrappers over the native setup commands.
 *
 * Nothing here downloads anything on its own. `planSetup` looks and reports;
 * every fetch is a separate call the user triggered after seeing what it is.
 */

import { isTauri, invokeTauri, listenTauri } from './tauri.ts'

export type Presence = 'present' | 'outdated' | 'missing' | 'unknown'

export interface DownloadOption {
  id: string
  label: string
  url: string
  bytes: number
  /** Empty when upstream publishes no digest. The UI must say so, not imply one. */
  sha256: string
  version: string
  dest: string
  /** 'extract' unpacks it for you; 'installer' needs a second yes. */
  after: 'extract' | 'installer'
  prerelease: boolean
  why: string
  note: string
  recommended: boolean
  /** Shipped inside this app - install via `installBundledRuby4Lich5`, not
   * `downloadComponent`. `url` is not a fetchable address on one of these. */
  bundled: boolean
}

/** One file inside a bundle, pinned by its git blob hash. */
export interface BundleFile {
  name: string
  bytes: number
  sha: string
  url: string
}

export type Remedy =
  | { kind: 'choose'; options: DownloadOption[]; note: string }
  | {
      kind: 'bundle'
      label: string
      files: BundleFile[]
      bytes: number
      target: string
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
  /** Pre-0.1.1 builds left downloads and Lich inside the program folder. */
  dataWarning: string | null
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
    | (Omit<SetupPlan, 'offlineNote' | 'dataWarning'> & {
        offline_note: string | null
        data_warning: string | null
      })
    | undefined
  if (!res) return null
  return {
    components: res.components,
    ready: res.ready,
    offlineNote: res.offline_note ?? null,
    dataWarning: res.data_warning ?? null,
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

/**
 * Copy the bundled Ruby4Lich5 out to where a download would have landed,
 * verifying it again on the way. Takes no path or URL - unlike
 * `downloadComponent`, which is reachable from this same webview with
 * whatever arguments it is given, this command resolves the bundled location
 * itself, so there is nothing here for a compromised or buggy caller to
 * redirect. See `install_bundled_ruby4lich5`'s own doc comment in setup.rs.
 */
export async function installBundledRuby4Lich5(): Promise<DownloadResult> {
  const res = (await invokeTauri('install_bundled_ruby4lich5')) as DownloadResult | undefined
  if (!res) throw new Error('install did not complete')
  return res
}

export async function extractArchive(
  archive: string,
  targetName: string,
  expect?: string
): Promise<string> {
  return (await invokeTauri('extract_archive', {
    archive,
    targetName,
    expect: expect ?? null,
  })) as string
}

export async function installBridgeScript(): Promise<string> {
  return (await invokeTauri('install_bridge_script')) as string
}

export async function revealFile(path: string): Promise<void> {
  await invokeTauri('reveal_file', { path })
}

/**
 * What to answer on Ruby4Lich5's folder question.
 *
 * Its "Select Additional Tasks - Lich5 Folder Location" page defaults to the
 * Desktop and labels that option "preferred for Gemstone IV". This is a
 * DragonRealms client, so a player clicking Next through the defaults is told
 * by a page we sent them to that they picked the other game's layout. Observed
 * on a clean VM, 5 Sep 2026 (docs/verification/first-run-2026-09-05.md,
 * Defect 2).
 *
 * Nothing is broken by either answer: that run took the Desktop default and
 * detection found Lich there and installed the bridge correctly. So this says
 * both work rather than pushing anyone back through an installer they have
 * already finished.
 *
 * Here rather than inline in the card so it can be asserted as a value.
 */
export const RUBY4LICH5_FOLDER_NOTE =
  'One of its questions is where to put Lich: the Desktop default, which it ' +
  'labels as preferred for Gemstone IV, or C:\\Ruby4Lich5\\Lich5, which it ' +
  'labels as preferred for DragonRealms. Both work with this app. The second ' +
  'keeps Lich beside the Ruby that runs it. If you already picked Desktop, ' +
  'leave it: this app finds either.'

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

/**
 * Install a set of repo files, each verified against its git blob hash.
 *
 * Used for the plugin and map bundles that ship as files in a repo rather than
 * as release assets, so there is no release checksum to check them against.
 */
export async function installBundle(
  id: string,
  files: BundleFile[],
  target: string
): Promise<string> {
  return (await invokeTauri('install_bundle', { id, files, target })) as string
}

/**
 * Is another game client running, and could we tell? (E11)
 *
 * Renamed in N6, not deleted, and the rename is the point: this was never
 * about the route the app used to take. Two processes cannot both hold the
 * detachable port, and starting a second client has taken the connection out
 * from under a live session on this machine twice, with no error either time.
 *
 * Three answers, not two. `known: false` means the process list could not be
 * read at all, which must never be rendered as "nothing else is running": a
 * player whose live session is about to lose its connection deserves better
 * than a confident wrong answer.
 *
 * Nothing in this app closes anything. It may be a session someone is playing,
 * and taking the port out from under a running client is precisely the
 * accident this warning exists to prevent.
 */
export async function frontendConflictStatus(): Promise<{ running: boolean; known: boolean }> {
  if (!isTauri()) return { running: false, known: false }
  const res = (await invokeTauri('frontend_conflict_status')) as
    | { running?: boolean; known?: boolean }
    | null
  return { running: res?.running ?? false, known: res?.known ?? false }
}
