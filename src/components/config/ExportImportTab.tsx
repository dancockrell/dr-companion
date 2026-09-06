/**
 * Export and import the whole player config, as text and as a file.
 *
 * # Why a textarea and not only a file dialog
 *
 * The same reason `ScenePanel`'s transfer section is one: a textarea is
 * testable in a real browser, works identically in the app and outside it, and
 * lets somebody read what they are about to send before they send it. The file
 * buttons are the convenience on top, and they are the only part that needs
 * the desktop shell, so they are the only part hidden outside it.
 *
 * # Preview, then apply
 *
 * The report on screen is computed by the same call that produces the config
 * that gets written, so the numbers a player was shown are the numbers of the
 * run that actually happens. `Replace all` is a separate switch and a second
 * click, because it is the only thing here that can delete a rule.
 */
import { useMemo, useState } from 'react'
import {
  DOMAINS,
  loadPlayerConfig,
  type Domain,
  type MergeMode,
  type PlayerConfig,
} from '../../lib/playerConfig.ts'
import {
  applyPlayerConfigImport,
  exportPlayerConfig,
  exportPlayerConfigToFile,
  previewPlayerConfigImportText,
  readPlayerConfigFile,
  serializePlayerConfig,
  orphanCount,
  PLAYER_CONFIG_LEAF,
  type TransferOrphan,
  type TransferReport,
} from '../../lib/playerConfigTransfer.ts'
import { canUsePlayerFiles } from '../../lib/playerFiles.ts'

const sum = (counts: Record<Domain, number>) => DOMAINS.reduce((n, d) => n + counts[d], 0)

/**
 * The one sentence, so the confirmation and the report cannot word it two
 * ways. Names the rules rather than counting them, for the reason
 * `refuseDeletingPreset` names them: "3 highlights use it" is a fact nobody
 * can act on.
 */
function orphanSentence(orphans: readonly TransferOrphan[]): string {
  const n = orphanCount(orphans)
  return (
    `${n} ${n === 1 ? 'highlight names a preset' : 'highlights name presets'} this document ` +
    `does not carry; ${n === 1 ? 'it' : 'they'} will show in the default colour. ` +
    orphans.map((o) => o.why).join(' ')
  )
}

export function ExportImportTab({ config = loadPlayerConfig() }: { config?: PlayerConfig }) {
  const text = useMemo(() => serializePlayerConfig(exportPlayerConfig(config)), [config])
  const [pasted, setPasted] = useState('')
  const [replaceAll, setReplaceAll] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [report, setReport] = useState<TransferReport | null>(null)
  /** Computed at the confirmation step, so the warning arrives *before* the
   *  only action here that can delete a preset. */
  const [pendingOrphans, setPendingOrphans] = useState<TransferOrphan[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const mode: MergeMode = replaceAll ? 'replace-all' : 'update'

  /**
   * What a `replace-all` of this text would leave orphaned, for the
   * confirmation step. A preview that cannot be read is not an error here:
   * pressing Import reports the reason properly.
   */
  const orphansOf = (source: string): TransferOrphan[] => {
    const preview = previewPlayerConfigImportText(source, 'replace-all')
    return preview.ok ? preview.report.orphaned : []
  }

  const runImport = (source: string, from: string) => {
    setError('')
    setNote('')
    const preview = previewPlayerConfigImportText(source, mode)
    if (!preview.ok) {
      setReport(null)
      setError(preview.reason)
      return
    }
    const written = applyPlayerConfigImport(preview.config)
    setReport(preview.report)
    setPendingOrphans([])
    setNote(
      written.ok
        ? `Imported from ${from}.`
        : `Some of it did not save: ${written.failures.map((f) => `${f.domain} (${f.message})`).join(', ')}`
    )
    setConfirming(false)
  }

  const saveToFolder = async () => {
    setBusy(true)
    setError('')
    try {
      const written = await exportPlayerConfigToFile(config)
      setNote(
        `Saved ${written.bytes} bytes to ${written.path}.` +
          (written.backedUp ? ' The file that was there is kept as a .bak beside it.' : '')
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const loadFromFolder = async () => {
    setBusy(true)
    setError('')
    try {
      const file = await readPlayerConfigFile()
      if (!file.found) {
        setError(file.note || `No ${PLAYER_CONFIG_LEAF} saved yet.`)
        return
      }
      if (mode === 'replace-all' && !confirming) {
        setPasted(file.text)
        setPendingOrphans(orphansOf(file.text))
        setConfirming(true)
        return
      }
      runImport(file.text, file.path)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const importPasted = () => {
    if (!pasted.trim()) {
      setError('Nothing to import: paste an export above first.')
      return
    }
    if (mode === 'replace-all' && !confirming) {
      setPendingOrphans(orphansOf(pasted))
      setConfirming(true)
      return
    }
    runImport(pasted, 'the text you pasted')
  }

  return (
    <div className="rounded border border-border p-2" data-testid="config-transfer">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Export and import everything
      </h3>
      <p className="mt-1 text-xs text-ink-muted">
        One file with all seven kinds of rule in it, so you can carry your config to another
        machine. Saving puts it in this app's own folder as <code>{PLAYER_CONFIG_LEAF}</code>.
        Nothing is written to Genie.
      </p>

      <textarea
        readOnly
        rows={6}
        value={text}
        data-testid="config-export-text"
        className="mt-2 w-full rounded border border-border bg-surface-overlay p-1 font-mono text-xs"
      />
      <p className="text-xs text-ink-faint" data-testid="config-export-count">
        {DOMAINS.map((d) => `${d} ${config[d].length}`).join(', ')}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canUsePlayerFiles() && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveToFolder()}
              data-testid="config-export-save"
              className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
            >
              Save to my folder
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadFromFolder()}
              data-testid="config-import-load"
              className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
            >
              Load from my folder
            </button>
          </>
        )}
      </div>

      <textarea
        rows={4}
        value={pasted}
        onChange={(e) => {
          setPasted(e.target.value)
          setPendingOrphans([])
          setConfirming(false)
        }}
        placeholder="Paste an export here"
        data-testid="config-import-text"
        className="mt-2 w-full rounded border border-border bg-surface-overlay p-1 font-mono text-xs"
      />

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={importPasted}
          data-testid="config-import-apply"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
        >
          {confirming ? 'Yes, replace everything' : 'Import'}
        </button>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={replaceAll}
            data-testid="config-import-replace-all"
            onChange={(e) => {
              setReplaceAll(e.target.checked)
              setPendingOrphans([])
              setConfirming(false)
            }}
          />
          Replace all: delete rules this file does not have
        </label>
      </div>

      {confirming && (
        <p className="mt-1 text-xs text-warn" data-testid="config-import-confirm">
          This will delete every rule the file does not carry. Press Import again to go ahead.
        </p>
      )}
      {confirming && pendingOrphans.length > 0 && (
        <p className="mt-1 text-xs text-warn" data-testid="config-import-orphans">
          {orphanSentence(pendingOrphans)}
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert" data-testid="config-import-error">
          {error}
        </p>
      )}
      {note && (
        <p className="mt-1 text-xs text-ink" data-testid="config-transfer-note">
          {note}
        </p>
      )}

      {report && (
        <div className="mt-2" data-testid="config-transfer-report">
          <p className="text-xs text-ink-muted">
            From {report.provenance}: {sum(report.added)} added, {sum(report.updated)} updated,{' '}
            {sum(report.unchanged)} already the same, {report.refused.length} refused,{' '}
            {sum(report.removed)} removed.
          </p>
          <table className="mt-1 w-full text-xs">
            <thead className="text-ink-faint">
              <tr>
                <th className="text-left">Kind</th>
                <th className="text-right">In file</th>
                <th className="text-right">Added</th>
                <th className="text-right">Updated</th>
                <th className="text-right">Same</th>
                <th className="text-right">Refused</th>
                <th className="text-right">Removed</th>
              </tr>
            </thead>
            <tbody>
              {DOMAINS.map((d) => (
                <tr key={d} data-testid={`config-transfer-row-${d}`}>
                  <td className="text-left">{d}</td>
                  <td className="text-right">{report.inFile[d]}</td>
                  <td className="text-right">{report.added[d]}</td>
                  <td className="text-right">{report.updated[d]}</td>
                  <td className="text-right">{report.unchanged[d]}</td>
                  <td className="text-right">{report.refused.filter((r) => r.domain === d).length}</td>
                  <td className="text-right">{report.removed[d]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.refused.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs text-warn" data-testid="config-transfer-refused">
              {report.refused.map((r, i) => (
                <li key={`${r.domain}-${r.id ?? i}`}>{`${r.domain} ${r.id ?? '(unreadable)'}: ${r.why}`}</li>
              ))}
            </ul>
          )}
          {report.orphaned.length > 0 && (
            <p className="mt-1 text-xs text-warn" data-testid="config-transfer-orphans">
              {orphanSentence(report.orphaned)}
            </p>
          )}
          {report.disabled.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs text-ink-muted" data-testid="config-transfer-disabled">
              {report.disabled.map((r) => (
                <li key={`${r.domain}-${r.id}`}>{`${r.domain} ${r.id}: kept and switched off, ${r.why}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
