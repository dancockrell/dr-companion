/**
 * E12. Six questions a maintainer always ends up asking, answered on one
 * screen, plus a bundle the player can paste.
 *
 * The friction this removes is a real exchange that has happened more than
 * once: "nothing connects" - "is Ruby installed?" - screenshot - "and Lich?" -
 * screenshot - "is the bridge port answering?" - "how do I tell?". Three
 * rounds, and every one of them is a question this app can answer about
 * itself.
 *
 * # Every row has three answers
 *
 * `could not check` is a value, not a fallback. A maintainer told "Ruby:
 * absent" goes looking for a Ruby problem; a maintainer told "Ruby: could not
 * check" goes looking at why the check failed. Collapsing those is how a bug
 * report sends someone down the wrong afternoon, and this app has made that
 * mistake in enough places (`charactersKnown`, `runningKnown`,
 * `viewer.runningKnown`) that the pattern is now the house style.
 *
 * In a browser preview nothing here can be checked at all, and the panel says
 * so on every row rather than reporting six absences. What the app cannot see
 * and what is not there are different facts.
 *
 * # The bundle refuses rather than redacts
 *
 * `bugBundle.ts` holds that rule and the reasoning. Nothing is copied to the
 * clipboard when a credential is found, and the player is told which kind
 * matched and never the value.
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Copy, Check, ShieldAlert } from 'lucide-react'
import { isTauri, invokeTauri } from '../../lib/tauri.ts'
import { useAppStore } from '../../store/useAppStore.ts'
import { viewerStatus } from '../../lib/viewerClient.ts'
import { getAiStatus } from '../../lib/aiWorkerHost.ts'
import { EXPECTED_BRIDGE_VERSION } from '../../lib/versions.ts'
import { buildBugBundle, type DiagnosticRow, type Presence } from '../../lib/bugBundle.ts'

const NOT_IN_BROWSER = 'the browser preview cannot see this machine'

/** The colour of an answer. `could not check` is deliberately not red: it is
 * not a failure, it is an absence of information, and painting it as a fault
 * is what teaches people to ignore it. */
function presenceClass(p: Presence): string {
  if (p === 'present') return 'text-good'
  if (p === 'absent') return 'text-ink-faint'
  return 'text-warn'
}

export function DiagnosticsPanel() {
  const [rows, setRows] = useState<DiagnosticRow[]>([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const logLines = useAppStore((s) => s.logLines)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)

  const gather = useCallback(async () => {
    setBusy(true)
    setRefusal(null)

    // Outside the desktop app every one of these is unknown rather than
    // absent, and saying "absent" six times would be six wrong answers.
    if (!isTauri()) {
      setRows(
        (
          [
            ['ruby', 'Ruby'],
            ['lich', 'Lich'],
            ['bridgePort', 'Bridge port'],
            ['tokenFile', 'Token file'],
            ['viewer', 'World viewer'],
            ['model', 'Local model'],
          ] as const
        ).map(([id, label]) => ({
          id,
          label,
          presence: 'could not check' as Presence,
          detail: NOT_IN_BROWSER,
        }))
      )
      setBusy(false)
      return
    }

    const next: DiagnosticRow[] = []

    // Ruby and Lich come from the status this app already computes for its
    // launcher. Asking a second way would be a second answer to one question.
    try {
      const lich = (await invokeTauri('lich_status')) as {
        ruby: string | null
        launcher: string | null
        installDir: string | null
      }
      next.push({
        id: 'ruby',
        label: 'Ruby',
        presence: lich.ruby ? 'present' : 'absent',
        detail: lich.ruby ?? undefined,
      })
      next.push({
        id: 'lich',
        label: 'Lich',
        presence: lich.launcher ? 'present' : 'absent',
        detail: lich.launcher ?? lich.installDir ?? undefined,
      })
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      next.push({ id: 'ruby', label: 'Ruby', presence: 'could not check', detail: why })
      next.push({ id: 'lich', label: 'Lich', presence: 'could not check', detail: why })
    }

    // The bridge port is the one row that is genuinely a live fact rather than
    // an installed one, so it reads the connection this app is holding rather
    // than probing the socket a second time.
    next.push({
      id: 'bridgePort',
      label: 'Bridge port',
      presence: bridgeConnected ? 'present' : 'absent',
      detail: bridgeConnected
        ? `connected, bridge script ${EXPECTED_BRIDGE_VERSION}`
        : 'not connected',
    })

    try {
      const token = ((await invokeTauri('read_bridge_token')) as string) ?? ''
      next.push({
        id: 'tokenFile',
        label: 'Token file',
        presence: token.length > 0 ? 'present' : 'absent',
        // Never the token. Its length is enough to tell a truncated file from
        // a missing one, and is not a credential.
        detail: token.length > 0 ? `${token.length} characters` : 'no token written yet',
      })
    } catch (e) {
      next.push({
        id: 'tokenFile',
        label: 'Token file',
        presence: 'could not check',
        detail: e instanceof Error ? e.message : String(e),
      })
    }

    try {
      const v = await viewerStatus()
      next.push({
        id: 'viewer',
        label: 'World viewer',
        presence: v.installed ? 'present' : 'absent',
        detail: v.installed
          ? `${v.path ?? 'installed'}${v.runningKnown ? (v.running ? ', running' : ', not running') : ', running state unknown'}`
          : 'not installed - the app works without it',
      })
    } catch (e) {
      next.push({
        id: 'viewer',
        label: 'World viewer',
        presence: 'could not check',
        detail: e instanceof Error ? e.message : String(e),
      })
    }

    // The worker host already publishes whether a model answered. Reading its
    // status is the same answer the AI panel shows, which is the point.
    //
    // Read here rather than taken from the subscribed value above, and read
    // fresh: journalPending and ticks move every second, so depending on them
    // would restart this whole gather - including a lich_status that measures
    // about five seconds - on every tick of an unrelated worker. Plan section
    // 1, trap 6.
    const aiNow = getAiStatus()
    next.push({
      id: 'model',
      label: 'Local model',
      presence: aiNow.available ? 'present' : 'absent',
      detail: aiNow.available
        ? `${aiNow.ticks} ticks, ${aiNow.journalPending} pending`
        : 'no local model is installed',
    })

    setRows(next)
    setBusy(false)
  }, [bridgeConnected])

  useEffect(() => {
    void gather()
  }, [gather])

  async function copyBundle() {
    const result = buildBugBundle({
      rows,
      log: logLines,
      appVersion: '0.1.1',
      bridgeVersion: EXPECTED_BRIDGE_VERSION,
    })
    if (!result.ok) {
      // Nothing reaches the clipboard. The message names the kind that
      // matched, never the value.
      setRefusal(result.message)
      return
    }
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setRefusal(
        `The bundle was built but could not be copied: ${e instanceof Error ? e.message : e}`
      )
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-muted">What this machine has</span>
        <button
          type="button"
          onClick={() => void gather()}
          disabled={busy}
          title="Check again"
          aria-label="Check again"
          className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-ink-muted">{r.label}</span>
            <span className="flex-1 border-b border-dotted border-border/60" />
            <span className={presenceClass(r.presence)}>{r.presence}</span>
          </li>
        ))}
      </ul>

      {rows.some((r) => r.detail) && (
        <ul className="space-y-0.5 text-xs text-ink-faint">
          {rows
            .filter((r) => r.detail)
            .map((r) => (
              <li key={r.id} className="truncate" title={r.detail}>
                {r.label}: {r.detail}
              </li>
            ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void copyBundle()}
        disabled={busy || rows.length === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy bug bundle'}
      </button>

      {refusal && (
        <p className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink-muted">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-warn" />
          <span>{refusal}</span>
        </p>
      )}

      <p className="text-xs text-ink-faint">
        The bundle is this list plus the activity log, with private speech
        removed. Nothing is sent anywhere — it goes to your clipboard, and you
        decide where it goes next.
      </p>
    </div>
  )
}
