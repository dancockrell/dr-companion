/**
 * One dependency, and what we propose to do about it.
 *
 * The rule this screen exists to honour: nothing is downloaded until the user
 * says yes, and when they say yes they have already seen the version, the
 * size, the host and the checksum. "Transparency but it just works" means the
 * detail is present and legible, not that it is hidden to keep things tidy.
 *
 * Where a project publishes no checksum, this says so rather than quietly
 * skipping the line and implying a check we did not perform.
 */
import { useState } from 'react'
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  HelpCircle,
  Download,
  ExternalLink,
  FolderOpen,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react'
import { Button } from '../shared/Button'
import {
  formatBytes,
  type ComponentPlan,
  type DownloadOption,
  type Progress,
} from '../../lib/setup'

function Icon({ presence }: { presence: ComponentPlan['presence'] }) {
  if (presence === 'present')
    return <CheckCircle2 className="w-5 h-5 text-good" />
  if (presence === 'outdated')
    return <AlertTriangle className="w-5 h-5 text-warn" />
  if (presence === 'unknown')
    return <HelpCircle className="w-5 h-5 text-ink-faint" />
  return <Circle className="w-5 h-5 text-ink-faint" />
}

export interface CardState {
  progress?: Progress
  /** Which option produced `downloadedPath`. */
  downloadedFor?: string
  downloadedPath?: string
  /** Which option the user selected, if they moved off the suggested one. */
  chosen?: string
  error?: string
  busy?: boolean
  done?: string
}

export function ComponentCard({
  plan,
  state,
  onChoose,
  onDownload,
  onRunInstaller,
  onReveal,
  onInstallBridge,
  canInstallBridge,
}: {
  plan: ComponentPlan
  state: CardState
  onChoose: (optionId: string) => void
  onDownload: (option: DownloadOption) => void
  onRunInstaller: (path: string) => void
  onReveal: (path: string) => void
  onInstallBridge?: () => void
  canInstallBridge?: boolean
}) {
  const [showDetail, setShowDetail] = useState<string | null>(null)
  const r = plan.remedy

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4 flex gap-3 items-start">
      <div className="pt-0.5">
        <Icon presence={plan.presence} />
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium text-ink">{plan.label}</h2>
          {plan.presence === 'present' && (
            <span className="text-xs text-good font-medium shrink-0">Found</span>
          )}
          {!plan.required && plan.presence !== 'present' && (
            <span className="text-xs text-ink-faint shrink-0">Optional</span>
          )}
        </div>

        <p className="text-xs text-ink-muted leading-snug">{plan.detail}</p>
        {plan.path && (
          <p className="text-[10px] text-ink-faint break-all font-mono">
            {plan.path}
          </p>
        )}

        {state.done && (
          <p className="text-[11px] text-good leading-snug flex items-start gap-1">
            <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="break-all">{state.done}</span>
          </p>
        )}
        {state.error && (
          <p className="text-[11px] text-danger leading-snug">{state.error}</p>
        )}

        {plan.id === 'bridge' && plan.presence !== 'present' && (
          <div className="pt-1 space-y-1.5">
            {canInstallBridge ? (
              <>
                <p className="text-[11px] text-ink-muted leading-snug">
                  This one is ours: a single Ruby file copied into Lich’s
                  scripts folder. Nothing is downloaded, and it is the only
                  thing this app installs for you.
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={onInstallBridge}
                  disabled={state.busy}
                >
                  {state.busy ? 'Installing…' : 'Install the bridge script'}
                </Button>
              </>
            ) : (
              <p className="text-[11px] text-ink-faint leading-snug">
                Install Lich first, then this becomes a one-click step.
              </p>
            )}
          </div>
        )}

        {r.kind === 'manual' && plan.presence !== 'present' && (
          <div className="pt-1 space-y-1.5">
            <p className="text-[11px] text-ink-muted leading-snug">
              {r.instructions}
            </p>
            <a
              href={r.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              {r.link.replace(/^https?:\/\//, '')}
            </a>
          </div>
        )}

        {r.kind === 'choose' && (
          <div className="pt-1 space-y-2">
            <p className="text-[11px] text-ink-muted leading-snug">{r.note}</p>

            {r.options.map((o) => {
              const active =
                state.chosen === o.id || (!state.chosen && o.recommended)
              const prog =
                state.progress?.id === `${plan.id}:${o.id}`
                  ? state.progress
                  : undefined
              const pct =
                prog && prog.total > 0
                  ? Math.round((prog.received / prog.total) * 100)
                  : null
              const done = state.downloadedFor === o.id

              return (
                <div
                  key={o.id}
                  className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${
                    active
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border bg-surface'
                  }`}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => onChoose(o.id)}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-ink truncate flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            active ? 'bg-accent' : 'bg-border'
                          }`}
                        />
                        {o.label}
                        {o.prerelease && (
                          <span className="text-warn text-[10px]">beta</span>
                        )}
                        {o.recommended && (
                          <span className="text-good text-[10px]">suggested</span>
                        )}
                      </span>
                      <span className="text-ink-faint shrink-0">
                        {o.version} · {formatBytes(o.bytes)}
                      </span>
                    </div>
                    <p className="text-[10px] text-ink-faint leading-snug pl-3.5 pt-0.5">
                      {o.why}
                    </p>
                  </button>

                  {active && (
                    <>
                      <p className="text-[10px] text-ink-muted leading-snug pl-3.5">
                        {o.note}
                      </p>

                      <button
                        type="button"
                        onClick={() =>
                          setShowDetail((v) => (v === o.id ? null : o.id))
                        }
                        className="flex items-center gap-1 text-[10px] text-ink-faint hover:text-ink-muted pl-3.5"
                      >
                        <ChevronDown
                          className={`w-3 h-3 transition-transform ${
                            showDetail === o.id ? 'rotate-180' : ''
                          }`}
                        />
                        {showDetail === o.id ? 'Hide' : 'Where this comes from'}
                      </button>

                      {showDetail === o.id && (
                        <div className="space-y-1 pl-3.5 text-[10px] font-mono break-all">
                          <div>
                            <span className="text-ink-faint">from </span>
                            <span className="text-info">{o.url}</span>
                          </div>
                          <div>
                            <span className="text-ink-faint">sha256 </span>
                            {o.sha256 ? (
                              <span className="text-ink-muted">{o.sha256}</span>
                            ) : (
                              <span className="text-warn">
                                not published by this project
                              </span>
                            )}
                          </div>
                          <div>
                            <span className="text-ink-faint">to </span>
                            <span className="text-ink-muted">{o.dest}</span>
                          </div>
                          <p className="font-sans text-ink-faint leading-snug pt-0.5">
                            {o.sha256
                              ? 'The checksum comes from the same release API as the link. We verify the file against it and delete it if it does not match.'
                              : 'This project publishes no checksum for this file. We can confirm it came from their releases over HTTPS, but not check the contents against a published hash.'}
                          </p>
                        </div>
                      )}

                      {pct !== null && prog?.phase === 'downloading' && (
                        <div className="space-y-1 pl-3.5">
                          <div className="h-1.5 rounded-full bg-surface overflow-hidden border border-border/40">
                            <div
                              className="h-full rounded-full bg-info transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-ink-faint tabular-nums">
                            {formatBytes(prog.received)} of{' '}
                            {formatBytes(prog.total)} · {pct}%
                          </p>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1.5 pl-3.5">
                        {!done && (
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<Download className="w-3.5 h-3.5" />}
                            onClick={() => onDownload(o)}
                            disabled={state.busy}
                          >
                            {state.busy
                              ? 'Working…'
                              : o.after === 'extract'
                                ? 'Download and install'
                                : 'Download'}
                          </Button>
                        )}
                        {done && o.after === 'installer' && state.downloadedPath && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => onRunInstaller(state.downloadedPath!)}
                            >
                              Run the installer
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<FolderOpen className="w-3.5 h-3.5" />}
                              onClick={() => onReveal(state.downloadedPath!)}
                            >
                              Show me the file
                            </Button>
                          </>
                        )}
                      </div>

                      {done && o.after === 'installer' && (
                        <p className="text-[10px] text-ink-faint leading-snug pl-3.5">
                          Verified and saved. It has not been run. Opening it
                          starts that project’s own installer, which asks its own
                          questions.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
