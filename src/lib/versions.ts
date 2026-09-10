/**
 * Version agreement between the app and the bridge script.
 *
 * This exists because of what the support channel for the biggest DragonRealms
 * script actually looks like. A representative exchange, over six days:
 *
 *     user:  [posts a 383 KB debug]
 *     dev:   "wait a second... the line numbers in your debug don't line up
 *             with the script.. that's an older version of the script"
 *     user:  "So update everything I don't always update all of them"
 *     dev:   "with this version.."
 *     user:  [posts another debug]
 *     dev:   "and that's still not 10.7.1 posted here.. you're still on 10.7"
 *
 * Two full round trips, days apart, spent discovering the user was running an
 * old file. That is the single largest time sink in this ecosystem's support,
 * and it is entirely preventable: the app ships the bridge script, so it knows
 * what version should be installed and can say so before anyone writes a
 * report.
 */

/**
 * The bridge version this build of the app ships and expects.
 *
 * Drifted twice now, each time exactly the way this file's own header
 * predicts: found stale by downloads-a6 (0.10.0 left here against a real
 * bridge at 0.10.2), fixed, then drifted again to 0.10.2 against a real
 * bridge at 0.10.3 within the same day - a `list_vars` commit bumped
 * `BRIDGE_VERSION` in companion_bridge.lic and nobody, including whoever
 * wrote that commit, thought to grep for this constant. Two real
 * occurrences of the same defect is this project's own stated bar for
 * "stop fixing it and make it impossible" - see
 * `tools/bridge-version-drift-test.mjs`, wired into `npm run build`, which
 * now fails the build the moment these two numbers disagree rather than
 * waiting for a live app to print the warning at someone.
 */
export const EXPECTED_BRIDGE_VERSION = '0.16.0'

/**
 * Two version axes, one source each. Written down 9 Sep 2026 because two lanes
 * were about to answer the same question from different constants.
 *
 * `EXPECTED_BRIDGE_VERSION` above is the **bridge** axis: which
 * `companion_bridge.lic` this build ships and expects. Anything that decides
 * whether the installed bridge is stale — the version card, and the on-launch
 * install that makes a three-versions-old script impossible — must read this
 * constant rather than a literal of its own.
 * `tools/bridge-version-drift-test.mjs` holds it against the `.lic` this repo
 * ships, and a second copy of the number would be outside that check.
 *
 * `APP_VERSION` below is the **application** axis: this build's own version,
 * kept identical across `package.json`, `src-tauri/tauri.conf.json`,
 * `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and this file by
 * `tools/set-version.mjs`, and published by the updater
 * (`tools/build-update-manifest.mjs` takes the manifest's version from
 * `package.json`, which is the same number).
 *
 * They are deliberately not the same number and never will be: the bridge is a
 * Ruby script with its own release history. What they share is the rule — one
 * declaration, and a check that fails the build when a copy drifts from it.
 */

/**
 * This build's own version.
 *
 * It was `0.1.0` while `package.json`, `tauri.conf.json`, `Cargo.toml` and
 * `Cargo.lock` all said `0.1.1`, and nothing noticed. `tools/set-version.mjs`
 * knew about four files and this was the fifth, so every bug report filed from
 * this build named a version that had not been built for two releases - the
 * exact failure that script's own header describes ("the first person to
 * report a bug reports the wrong version"), happening in the one file it did
 * not read.
 *
 * It is a literal rather than an import of `package.json` or a Vite `define`
 * for the same reason `EXPECTED_BRIDGE_VERSION` above is: this module is
 * imported by node test harnesses that run with no bundler and no JSON import
 * assertion. So the agreement is enforced instead of derived, by the same
 * script that writes the other four - `node tools/set-version.mjs --check`
 * reads this declaration and fails naming this file when it drifts.
 *
 * Anything that shows a version to a player reads this constant. Settings used
 * to print `DR Companion 0.1.1` as typed text, which is a sixth copy and would
 * have drifted next.
 */
export const APP_VERSION = '0.1.1'

/*
 * The three names below are the labels a player can actually read on screen,
 * and they live here so the message and the buttons cannot drift (issue #539).
 *
 * The message used to say "Reinstall it from Setup, then start the bridge
 * again." There is nothing in this app called Setup, and there was no way at
 * all to restart the bridge: `SettingsSheet` renders these constants, and
 * `tools/versions-test.mjs` fails the build if a name in the message is not a
 * label that file puts on a control. A sentence naming a control that does not
 * exist is the same defect as a control that does nothing, one screen over.
 */

/** The Settings heading the bridge controls live under. */
export const SETTINGS_BRIDGE_SECTION = 'Ruby, Lich and your frontend'

/** The button that opens the installer, which is what "reinstall" means here. */
export const REINSTALL_CONTROL = 'Check what is installed'

/** The button that stops the running bridge script and starts it again. */
export const RESTART_CONTROL = 'Restart the bridge script'

export interface VersionState {
  app: string
  expectedBridge: string
  /** What the running bridge said in its hello, if we have connected. */
  actualBridge: string | null
  lich: string | null
  protocol: number | null
}

export type VersionVerdict = 'ok' | 'stale_bridge' | 'newer_bridge' | 'unknown'

export function compareVersions(v: VersionState): {
  verdict: VersionVerdict
  message: string | null
} {
  if (!v.actualBridge) {
    return { verdict: 'unknown', message: null }
  }
  if (v.actualBridge === v.expectedBridge) {
    return { verdict: 'ok', message: null }
  }

  const cmp = semverish(v.actualBridge, v.expectedBridge)
  if (cmp < 0) {
    return {
      verdict: 'stale_bridge',
      message:
        `The bridge script running in Lich is v${v.actualBridge}, but this app ships ` +
        `v${v.expectedBridge}. Open Settings, "${SETTINGS_BRIDGE_SECTION}", and press ` +
        `"${REINSTALL_CONTROL}" to write the current script; then press ` +
        `"${RESTART_CONTROL}" in the same place, because Lich is still running the ` +
        `copy it read off disk when it started. ` +
        `Mismatched versions are the most common cause of confusing behaviour, and of ` +
        `bug reports that turn out to be already fixed.`,
    }
  }
  return {
    verdict: 'newer_bridge',
    message:
      `The bridge script in Lich is v${v.actualBridge}, newer than the v${v.expectedBridge} ` +
      `this app expects. Update the app, or expect features it does not know about.`,
  }
}

/** Good enough for x.y.z. Returns <0 if a is older than b. */
function semverish(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
