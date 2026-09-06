/**
 * Where a music track's bytes actually are, and how they get there.
 *
 * # The gap this closes
 *
 * `public/audio/` is gitignored and pulled by `tools/vendor-audio.mjs`, which
 * nothing in `npm run build` or `npm run tauri:build` runs - and nothing else
 * runs either, since CI was removed on 6 Sep 2026 and a release is now just
 * `npm run tauri:build` on somebody's machine. So every installer ever
 * produced carried none of the 182
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
 *
 * # Groups, because one 4.36 GB button was too big a thing to offer
 *
 * #396 shipped the whole library behind a single Install and said so plainly:
 * "4.36 GB is a large thing to offer behind one button." The unit of install
 * here is the grouping the manifest *already* has for playback, not a new
 * taxonomy invented for the installer - every radio entry carries a `station`,
 * and `ambientSound.ts` builds `RADIO_STATIONS` out of exactly that field. The
 * four biome loops carry no station and are one further group. So every track
 * is in exactly one group, the group sizes sum to the library, and the largest
 * single choice is 1.65 GB rather than 4.36.
 *
 * Presence is per-group and derived: Rust reports which pinned files are on
 * disk and this module decides what that means for a group. Rust never learns
 * about stations and this module never walks a directory, so there is one
 * walker and one grouping rather than two of each.
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
  /** Present on radio entries only - the manifest's own playback grouping. */
  station?: string
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
/**
 * The one group id for a manifest entry that has no `station`.
 *
 * The biome loops are the app's background ambience rather than a radio
 * station, so the manifest does not tag them with one - and a track with no
 * group would be a track no install could reach, which is the "in zero groups"
 * half of what `tools/music-library-test.mjs` refuses. Naming them here rather
 * than inventing a fake station in the data keeps the manifest describing what
 * these files are.
 */
export const AMBIENCE_GROUP_ID = 'ambience'

function groupIdOf(entry: RawEntry): string {
  return typeof entry.station === 'string' && entry.station.length > 0
    ? entry.station
    : AMBIENCE_GROUP_ID
}

interface PinnedEntry extends MusicTrackSource {
  group: string
}

const PINNED: PinnedEntry[] = (
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
  .map((e) => ({
    file: e.file,
    download: e.download,
    sha256: e.sha256,
    bytes: e.bytes,
    group: groupIdOf(e),
  }))

export const MUSIC_TRACKS: MusicTrackSource[] = PINNED.map((e) => ({
  file: e.file,
  download: e.download,
  sha256: e.sha256,
  bytes: e.bytes,
}))

/** What the whole install costs, for the button that offers all of it. */
export const MUSIC_LIBRARY_BYTES = MUSIC_TRACKS.reduce((sum, t) => sum + t.bytes, 0)

/**
 * One installable unit: a radio station's tracks, or the ambience loops.
 *
 * `tracks` is what `install_music_library` and `remove_music_group` are handed,
 * so a group is a real list of pinned files rather than a label the installer
 * has to re-derive.
 */
export interface MusicGroup {
  id: string
  name: string
  description: string
  tracks: MusicTrackSource[]
  bytes: number
}

const STATION_META = (manifest.radioStations ?? {}) as Record<
  string,
  { name?: string; description?: string }
>

/**
 * Every group, in the order their first track appears - the same order
 * `RADIO_STATIONS` lists stations in, so the Sound panel's install list and its
 * station list cannot present the four stations in two different orders.
 */
export const MUSIC_GROUPS: MusicGroup[] = (() => {
  const byId = new Map<string, MusicGroup>()
  for (const entry of PINNED) {
    let group = byId.get(entry.group)
    if (!group) {
      const meta = STATION_META[entry.group]
      group = {
        id: entry.group,
        name: meta?.name ?? (entry.group === AMBIENCE_GROUP_ID ? 'Ambience' : entry.group),
        description:
          meta?.description ??
          (entry.group === AMBIENCE_GROUP_ID
            ? 'Background loops for forests, towns, caves and dungeons.'
            : ''),
        tracks: [],
        bytes: 0,
      }
      byId.set(entry.group, group)
    }
    group.tracks.push({
      file: entry.file,
      download: entry.download,
      sha256: entry.sha256,
      bytes: entry.bytes,
    })
    group.bytes += entry.bytes
  }
  return [...byId.values()]
})()

/** File -> the id of the one group it belongs to. */
const GROUP_OF_FILE: Record<string, string> = Object.fromEntries(
  PINNED.map((e) => [e.file, e.group])
)

/** Which group a track's manifest path belongs to, or undefined if it is not
 * in the library at all. */
export function groupIdForFile(file: string): string | undefined {
  return GROUP_OF_FILE[file]
}

export function musicGroup(id: string): MusicGroup | undefined {
  return MUSIC_GROUPS.find((g) => g.id === id)
}

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

/**
 * What one group's files on disk add up to.
 *
 * Three states, not two, for the reason CLAUDE.md's section 1 gives about a
 * check that can only say yes or no: a group half-downloaded and then cancelled
 * is neither installed nor absent, and folding it into either is how a resume
 * turns into a restart or a partial library reads as a complete one. `missing`
 * is the exact count so the panel can say what is left rather than "some".
 */
export interface MusicGroupStatus {
  id: string
  name: string
  installed: number
  missing: number
  /**
   * How many of the missing tracks have a `.part` on disk: an interrupted
   * download the next install continues from rather than refetches.
   *
   * A group where every track is like that is `partial`, not `absent`. #402
   * found the other half of this - an interrupted download left a `.part`
   * nothing ever read or deleted - and a group that reported `absent` while
   * holding a gigabyte of half-files is the same lie from the panel's side.
   */
  partial: number
  /**
   * How many of this group's files are on disk in any form: finished tracks
   * plus interrupted downloads. What Remove would delete, in other words, and
   * the one number that gate is allowed to read.
   *
   * #423: Remove was gated on `installed > 0`, so a group whose every track
   * was cancelled part-way - `installed === 0`, `partial === 42` - offered
   * Resume and no Remove, and up to 1.65 GB of `.part` files could not be
   * deleted from anywhere in the app. `remove_tracks` deletes the `.part`
   * beside each track and always has; nothing ever called it in that state.
   * Derived here rather than added up at the button, so the panel and any
   * future caller cannot come to two answers about what is removable.
   */
  removable: number
  total: number
  bytesInstalled: number
  bytesTotal: number
  state: 'installed' | 'partial' | 'absent'
}

export interface MusicLibraryStatus {
  dir: string
  installed: number
  total: number
  bytesInstalled: number
  bytesTotal: number
  complete: boolean
  groups: MusicGroupStatus[]
}

/**
 * Where an installed library is being served from, or null when there is not
 * one. Module state rather than a React hook because `ambientSound.ts` is not
 * a component and builds track URLs from outside the tree.
 */
let installedBase: string | null = null

/**
 * Which pinned files Rust last reported on disk, or null for "nobody has
 * looked".
 *
 * Null is not an empty set. In a browser there is no app data directory to
 * look in, and a build that ships `public/audio/` needs no install at all;
 * reporting either as "every track is absent" would make the players below skip
 * every track they can actually play. So `trackPresence` answers `unknown`
 * there and the callers carry on as they did before groups existed.
 */
let presentFiles: Set<string> | null = null

/**
 * Which pinned files have an interrupted download beside them. Empty rather
 * than null: it is only ever read alongside `presentFiles`, which already
 * carries the "nobody has looked" answer for both.
 */
let partialFiles: Set<string> = new Set()

/** Test seam: forget what was found, so a case can set up its own world. */
export function resetInstalledMusicBase() {
  installedBase = null
  presentFiles = null
  partialFiles = new Set()
  libraryStatus = null
  setInstallRun(null)
}

/**
 * The one install that is running, as everything that draws a button reads it.
 *
 * #422: each `MusicInstallButton` used to keep its own `phase` in local state,
 * so the transport's two buttons and every row in the Sound panel stayed
 * clickable while another install ran - and pressing Cancel and then any other
 * Install discarded the cancel. Rust now refuses the second call outright; this
 * is the same fact on this side, in one place, so the buttons say so before
 * anybody presses one rather than after.
 *
 * `groupId` is null for the whole library, which is a real value and not
 * "unknown" - the run itself is null when nothing is installing.
 */
export interface MusicInstallRun {
  groupId: string | null
  groupName: string
  received: number
  total: number
}

let installRun: MusicInstallRun | null = null
const installListeners = new Set<(run: MusicInstallRun | null) => void>()

export function musicInstallRun(): MusicInstallRun | null {
  return installRun
}

/** Subscribe to the running install. Returns an unsubscribe function. */
export function onMusicInstallChange(fn: (run: MusicInstallRun | null) => void): () => void {
  installListeners.add(fn)
  return () => installListeners.delete(fn)
}

function setInstallRun(run: MusicInstallRun | null) {
  installRun = run
  for (const l of installListeners) l(installRun)
}

/** Only for tests: stand in for what Rust would have reported on disk. */
export function setInstalledMusicFiles(files: string[] | null, partials: string[] = []) {
  presentFiles = files === null ? null : new Set(files)
  partialFiles = new Set(partials)
  libraryStatus = presentFiles ? deriveStatus('', presentFiles, partialFiles) : null
  notifyLibrary()
}

/**
 * Is this track's file actually there?
 *
 * `unknown` is a third answer and not a polite `absent` - see `presentFiles`.
 * `ambientSound.ts` reads this to step past a track from a group nobody
 * installed instead of loading a URL that cannot resolve, which is the
 * difference between "the other three stations play" and "one absent group
 * silences the zone".
 */
export function trackPresence(file: string): 'present' | 'absent' | 'unknown' {
  if (!presentFiles) return 'unknown'
  return presentFiles.has(file) ? 'present' : 'absent'
}

/** Derive every group's state from the set of files on disk. One grouping, one
 * counting, both here - Rust reports files and nothing else. */
function deriveStatus(
  dir: string,
  present: Set<string>,
  partials: Set<string>
): MusicLibraryStatus {
  const groups: MusicGroupStatus[] = MUSIC_GROUPS.map((g) => {
    let installed = 0
    let partial = 0
    let bytesInstalled = 0
    for (const t of g.tracks) {
      if (present.has(t.file)) {
        installed++
        bytesInstalled += t.bytes
      } else if (partials.has(t.file)) {
        // Counted apart from `installed`, never into it: a `.part` is bytes
        // whose hash nobody has checked, and the byte totals below are what
        // the panel offers to install, so a half-file must not shrink them.
        partial++
      }
    }
    return {
      id: g.id,
      name: g.name,
      installed,
      missing: g.tracks.length - installed,
      partial,
      removable: installed + partial,
      total: g.tracks.length,
      bytesInstalled,
      bytesTotal: g.bytes,
      // An empty group is not an installed one, the same reason `status_of`
      // refuses to call an empty manifest a complete library. A group with
      // nothing finished but a download interrupted part-way is `partial`
      // rather than `absent` - #402 - so the row offers Resume and says what
      // is actually on the disk.
      state:
        g.tracks.length > 0 && installed === g.tracks.length
          ? 'installed'
          : installed === 0 && partial === 0
            ? 'absent'
            : 'partial',
    }
  })
  const installed = groups.reduce((n, g) => n + g.installed, 0)
  return {
    dir,
    installed,
    total: MUSIC_TRACKS.length,
    bytesInstalled: groups.reduce((n, g) => n + g.bytesInstalled, 0),
    bytesTotal: MUSIC_LIBRARY_BYTES,
    complete: MUSIC_TRACKS.length > 0 && installed === MUSIC_TRACKS.length,
    groups,
  }
}

/**
 * The last status anyone asked for, so the footer transport and the Sound
 * panel read one answer rather than each invoking and getting their own.
 */
let libraryStatus: MusicLibraryStatus | null = null
const libraryListeners = new Set<(s: MusicLibraryStatus | null) => void>()

export function musicLibraryStatus(): MusicLibraryStatus | null {
  return libraryStatus
}

/** Subscribe to library changes - an install finishing, a group removed.
 * Returns an unsubscribe function. */
export function onMusicLibraryChange(fn: (s: MusicLibraryStatus | null) => void): () => void {
  libraryListeners.add(fn)
  return () => libraryListeners.delete(fn)
}

function notifyLibrary() {
  for (const l of libraryListeners) l(libraryStatus)
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
    | { dir: string; installed_files: string[]; partial_files?: string[] }
    | undefined
  if (!raw) return null
  presentFiles = new Set(raw.installed_files ?? [])
  partialFiles = new Set(raw.partial_files ?? [])
  const status = deriveStatus(raw.dir, presentFiles, partialFiles)
  // Not `status.complete` any more (it was, until groups existed): one
  // installed station has to be playable while the other three are absent, and
  // gating the base on a complete library made a partial install unreachable -
  // every track would still resolve to the bundled path with nothing at it.
  // `audioUrl` still prefers the bundled copy, so a build that ships its own
  // audio is unaffected, and a track whose file is not there is stepped past by
  // `trackPresence` rather than loaded from here.
  installedBase = status.installed > 0 ? await assetBase(status.dir) : null
  libraryStatus = status
  notifyLibrary()
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

/**
 * Download one group, or the whole library when `group` is null.
 *
 * Nothing here runs until a person presses the button this is wired to - there
 * is no timer, no first-run trigger and no retry loop.
 *
 * A group whose files are already partly there resumes rather than restarts:
 * `install_music_library` skips a track that is present at its pinned size, so
 * the same call is both "install" and "resume" and there is no second path that
 * could disagree about which files are still needed.
 */
export async function installMusicLibrary(
  group: MusicGroup | null
): Promise<MusicLibraryStatus | null> {
  if (!isTauri()) {
    throw new Error('Installing the music library needs the desktop app.')
  }
  const groupName = group ? group.name : 'the whole library'
  setInstallRun({
    groupId: group ? group.id : null,
    groupName,
    received: 0,
    total: group ? group.bytes : MUSIC_LIBRARY_BYTES,
  })
  const stop = listenTauri<{ id: string; received: number; total: number; phase: string }>(
    'setup://progress',
    (p) => {
      if (p.id !== 'music' || !installRun) return
      setInstallRun({ ...installRun, received: p.received })
    }
  )
  let result: { busy?: boolean; busy_group?: string | null } | undefined
  try {
    result = (await invokeTauri('install_music_library', {
      tracks: group ? group.tracks : MUSIC_TRACKS,
      group: groupName,
    })) as { busy?: boolean; busy_group?: string | null } | undefined
  } finally {
    stop()
    setInstallRun(null)
  }
  if (result?.busy) {
    // Rust owns "is an install running", and this is what it answered. The
    // buttons are disabled while one runs, so reaching here means two calls
    // raced; saying which install has the slot is more use than saying no.
    throw new Error(
      `${result.busy_group ?? 'Another install'} is installing already. Wait for it, or cancel it first.`
    )
  }
  return await refreshMusicLibrary()
}

export async function cancelMusicInstall(): Promise<void> {
  await invokeTauri('cancel_music_install')
}

/**
 * Delete one group's files, and only those.
 *
 * The paths are derived from the manifest and rebuilt by Rust under
 * `music_dir()`, which refuses anything that could leave it - this side never
 * sends an absolute path and the other side would not accept one. Everything
 * outside that group, installed or not, is untouched.
 */
export async function removeMusicGroup(group: MusicGroup): Promise<MusicLibraryStatus | null> {
  if (!isTauri()) {
    throw new Error('Removing music needs the desktop app.')
  }
  await invokeTauri('remove_music_group', { tracks: group.tracks })
  return await refreshMusicLibrary()
}
