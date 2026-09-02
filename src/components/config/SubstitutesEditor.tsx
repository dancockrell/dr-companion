/**
 * The substitute manager - same CRUD/search/bulk-import shape as
 * AliasesEditor, two fields (find/replace) instead of name/expansion.
 *
 * Format caveat, shown in the panel itself: `Config/substitutes.cfg` is
 * empty on this machine, so unlike highlights/aliases/macros/variables this
 * format was never confirmed against a real file - see substitutes.ts's
 * header.
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, X, RotateCcw, Search, ClipboardPaste } from 'lucide-react'
import { parseSubstitutes, type Substitute } from '../../lib/substitutes'
import { LoadingNotice } from '../shared/LoadingNotice'
import { reloadSubstitutes } from '../../lib/useSubstitutes'
import { useGenieConfigEditor } from '../../lib/useGenieConfigEditor'
import {
  formatSubstituteLine,
  hasUnsafeBraces,
  replaceLine,
  removeLine,
  appendUnderPlayerSection,
  isPlayerAddedLine,
} from '../../lib/genieConfigEdit'

interface DraftSubstitute {
  find: string
  replace: string
}

const EMPTY_DRAFT: DraftSubstitute = { find: '', replace: '' }

function validateDraft(d: DraftSubstitute): string | null {
  if (!d.find.trim()) return 'Find text cannot be empty.'
  if (hasUnsafeBraces(d.find) || hasUnsafeBraces(d.replace)) {
    return 'Neither field can contain { or } - Genie uses braces to separate fields.'
  }
  return null
}

export function SubstitutesEditor() {
  const editor = useGenieConfigEditor<Substitute>('substitutes.cfg', parseSubstitutes)
  const [search, setSearch] = useState('')
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftSubstitute>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return editor.entries
    return editor.entries.filter(
      (s) => s.find.toLowerCase().includes(q) || s.replace.toLowerCase().includes(q)
    )
  }, [editor.entries, search])

  const importPreview = useMemo(() => {
    if (!importText.trim()) return null
    const { entries, skipped } = parseSubstitutes(importText)
    return { valid: entries, skipped }
  }, [importText])

  const startAdd = () => {
    setDraft(EMPTY_DRAFT)
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

  const startEdit = (s: Substitute) => {
    setDraft({ find: s.find, replace: s.replace })
    setEditingLine(s.sourceLine)
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
      setFormError('Nothing valid to import - paste one or more #substitute lines.')
      return
    }
    const pastedLines = importText.split(/\r\n|\n/)
    const rawLines = importPreview.valid.map((s) => pastedLines[s.sourceLine].trim())

    setBusy(true)
    try {
      const newText = rawLines.reduce((acc, line) => appendUnderPlayerSection(acc, line), editor.text)
      await editor.applyAndSave(newText, reloadSubstitutes)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitForm = async () => {
    const err = validateDraft(draft)
    if (err) {
      setFormError(err)
      return
    }
    const line = formatSubstituteLine({ find: draft.find.trim(), replace: draft.replace.trim() })

    setBusy(true)
    try {
      const newText =
        editingLine !== null
          ? replaceLine(editor.text, editingLine, line)
          : appendUnderPlayerSection(editor.text, line)
      await editor.applyAndSave(newText, reloadSubstitutes)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteEntry = async (s: Substitute) => {
    if (!confirm(`Delete this substitute?\n\n${formatSubstituteLine(s)}`)) return
    setBusy(true)
    try {
      await editor.applyAndSave(removeLine(editor.text, s.sourceLine), reloadSubstitutes)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const restoreOriginal = async () => {
    if (
      !confirm('Undo every substitute change made in this editor and go back to the file as it was before?')
    )
      return
    setBusy(true)
    try {
      await editor.restoreOriginal(reloadSubstitutes)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs text-ink-muted">
        Replaces text in what the game sends, before it's displayed - not what gets sent to the
        game. Format unconfirmed against a real file on this machine (substitutes.cfg is empty
        here); if a saved entry doesn't take effect in Genie, this is the first thing to check.
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search find or replace text"
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <button
          type="button"
          onClick={startImport}
          title="Paste several #substitute lines at once"
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Import multiple
        </button>
        <button
          type="button"
          onClick={startAdd}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Add substitute
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
            <span className="text-xs font-semibold text-ink">Import multiple substitutes - paste #substitute lines below</span>
            <button
              type="button"
              onClick={cancelForm}
              aria-label="Cancel substitute import"
              title="Cancel substitute import"
              className="rounded p-1 text-ink-faint hover:text-ink"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'#substitute {ye olde} {the}'}
            rows={6}
            className="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint"
          />
          {importPreview && (
            <div className="mt-2 text-xs">
              <div className="text-good">
                {importPreview.valid.length} {importPreview.valid.length === 1 ? 'substitute' : 'substitutes'} ready to import
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
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
            >
              {busy ? 'Importing…' : `Import ${importPreview?.valid.length ?? 0}`}
            </button>
          </div>
        </div>
      )}

      {(adding || editingLine !== null) && (
        <div className="rounded-lg border border-accent-soft bg-surface-raised p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">{adding ? 'New substitute' : 'Edit substitute'}</span>
            <button
              type="button"
              onClick={cancelForm}
              aria-label={adding ? 'Cancel new substitute' : 'Cancel editing substitute'}
              title={adding ? 'Cancel new substitute' : 'Cancel editing substitute'}
              className="rounded p-1 text-ink-faint hover:text-ink"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-ink-muted">Find - literal text to match</span>
              <input
                type="text"
                value={draft.find}
                onChange={(e) => setDraft({ ...draft, find: e.target.value })}
                className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
                placeholder="e.g. ye olde"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-muted">Replace with - empty deletes the matched text</span>
              <input
                type="text"
                value={draft.replace}
                onChange={(e) => setDraft({ ...draft, replace: e.target.value })}
                className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
                placeholder="e.g. the"
              />
            </label>
          </div>
          {formError && <div className="mt-2 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{formError}</div>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={cancelForm} className="rounded px-3 py-1.5 text-xs text-ink-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitForm()}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
            >
              {busy ? 'Saving…' : adding ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {filtered.map((s) => (
          <div key={s.sourceLine} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-ink" title={s.find}>
              {s.find}
            </span>
            <span className="shrink-0 text-ink-faint">→</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted" title={s.replace}>
              {s.replace || <span className="italic">(removed)</span>}
            </span>
            {isPlayerAddedLine(editor.text, s.sourceLine) && (
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-surface">
                yours
              </span>
            )}
            <button type="button" onClick={() => startEdit(s)} className="shrink-0 rounded p-1 text-ink-faint hover:text-ink" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void deleteEntry(s)}
              className="shrink-0 rounded p-1 text-ink-faint hover:text-danger"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!editor.loading && filtered.length === 0 && editor.entries.length > 0 && (
          <div className="py-6 text-center text-sm text-ink-faint">No substitute matches “{search}”.</div>
        )}
      </div>

      {editor.entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-ink-faint">{editor.entries.length} substitutes</span>
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
