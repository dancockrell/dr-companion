/**
 * The one place that imports `@tauri-apps/plugin-updater`.
 *
 * `updater.ts` holds the rules and imports nothing, so the harness can drive
 * it under plain node. This file is the adapter: it turns the plugin's
 * `Update` object into the small {@link AvailableUpdate} interface those rules
 * are written against, and it answers the two questions the rules cannot
 * answer for themselves — is a character in the game, and does this build have
 * an update channel at all.
 *
 * The plugin's shape, read from `node_modules/@tauri-apps/plugin-updater`
 * @2.11.0 rather than recalled: `check(options?) => Promise<Update | null>`;
 * `Update.download(onEvent?, options?)` where `onEvent` receives
 * `{event:'Started', data:{contentLength?}}`, `{event:'Progress',
 * data:{chunkLength}}` or `{event:'Finished'}`; `Update.install(options?)`;
 * `Update.close()`. Note what `Progress` carries: a **chunk** length, not a
 * running total. Summing is this file's job, and reporting `chunkLength` as
 * the bytes-so-far would draw a progress bar that flickers near zero forever.
 */
import { useSyncExternalStore } from 'react'
import { check as pluginCheck } from '@tauri-apps/plugin-updater'
import { UpdateController, type AvailableUpdate, type UpdateState } from './updater.ts'
import { invokeTauri, isTauri } from './tauri.ts'
import { useAppStore } from '../store/useAppStore.ts'

export const RELEASES_URL = 'https://github.com/dancockrell/dr-companion/releases'

/**
 * Whether this build can update itself.
 *
 * Three states, not two, for the reason the release scripts have three: an
 * unconfigured build and a broken network look identical to a player, and they
 * call for opposite things. `updater_configured` is a Rust command that reads
 * the `pubkey` this binary was actually compiled against, so the answer is a
 * property of the artefact rather than a guess from the frontend.
 *
 * A build with an empty pubkey cannot verify a signature, so it must not be
 * allowed to download one: an updater that fetches and installs an unverified
 * installer is strictly worse than no updater. Hence the `unsupported` answer
 * happens *before* the endpoint is asked, not after a verification failure.
 */
async function updaterConfigured(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return (await invokeTauri('updater_configured')) === true
  } catch {
    return false
  }
}

function isInGame(): boolean {
  const s = useAppStore.getState()
  return s.bridgeConnected && s.character?.connected === true
}

export const updateController = new UpdateController({
  releasesUrl: RELEASES_URL,
  now: () => Date.now(),
  isInGame,
  async check(): Promise<AvailableUpdate | null | 'unsupported'> {
    if (!(await updaterConfigured())) return 'unsupported'
    const update = await pluginCheck()
    if (!update) return null
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? null,
      async download(onProgress) {
        let received = 0
        let total: number | null = null
        await update.download((ev) => {
          if (ev.event === 'Started') total = ev.data.contentLength ?? null
          else if (ev.event === 'Progress') received += ev.data.chunkLength
          onProgress(received, total)
        })
      },
      // `restartAfterInstall` is left at the plugin's default (true). The
      // player pressed a button that says the app will close and come back;
      // coming back is the half that makes the interruption bearable.
      install: () => update.install(),
      close: () => update.close(),
    }
  },
})

/** React binding. Returns the state object, which is replaced, never mutated. */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(updateController.subscribe, updateController.getSnapshot)
}

let launchCheckStarted = false

/**
 * The check on launch. Runs once per process, not once per component mount.
 *
 * Fire and forget: every failure this can produce is already a state in the
 * controller, and there is nobody to hand a rejection to at startup. A player
 * whose machine is offline at launch should see nothing at all, which is what
 * `failed` renders as in the banner — the banner only ever appears for
 * `available`.
 */
export function startLaunchUpdateCheck(): void {
  if (launchCheckStarted) return
  launchCheckStarted = true
  void updateController.check({ atLaunch: true })
}
