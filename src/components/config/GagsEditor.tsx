/**
 * The gag manager - same CRUD/search/bulk-import shape as the other tabs,
 * one field (pattern) instead of two or five.
 *
 * Format caveat, shown in the panel itself: `Config/gags.cfg` is empty on
 * this machine, so unlike highlights/aliases/macros/variables this format
 * was never confirmed against a real file - see gags.ts's header.
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, X, RotateCcw, Search, ClipboardPaste } from 'lucide-react'
import { parseGags, type Gag } from '../../lib/gags'
import { LoadingNotice } from '../shared/LoadingNotice'
import { reloadGags } from '../../lib/useGags'
import { useGenieConfigEditor } from '../../lib/useGenieConfigEditor'
import {
  formatGagLine,
  hasUnsafeBraces,
  replaceLine,
  removeLine,
  appendUnderPlayerSection,
  isPlayerAddedLine,
} from '../../lib/genieConfigEdit'

export function GagsEditor() {
  const editor = useGenieConfigEditor<Gag>('gags.cfg', parseGags)
  const [search, setSearch] = useState('')
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [pattern, setPattern] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return editor.entries
    return editor.entries.filter((g) => g.pattern.toLowerCase().includes(q))
  }, [editor.entries, search])

  const importPreview = useMemo(() => {
    if (!importText.trim()) return null
    const { entries, skipped } = parseGags(importText)
    return { valid: entries, skipped }
  }, [importText])

  const startAdd = () => {
    setPattern('')
    setEditingLine(null)
    setAdding(true)
    setImporting(false)
    setFormError('')
  }

  const startImport = () => {
    setImportText('')
    setImporting(true)
    setAdding(false)
    setEditingLine(null)
    setFormError('')
  }

  const startEdit = (g: Gag) => {
    setPattern(g.pattern)
    setEditingLine(g.sourceLine)
    setAdding(false)
    setImporting(false)
    setFormError('')
  }

  const cancelForm = () => {
    setAdding(false)
    setEditingLine(null)
    setImporting(false)
    setFormError('')
  }

  const submitImport = async () => {
    if (!importPreview || importPreview.valid.length === 0) {
      setFormError('Nothing valid to import - paste one or more #gag lines.')
      return
    }
    const pastedLines = importText.split(/\r\n|\n/)
    const rawLines = importPreview.valid.map((g) => pastedLines[g.sourceLine].trim())

    setBusy(true)
    try {
      const newText = rawLines.reduce((acc, line) => appendUnderPlayerSection(acc, line), editor.text)
      await editor.applyAndSave(newText, reloadGags)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitForm = async () => {
    const trimmed = pattern.trim()
    if (!trimmed) {
      setFormError('Pattern cannot be empty.')
      return
    }
    if (hasUnsafeBraces(trimmed)) {
      setFormError('Pattern cannot contain { or } - Genie uses braces to separate fields.')
      return
    }
    const line = formatGagLine({ pattern: trimmed })

    setBusy(true)
    try {
      const newText =
        editingLine !== null
          ? replaceLine(editor.text, editingLine, line)
          : appendUnderPlayerSection(editor.text, line)
      await editor.applyAndSave(newText, reloadGags)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteEntry = async (g: Gag) => {
    if (!confirm(`Delete this gag?\n\n${formatGagLine(g)}`)) return
    setBusy(true)
    try {
      await editor.applyAndSave(removeLine(editor.text, g.sourceLine), reloadGags)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const restoreOriginal = async () => {
    if (!confirm('Undo every gag change made in this editor and go back to the file as it was before?'))
      return
    setBusy(true)
    try {
      await editor.restoreOriginal(reloadGags)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs text-ink-muted">
        Hides an entire matching line - a spam filter, not a redaction. Format unconfirmed against
        a real file on this machine (gags.cfg is empty here); if a saved entry doesn't take effect
        in Genie, this is the first thing to check.
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pattern"
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <button
          type="button"
          onClick={startImport}
          title="Paste several #gag lines at once"
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Import multiple
        </button>
        <button
          type="button"
          onClick={startAdd}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Add gag
        </button>
      </div>

      {editor.loading && <LoadingNotice />}
      {editor.error && !editor.loading && editor.entries.length === 0 && (
        <div className="rounded border border-border bg-surface-raised p-3 text-sm text-ink-muted">
          {editor.error}
        </div>
      )}

      {importing && (
        <div className="rounded-lg border border-accent-soft bg-surface-raised p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">Import multiple gags - paste #gag lines below</span>
            <button
              type="button"
              onClick={cancelForm}
              aria-label="Cancel gag import"
              title="Cancel gag import"
              className="rounded p-1 text-ink-faint hover:text-ink"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'#gag {A gentle breeze blows through the area.}'}
            rows={6}
            className="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint"
          />
          {importPreview && (
            <div className="mt-2 text-xs">
              <div className="text-good">
                {importPreview.valid.length} {importPreview.valid.length === 1 ? 'gag' : 'gags'} ready to import
              </div>
              {importPreview.skipped.length > 0 && (
                <div className="mt-1 text-ink-faint">
                  {importPreview.skipped.length} skipped:
                  <ul className="mt-0.5 list-disc pl-4">
                    {importPreview.skipped.slice(0, 5).map((s, i) => (
                      <li key={i} className="truncate" title={s}>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {formError && <div className="mt-2 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{formError}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancelForm} className="rounded px-3 py-1.5 text-xs text-ink-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitImport()}
              disabled={busy || !importPreview?.valid.length}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-[#1a1408] disabled:opacity-50"
            >
              {busy ? 'Importing…' : `Import ${importPreview?.valid.length ?? 0}`}
            </button>
          </div>
        </div>
      )}

      {(adding || editingLine !== null) && (
        <div className="rounded-lg border border-accent-soft bg-surface-raised p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">{adding ? 'New gag' : 'Edit gag'}</span>
            <button
              type="button"
              onClick={cancelForm}
              aria-label={adding ? 'Cancel new gag' : 'Cancel editing gag'}
              title={adding ? 'Cancel new gag' : 'Cancel editing gag'}
              className="rounded p-1 text-ink-faint hover:text-ink"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-ink-muted">Pattern - a whole line containing this text is hidden</span>
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
              placeholder="e.g. A gentle breeze blows through the area."
            />
          </label>
          {formError && <div className="mt-2 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{formError}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancelForm} className="rounded px-3 py-1.5 text-xs text-ink-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitForm()}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-[#1a1408] disabled:opacity-50"
            >
              {busy ? 'Saving…' : adding ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {filtered.map((g) => (
          <div key={g.sourceLine} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={g.pattern}>
              {g.pattern}
            </span>
            {isPlayerAddedLine(editor.text, g.sourceLine) && (
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-[#1a1408]">
                yours
              </span>
            )}
            <button type="button" onClick={() => startEdit(g)} className="shrink-0 rounded p-1 text-ink-faint hover:text-ink" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void deleteEntry(g)}
              className="shrink-0 rounded p-1 text-ink-faint hover:text-danger"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!editor.loading && filtered.length === 0 && editor.entries.length > 0 && (
          <div className="py-6 text-center text-sm text-ink-faint">No gag matches “{search}”.</div>
        )}
      </div>

      {editor.entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-ink-faint">{editor.entries.length} gags</span>
          <button
            type="button"
            onClick={() => void restoreOriginal()}
            disabled={!editor.backedUp || busy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-faint hover:text-danger disabled:opacity-40 disabled:hover:text-ink-faint"
            title={editor.backedUp ? 'Undo every change made in this editor' : 'Nothing has been saved yet'}
          >
            <RotateCcw className="h-3 w-3" /> Restore original file
          </button>
        </div>
      )}
    </div>
  )
}
