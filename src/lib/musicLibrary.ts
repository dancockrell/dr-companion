/**
 * Where a music track's bytes actually are, and how they get there.
 *
 * # The gap this closes
 *
 * `public/audio/` is gitignored and pulled by `tools/vendor-audio.mjs`, which
 * nothing in `npm run build`, `npm run tauri:build` or `.github/workflows/
 * release.yml` runs. So every installer ever produced carried none of the 182
 * tracks `data/audio/manifest.json` names, and #383 made the app say so
 * honestly - a `Music not installed` state with a disabled transport and no
 * dead Retry. Honest, and a dead end: there was nothing a listener could do
 * about it.
 *
 * # Why a download and not a bigger installer
 *
 * Measured by fetching all 182 and weighing what landed, because a HEAD sweep
 * of the same URLs was wrong in a way that looked right: Wikimedia rate-limited
 * it and answered 168 of them with a 2144-byte error page whose
 * `content-length` reads like a small file. The real total is recorded per
 * entry as `bytes` in the manifest, and `MUSIC_LIBRARY_BYTES` sums it. It is
 * many times the size of the whole installer, so bundling it would make every
 * player pay for a feature most will never turn on.
 *
 * So it works the way the setup wizard's other downloads work, and for the
 * reason docs/SETUP-POLICY.md gives: nothing is installed without the player
 * choosing it, the size is on the button before it is pressed, and every file
 * is sha256-pinned. The pins ship inside the installer (this manifest is
 * committed), so there is no manifest to fetch and no manifest-fetch to
 * verify.
 *
 * # One resolver
 *
 * `audioUrl` is the only place a track's URL is built. A bundled `/audio/...`
 * when the build has one, the installed copy in the app data directory when it
 * does not. Two builders would drift the moment one of them learned about the
 * second location.
 */
import manifest from '../../data/audio/manifest.json' with { type: 'json' }
import { invokeTauri, isTauri, listenTauri } from './tauri.ts'

/** Where a build that ships its own audio serves it from. */
const BUNDLED_AUDIO_PREFIX = '/audio/'

export interface MusicTrackSource {
  file: string
  download: string
  sha256: string
  bytes: number
}

interface RawEntry {
  file?: string
  download?: string
  sha256?: string
  bytes?: number
}

/**
 * Every entry the vendor script fetches, which is the definition of "the
 * library" - one set, not a second list that could disagree with
 * `tools/vendor-audio.mjs` about what a complete install is.
 *
 * An entry with no pin is left out rather than downloaded unverified. That
 * makes an unpinned manifest show up as a smaller library instead of as an
 * unchecked download; `tools/music-library-test.mjs` fails the build if any
 * entry is unpinned, so the two together mean "quietly fewer tracks" is not a
 * state anybody can ship.
 */
export const MUSIC_TRACKS: MusicTrackSource[] = (
  [
    ...Object.values((manifest.biome ?? {}) as Record<string, RawEntry>),
    ...Object.values((manifest.zone ?? {}) as Record<string, RawEntry>),
    ...((manifest.radio ?? []) as RawEntry[]),
  ] as RawEntry[]
)
  .filter(
    (e): e is Required<RawEntry> =>
      typeof e.file === 'string' &&
      typeof e.download === 'string' &&
      typeof e.sha256 === 'string' &&
      e.sha256.length === 64 &&
      typeof e.bytes === 'number' &&
      e.bytes > 0
  )
  .map((e) => ({ file: e.file, download: e.download, sha256: e.sha256, bytes: e.bytes }))

/** What the install actually costs, for the button that offers it. */
export const MUSIC_LIBRARY_BYTES = MUSIC_TRACKS.reduce((sum, t) => sum + t.bytes, 0)

/**
 * Bytes as a person reads them. `??` is not involved and zero is meaningful:
 * a library measured at 0 bytes means the manifest lost its sizes, and
 * "0 B" on the button is the right way for that to be visible.
 */
export function formatLibrarySize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export interface MusicLibraryStatus {
  dir: string
  installed: number
  total: number
  bytesInstalled: number
  bytesTotal: number
  complete: boolean
}

/**
 * Where an installed library is being served from, or null when there is not
 * one. Module state rather than a React hook because `ambientSound.ts` is not
 * a component and builds track URLs from outside the tree.
 */
let installedBase: string | null = null

/** Test seam: forget what was found, so a case can set up its own world. */
export function resetInstalledMusicBase() {
  installedBase = null
}

/** Only for tests and for `refreshMusicLibrary`; see `audioUrl`. */
export function setInstalledMusicBase(base: string | null) {
  installedBase = base
}

export function installedMusicBase(): string | null {
  return installedBase
}

/**
 * The one place a track URL is built.
 *
 * Bundled first: a build that does ship `public/audio/` (a dev server, or any
 * future release that bundles it) keeps working with no install and no probe.
 * The installed copy is the fallback, which is also the order of trust - the
 * bundled file came with the signed app.
 */
export function audioUrl(file: string): string {
  if (installedBase) return `${installedBase}/${file}`
  return `${BUNDLED_AUDIO_PREFIX}${file}`
}

/**
 * Is this URL one of ours?
 *
 * Read by `ambientSound.ts` to tell a curated track from a listener's own
 * stream, which is the difference between "the library is missing" and "this
 * one source failed". It has to follow `audioUrl` rather than test for
 * `/audio/`: once a library is installed the same track is served from the app
 * data directory, and a hardcoded prefix would start calling every installed
 * track somebody's custom stream.
 */
export function isLibraryUrl(src: string): boolean {
  if (installedBase && src.startsWith(`${installedBase}/`)) return true
  return src.startsWith(BUNDLED_AUDIO_PREFIX)
}

/**
 * Ask Rust what is on disk, and remember where to play it from.
 *
 * Returns null in a browser, where there is no app data directory to look in -
 * "I could not look" rather than "nothing is installed", because folding those
 * together is how a dev-server preview would start claiming things about a
 * machine it cannot see.
 */
export async function refreshMusicLibrary(): Promise<MusicLibraryStatus | null> {
  if (!isTauri()) return null
  const raw = (await invokeTauri('music_library_status', { tracks: MUSIC_TRACKS })) as
    | {
        dir: string
        installed: number
        total: number
        bytes_installed: number
        bytes_total: number
        complete: boolean
      }
    | undefined
  if (!raw) return null
  const status: MusicLibraryStatus = {
    dir: raw.dir,
    installed: raw.installed,
    total: raw.total,
    bytesInstalled: raw.bytes_installed,
    bytesTotal: raw.bytes_total,
    complete: raw.complete,
  }
  installedBase = status.complete ? await assetBase(status.dir) : null
  return status
}

/**
 * The asset-protocol URL for the library directory. Imported lazily so a web
 * build that never calls this does not have to resolve it at module load.
 */
async function assetBase(dir: string): Promise<string | null> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    return convertFileSrc(dir).replace(/\/+$/, '')
  } catch {
    return null
  }
}

export interface MusicInstallProgress {
  received: number
  total: number
  phase: string
}

/**
 * Download the library. Nothing here runs until a person presses the button
 * this is wired to - there is no timer, no first-run trigger and no retry
 * loop.
 */
export async function installMusicLibrary(
  onProgress?: (p: MusicInstallProgress) => void
): Promise<MusicLibraryStatus | null> {
  if (!isTauri()) {
    throw new Error('Installing the music library needs the desktop app.')
  }
  const stop = onProgress
    ? listenTauri<{ id: string; received: number; total: number; phase: string }>(
        'setup://progress',
        (p) => {
          if (p.id !== 'music') return
          onProgress({ received: p.received, total: p.total, phase: p.phase })
        }
      )
    : null
  try {
    await invokeTauri('install_music_library', { tracks: MUSIC_TRACKS })
  } finally {
    stop?.()
  }
  return await refreshMusicLibrary()
}

export async function cancelMusicInstall(): Promise<void> {
  await invokeTauri('cancel_music_install')
}
