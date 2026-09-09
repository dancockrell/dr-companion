/**
 * The application updater: what state it is in, and what the player is allowed
 * to do about it.
 *
 * # Why this is a module and not four `useState`s in a component
 *
 * Two reasons, and the second is the one with teeth.
 *
 * The first is ordinary: the launch check and the Settings sheet are the same
 * check. A player who opens Settings ten seconds after launch should see the
 * answer the launch check already got, not a second network round trip and a
 * spinner. One module-level state, two views.
 *
 * The second is that this is the one feature in the app that can **close the
 * app and replace its binary**. On Windows `install()` launches the NSIS
 * installer and exits the running process — that is not a claim from
 * documentation, it is the doc comment on `Update.install` in the installed
 * `@tauri-apps/plugin-updater@2.11.0`, and `updater_parameters` in
 * `tauri-plugin-updater-2.11.0/src/updater.rs` builds the `/P` `/R` argument
 * list that does it. Everything else in this app is recoverable by pressing
 * something else. This is not, and the player may be standing in a room with
 * something trying to kill them.
 *
 * So the rules below are enforced here, in a place a test can reach without a
 * webview, rather than in the JSX where the only proof they hold is that
 * somebody clicked the right button once:
 *
 *   1. **Nothing installs without an explicit press.** `check()` never
 *      downloads. `download()` never installs. There is no path from the
 *      launch check to a running installer that does not go through two
 *      deliberate actions by a person.
 *   2. **"Later" actually waits.** Deferring records the version and the
 *      module refuses to raise that same version again for the rest of the
 *      session. A "later" that re-asks in ninety seconds is not a later, it is
 *      a nag with a delay, and the player learns to dismiss the banner without
 *      reading it — which is exactly how a real warning gets missed.
 *   3. **A live game session is a confirmation gate, not a refusal.** If the
 *      bridge is connected and the character is in the game, `install()`
 *      refuses unless the caller passes `confirmed: true`. The app cannot know
 *      whether the player is mid-hunt or standing in a bank, so it does not
 *      guess; it asks once and then does what it is told.
 *   4. **A failure says what to do.** Every terminal failure carries a
 *      `whatToDo` sentence naming the manual download page, because the honest
 *      fallback for a broken updater is a person downloading an installer.
 *
 * # Injected dependencies
 *
 * Everything that touches Tauri arrives through {@link UpdaterDeps}. This
 * module imports nothing; `src/lib/updaterWiring.ts` is the only file that
 * imports the plugin, and it builds the one live controller. The test harness
 * (`tools/updater-test.mjs`) supplies fakes and asserts on the *calls that did
 * not happen* — an install spy that was never called is the only evidence that
 * "later" defers rather than installs, and there is no way to observe that
 * from a rendered screenshot.
 */

/** What the plugin hands back when an update exists. */
export interface AvailableUpdate {
  /** The version being offered, e.g. `0.2.0`. */
  version: string
  /** The version currently running, as the plugin reports it. */
  currentVersion: string
  /** Release notes from the manifest's `notes` field, if it carried any. */
  notes: string | null
  /** Download the payload. `onProgress` is called with bytes so far. */
  download(onProgress: (received: number, total: number | null) => void): Promise<void>
  /**
   * Install what was downloaded. On Windows this does not return: the process
   * exits once the installer has been launched.
   */
  install(): Promise<void>
  /** Release the plugin-side resource. Safe to call more than once. */
  close(): Promise<void>
}

export interface UpdaterDeps {
  /**
   * Ask the endpoint. Resolves `null` when the running version is current.
   *
   * Returns `'unsupported'` rather than throwing when there is no updater to
   * ask — the browser demo, or a build whose `pubkey` was never filled in.
   * Those are a different thing from a failed check and must not be dressed as
   * one: "could not reach the update server" sends a player to look at their
   * network, and the answer is that this build cannot self-update at all.
   */
  check(): Promise<AvailableUpdate | null | 'unsupported'>
  /** Whether a character is currently in the game. Gates rule 3. */
  isInGame(): boolean
  now(): number
  /** Where a person downloads an installer by hand when this fails. */
  releasesUrl: string
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; version: string; checkedAt: number }
  | { kind: 'available'; version: string; currentVersion: string; notes: string | null }
  | { kind: 'downloading'; version: string; received: number; total: number | null }
  /** Downloaded and verified, waiting for the player to say go. */
  | { kind: 'ready'; version: string }
  /** Installing: the installer has been asked to start. On Windows the app is about to exit. */
  | { kind: 'installing'; version: string }
  /** The player said later. This version will not be raised again this session. */
  | { kind: 'deferred'; version: string }
  | { kind: 'failed'; version: string | null; message: string; whatToDo: string }
  /** No updater in this build. Stated, never dressed as a failure. */
  | { kind: 'unsupported'; why: string }

/** Every `kind` above, so a test can assert it covered all of them. */
export const UPDATE_STATE_KINDS = [
  'idle',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'ready',
  'installing',
  'deferred',
  'failed',
  'unsupported',
] as const

/**
 * A live game session is in progress and the caller did not confirm.
 *
 * Thrown rather than returned so a caller cannot ignore it by not reading a
 * boolean. `UpdateController.install` is the only thrower.
 */
export class LiveSessionRefusal extends Error {
  // Declared and assigned rather than written as a TypeScript parameter
  // property: node's `--experimental-strip-types` is strip-only and refuses
  // `constructor(public readonly version: string)` outright, and this module
  // is imported directly by `tools/updater-test.mjs` under exactly that flag.
  readonly version: string

  constructor(version: string) {
    super(
      `Not installing ${version} while you are in the game. ` +
        'Installing closes DR Companion and runs the installer, which would drop your character. ' +
        'Confirm to install anyway, or choose Later.'
    )
    this.name = 'LiveSessionRefusal'
    this.version = version
  }
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export class UpdateController {
  #state: UpdateState = { kind: 'idle' }
  #listeners = new Set<() => void>()
  #update: AvailableUpdate | null = null
  /**
   * Versions the player has said "later" to. Rule 2 lives here.
   *
   * A `Set` rather than a flag, because "later" is about *this* version. An
   * update deferred at 0.2.0 must not silence 0.2.1 the next morning; the
   * player declined an interruption, not the whole feature.
   */
  #deferred = new Set<string>()

  readonly #deps: UpdaterDeps

  constructor(deps: UpdaterDeps) {
    this.#deps = deps
  }

  get state(): UpdateState {
    return this.#state
  }

  /**
   * `useSyncExternalStore` contract. Returns the state object, which is
   * replaced rather than mutated on every transition — a store that mutates in
   * place compares equal to itself and never re-renders, which is a defect
   * this repository has already shipped once (`gameLines()`), so it is worth
   * saying out loud rather than relying on nobody doing it again.
   */
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  getSnapshot = (): UpdateState => this.#state

  #set(next: UpdateState): void {
    this.#state = next
    for (const fn of this.#listeners) fn()
  }

  /** Whether this version has already been deferred this session. */
  isDeferred(version: string): boolean {
    return this.#deferred.has(version)
  }

  /**
   * Ask the endpoint.
   *
   * `atLaunch` is the difference between the automatic check and the button in
   * Settings, and it is exactly rule 2: at launch, a version the player has
   * already put off resolves to `deferred` and raises no banner. Pressing
   * "Check for updates" is the player asking, so it answers even for a version
   * they deferred earlier — otherwise the button appears to do nothing, which
   * is worse than a repeated offer.
   */
  async check({ atLaunch = false }: { atLaunch?: boolean } = {}): Promise<UpdateState> {
    if (this.#state.kind === 'checking' || this.#state.kind === 'downloading') return this.#state
    this.#set({ kind: 'checking' })
    let result: AvailableUpdate | null | 'unsupported'
    try {
      result = await this.#deps.check()
    } catch (e) {
      this.#set({
        kind: 'failed',
        version: null,
        message: `Could not check for updates: ${message(e)}`,
        whatToDo: `You can carry on using this version. To check by hand, open ${this.#deps.releasesUrl}.`,
      })
      return this.#state
    }

    if (result === 'unsupported') {
      this.#set({
        kind: 'unsupported',
        why:
          'This build has no update channel configured, so it cannot check for or install updates. ' +
          `New versions are published at ${this.#deps.releasesUrl}.`,
      })
      return this.#state
    }

    if (result === null) {
      this.#set({ kind: 'up-to-date', version: '', checkedAt: this.#deps.now() })
      return this.#state
    }

    this.#update = result
    if (atLaunch && this.#deferred.has(result.version)) {
      this.#set({ kind: 'deferred', version: result.version })
      return this.#state
    }
    this.#set({
      kind: 'available',
      version: result.version,
      currentVersion: result.currentVersion,
      notes: result.notes,
    })
    return this.#state
  }

  /**
   * Download, and stop.
   *
   * Deliberately not `downloadAndInstall`, which the plugin also offers. The
   * two-step shape is what makes the confirmation in {@link install} possible
   * at all: by the time the bytes are on disk the player has had a screen
   * telling them what is about to happen, and the expensive part is over
   * before the interrupting part begins.
   */
  async download(): Promise<UpdateState> {
    const update = this.#update
    if (!update) return this.#state
    this.#set({ kind: 'downloading', version: update.version, received: 0, total: null })
    try {
      await update.download((received, total) => {
        // Guarded: a Finished event can arrive after a failure transition, and
        // repainting a progress bar over an error message loses the error.
        if (this.#state.kind === 'downloading') {
          this.#set({ kind: 'downloading', version: update.version, received, total })
        }
      })
    } catch (e) {
      this.#set({
        kind: 'failed',
        version: update.version,
        message: `The download failed: ${message(e)}`,
        whatToDo:
          'Nothing has changed on your machine and this version still works. ' +
          `Try again later, or download the installer from ${this.#deps.releasesUrl}.`,
      })
      return this.#state
    }
    this.#set({ kind: 'ready', version: update.version })
    return this.#state
  }

  /**
   * Run the installer.
   *
   * Rule 3's gate. `confirmed` is the player having been shown, in words, that
   * this closes the app, and having said yes to that sentence — not a default
   * that a caller can forget to pass, which is why the refusal throws.
   */
  async install({ confirmed = false }: { confirmed?: boolean } = {}): Promise<UpdateState> {
    const update = this.#update
    if (!update) return this.#state
    if (this.#deps.isInGame() && !confirmed) {
      throw new LiveSessionRefusal(update.version)
    }
    this.#set({ kind: 'installing', version: update.version })
    try {
      await update.install()
    } catch (e) {
      this.#set({
        kind: 'failed',
        version: update.version,
        message: `The installer would not start: ${message(e)}`,
        whatToDo:
          'This version is untouched and still works. ' +
          `Download the installer from ${this.#deps.releasesUrl} and run it yourself.`,
      })
    }
    return this.#state
  }

  /**
   * "Later."
   *
   * Records the version and lets go of the plugin resource. It does not
   * download, does not install, and does not schedule anything — there is no
   * timer in this file, which is the point. The next offer for this version
   * happens when the player asks for it, or on the next launch after a *newer*
   * version appears.
   */
  async later(): Promise<UpdateState> {
    const version =
      this.#update?.version ??
      ('version' in this.#state && typeof this.#state.version === 'string' ? this.#state.version : null)
    if (!version) return this.#state
    this.#deferred.add(version)
    const update = this.#update
    this.#update = null
    this.#set({ kind: 'deferred', version })
    if (update) {
      // Best effort. A resource that will not close is not worth telling the
      // player about: they asked to be left alone.
      try {
        await update.close()
      } catch {
        /* ignore */
      }
    }
    return this.#state
  }

  /** Back to a quiet state without deferring anything. Used by "dismiss" on a failure. */
  reset(): void {
    this.#set({ kind: 'idle' })
  }
}

/**
 * How the version being offered is described in one line.
 *
 * Kept here rather than in JSX so the wording is testable and so the two
 * surfaces (the banner and the Settings section) cannot drift into saying
 * different things about the same state.
 */
export function updateSummary(state: UpdateState): string {
  switch (state.kind) {
    case 'idle':
      return 'Updates have not been checked yet.'
    case 'checking':
      return 'Checking for updates…'
    case 'up-to-date':
      return 'DR Companion is up to date.'
    case 'available':
      return `Version ${state.version} is available. You are running ${state.currentVersion}.`
    case 'downloading':
      return state.total === null
        ? `Downloading ${state.version}…`
        : `Downloading ${state.version}: ${formatBytes(state.received)} of ${formatBytes(state.total)}.`
    case 'ready':
      return `Version ${state.version} is downloaded and ready to install.`
    case 'installing':
      return `Installing ${state.version}. DR Companion will close.`
    case 'deferred':
      return `Version ${state.version} is available. You chose to install it later.`
    case 'failed':
      return state.message
    case 'unsupported':
      return state.why
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
