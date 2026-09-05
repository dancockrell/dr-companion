/**
 * The bug bundle: what this machine has, in the three answers each question
 * really has, plus the activity log, refused outright if a credential is in it.
 *
 * # Why this is not `bugReport.ts`
 *
 * They answer different questions and both are needed. `bugReport.ts` answers
 * *what happened* - the commands and the game's replies, scoped and scrubbed
 * of tells. This answers *what is this machine*: is Ruby there, is Lich there,
 * is the bridge port answering, is the token file present, is the viewer
 * installed, is a model installed. A maintainer reading "the pattern did not
 * match" needs the first; a maintainer reading "nothing connects" needs the
 * second, and asking for it by hand is six questions and three rounds of
 * screenshots.
 *
 * Nothing is duplicated to get there. The log lines go through
 * `bugReport.ts`'s own `scrub`, so there is one set of private-channel
 * patterns and one place to fix them; and the whole serialised bundle then
 * goes through `aiModelProvider.ts`'s `scanForSecrets`, so there is one list
 * of what a credential looks like. Building either of those here would have
 * been a second copy of a privacy rule, which is the copy that gets fixed
 * last.
 *
 * # Three answers, not two
 *
 * `'could not check'` is a first-class value, not a fallback. This app has
 * been bitten repeatedly by collapsing it into `'absent'`, and a bug bundle
 * is the worst place to do it: a maintainer told "Ruby: absent" goes looking
 * for a Ruby problem, and a maintainer told "Ruby: could not check" goes
 * looking at why the check failed. Those are different afternoons.
 *
 * # The scan refuses; it does not redact
 *
 * A redacting bundle would hand back something that looks safe, and the one
 * time the redaction was imperfect nobody would be looking. Refusing is loud,
 * it names the *kind* that matched and never the value, and it leaves the
 * player holding a bundle they can look at rather than one already on its way
 * to an issue tracker.
 */
import { scrub } from './bugReport.ts'
import { scanForSecrets } from './aiModelProvider.ts'
import type { LogRow } from '../types'

/** The only three answers a presence question has. */
export type Presence = 'present' | 'absent' | 'could not check'

/**
 * One row of the diagnostics panel.
 *
 * `detail` is for a path or a version - something a maintainer can act on -
 * and is never required. A row with `presence: 'could not check'` should say
 * in `detail` why it could not, because "could not check" with no reason is
 * only marginally better than a wrong answer.
 */
export interface DiagnosticRow {
  id: string
  label: string
  presence: Presence
  detail?: string
}

export interface BundleInput {
  rows: DiagnosticRow[]
  log: LogRow[]
  appVersion: string
  bridgeVersion: string
  /** Injected so the bundle is reproducible in a test rather than depending
   * on when the test happened to run. */
  now?: string
}

export type BundleResult =
  | { ok: true; text: string }
  | {
      ok: false
      /** The kinds that matched. Never the text that matched them - a refusal
       * quoting the secret would be the leak it exists to prevent. */
      patterns: string[]
      /** What a person should be told, safe to display verbatim. */
      message: string
    }

/**
 * The presence values, in the order a maintainer wants to scan them.
 *
 * Exported so the panel and the test agree on what a complete bundle is
 * without either one hardcoding a list the other could drift from.
 */
export const REQUIRED_ROW_IDS = [
  'ruby',
  'lich',
  'bridgePort',
  'tokenFile',
  'viewer',
  'model',
] as const

/**
 * Build the bundle, or refuse.
 *
 * The scan runs on the finished text rather than on each field, because a
 * credential can be split across fields and reassembled by serialisation -
 * and because scanning the artefact that actually leaves is the only scan
 * whose result is about the thing that leaves.
 */
export function buildBugBundle(input: BundleInput): BundleResult {
  const missing = REQUIRED_ROW_IDS.filter(
    (id) => !input.rows.some((r) => r.id === id)
  )

  const scrubbed = scrub(input.log.map((l) => `${l.at} ${l.text}`))

  const bundle = {
    generatedAt: input.now ?? new Date().toISOString(),
    appVersion: input.appVersion,
    bridgeVersion: input.bridgeVersion,
    diagnostics: input.rows.map((r) => ({
      id: r.id,
      label: r.label,
      presence: r.presence,
      ...(r.detail ? { detail: r.detail } : {}),
    })),
    // Named so a reader cannot mistake an incomplete bundle for a complete
    // one. An empty array is the normal case and says so by being empty.
    diagnosticsNotGathered: missing,
    activityLog: scrubbed.text.split('\n'),
    activityLogRedacted: scrubbed.removed,
  }

  const text = JSON.stringify(bundle, null, 2)

  const scan = scanForSecrets(text)
  if (!scan.safe) {
    return {
      ok: false,
      patterns: scan.found,
      message:
        `This bug bundle was not created: it contains something shaped like ` +
        `${scan.found.join(', ')}. Nothing has been copied. Clear the activity ` +
        `log, or remove the line that carries it, and try again.`,
    }
  }

  return { ok: true, text }
}
