import { useMemo, useState } from 'react'
import {
  applyPinsImport,
  undoLastPinsImport,
  type PinImportChoice,
  type PinImportPreview,
  type PinImportResult,
} from '../../lib/pinsFile'
import { useModalDialog } from '../../lib/useModalDialog'

export function PinImportDialog({ preview, onClose, onChanged, onResult }: {
  preview: PinImportPreview
  onClose: () => void
  onChanged: () => void
  onResult: (message: string, level?: 'info' | 'warn' | 'error') => void
}) {
  const initial = useMemo(() => Object.fromEntries(preview.characters.map((item) => [item.key, 'merge' as const])), [preview])
  const [choices, setChoices] = useState<Record<string, PinImportChoice>>(initial)
  const [result, setResult] = useState<PinImportResult | null>(null)
  const dialogRef = useModalDialog(onClose)
  const replacementDeletes = preview.characters.reduce(
    (sum, item) => sum + (choices[item.key] === 'replace' ? item.removedByReplace : 0), 0
  )

  function apply() {
    const next = applyPinsImport(preview, choices)
    setResult(next)
    onChanged()
    onResult(`Pin import applied: ${next.added} added, ${next.updated} updated, ${next.unchanged} unchanged, ${next.skipped} skipped, ${next.removed} removed.`)
  }

  function undo() {
    if (!undoLastPinsImport()) return
    onChanged()
    onResult('Pin import undone. The complete pre-import pin store was restored.')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="presentation" data-gameplay-shortcuts="suspend" onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface-overlay shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="pin-import-title" onClick={(event) => event.stopPropagation()}>
        <header className="border-b border-border px-4 py-3">
          <h2 id="pin-import-title" className="font-semibold text-ink">Preview pin import</h2>
          <p className="mt-1 text-xs text-ink-muted">Nothing changes until you apply this plan. Merge preserves unrelated local pins and is recommended.</p>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {preview.empty && <p className="rounded border border-warn/40 bg-warn/10 p-3 text-sm text-warn">This is a valid empty pins file. There is nothing to import.</p>}
          {preview.skipped > 0 && <p className="text-xs text-warn">{preview.skipped} malformed file {preview.skipped === 1 ? 'entry was' : 'entries were'} skipped during validation.</p>}
          {preview.characters.map((item) => (
            <div key={item.key} className="rounded border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="break-all text-sm text-ink">{item.key}</strong>
                <select aria-label={`Import choice for ${item.key}`} value={choices[item.key]} onChange={(event) => setChoices((current) => ({ ...current, [item.key]: event.target.value as PinImportChoice }))} className="rounded border border-border bg-surface-raised px-2 py-1 text-xs text-ink">
                  <option value="merge">Merge (recommended)</option>
                  <option value="replace">Replace local pins</option>
                  <option value="skip">Skip character</option>
                </select>
              </div>
              <p className="mt-2 text-xs text-ink-muted">{item.local} local · {item.incoming} incoming · {item.added} new · {item.updated} conflicts · {item.unchanged} unchanged</p>
              {choices[item.key] === 'replace' && item.removedByReplace > 0 && <p className="mt-1 text-xs font-medium text-danger">Replace will delete {item.removedByReplace} local {item.removedByReplace === 1 ? 'pin' : 'pins'} not present in the file.</p>}
            </div>
          ))}
          {result && <div className="rounded border border-good/40 bg-good/10 p-3 text-sm text-good">Applied: {result.added} added, {result.updated} updated, {result.unchanged} unchanged, {result.skipped} skipped, {result.removed} removed. You can undo the complete import before closing.</div>}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          {result ? (
            <><button type="button" onClick={undo} className="rounded border border-warn/50 px-3 py-1.5 text-sm text-warn">Undo import</button><button type="button" onClick={onClose} className="rounded bg-accent px-3 py-1.5 text-sm text-surface">Done</button></>
          ) : (
            <><button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-sm text-ink-muted">Cancel</button><button type="button" disabled={preview.empty || preview.characters.length === 0} onClick={apply} className="rounded bg-accent px-3 py-1.5 text-sm text-surface disabled:opacity-40">{replacementDeletes > 0 ? `Apply and remove ${replacementDeletes}` : 'Apply import'}</button></>
          )}
        </footer>
      </div>
    </div>
  )
}
