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

/** The bridge version this build of the app ships and expects. */
export const EXPECTED_BRIDGE_VERSION = '0.8.0'

export const APP_VERSION = '0.1.0'

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
        `v${v.expectedBridge}. Reinstall it from Setup, then start the bridge again. ` +
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
