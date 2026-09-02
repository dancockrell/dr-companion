/**
 * The alias manager - same shape as HighlightsEditor, simpler fields (just
 * name and expansion), with the equivalent of its live tester: type a
 * command the way you'd type it in the game pane and see exactly what it
 * expands to, before saving anything. Testing an alias in Genie means
 * actually typing it in-game; this doesn't.
 */
import { useMemo, useState } from 'react'
import { Play, Plus, Trash2, Pencil, X, RotateCcw, Search, ClipboardPaste, Loader2 } from 'lucide-react'
import { parseAliases, expandAlias, type Alias } from '../../lib/aliases'
import { reloadAliases } from '../../lib/useAliases'
import { referencedVariables } from '../../lib/variables'
import { useVariables } from '../../lib/useVariables'
import { useGenieConfigEditor } from '../../lib/useGenieConfigEditor'
import {
  formatAliasLine,
  hasUnsafeBraces,
  replaceLine,
  removeLine,
  appendUnderPlayerSection,
  isPlayerAddedLine,
} from '../../lib/genieConfigEdit'

interface DraftAlias {
  name: string
  expansion: string
}

const EMPTY_DRAFT: DraftAlias = { name: '', expansion: '' }

function validateDraft(d: DraftAlias, existing: Alias[], editingLine: number | null): string | null {
  const name = d.name.trim()
  if (!name) return 'Name cannot be empty.'
  if (/\s/.test(name)) return 'A name cannot contain spaces - it has to be one word to type.'
  if (!d.expansion.trim()) return 'Expansion cannot be empty.'
  if (hasUnsafeBraces(d.name) || hasUnsafeBraces(d.expansion)) {
    return 'Neither field can contain { or } - Genie uses braces to separate fields.'
  }
  const clash = existing.find(
    (a) => a.name.toLowerCase() === name.toLowerCase() && a.sourceLine !== editingLine
  )
  if (clash) return `“${name}” is already an alias (expands to “${clash.expansion}”). Names must be unique.`
  return null
}

export function AliasesEditor() {
  const editor = useGenieConfigEditor<Alias>('aliases.cfg', parseAliases)
  const [search, setSearch] = useState('')
  const [testCommand, setTestCommand] = useState('')
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftAlias>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return editor.entries
    return editor.entries.filter(
      (a) => a.name.toLowerCase().includes(q) || a.expansion.toLowerCase().includes(q)
    )
  }, [editor.entries, search])

  const testResult = useMemo(() => {
    if (!testCommand.trim()) return null
    return expandAlias(testCommand, editor.entries)
  }, [testCommand, editor.entries])

  const { variables } = useVariables()
  /** `$preposition`/`$shop`-style tokens left in the expansion, resolved
   * against Genie's live `#var` table purely as a preview - what actually
   * gets sent is still the unresolved text, exactly as Genie itself sends
   * it. Without this a player has no way to know what `$shop` even means
   * short of opening variables.cfg by hand. */
  const testVariables = useMemo(() => {
    if (!testResult?.text) return []
    return referencedVariables(testResult.text).map((name) => ({
      name,
      value: variables.find((v) => v.name === name)?.value ?? null,
    }))
  }, [testResult, variables])

  /** Same shape as MacrosEditor's importPreview: reuse the real parser, then
   * add the one check a single add's validateDraft already gets for free -
   * a name that collides with something already in the file. Genie has no
   * such preview at all; a pasted block just silently shadows whatever it
   * collides with the moment it is typed in. */
  const importPreview = useMemo(() => {
    if (!importText.trim()) return null
    const { entries, skipped } = parseAliases(importText)
    const existingNames = new Set(editor.entries.map((a) => a.name.toLowerCase()))
    const seenInBatch = new Set<string>()
    const valid: Alias[] = []
    const clashes: string[] = []
    for (const a of entries) {
      const lower = a.name.toLowerCase()
      if (existingNames.has(lower)) {
        clashes.push(`${formatAliasLine(a)} - "${a.name}" already exists`)
      } else if (seenInBatch.has(lower)) {
        clashes.push(`${formatAliasLine(a)} - "${a.name}" appears twice in this paste`)
      } else {
        seenInBatch.add(lower)
        valid.push(a)
      }
    }
    return { valid, skipped: [...skipped, ...clashes] }
  }, [importText, editor.entries])

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

  const startEdit = (a: Alias) => {
    setDraft({ name: a.name, expansion: a.expansion })
    setEditingLine(a.sourceLine)
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
      setFormError('Nothing valid to import - paste one or more #alias lines with names that are not already used.')
      return
    }
    const pastedLines = importText.split(/\r\n|\n/)
    const rawLines = importPreview.valid.map((a) => pastedLines[a.sourceLine].trim())

    setBusy(true)
    try {
      const newText = rawLines.reduce((acc, line) => appendUnderPlayerSection(acc, line), editor.text)
      await editor.applyAndSave(newText, reloadAliases)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitForm = async () => {
    const err = validateDraft(draft, editor.entries, editingLine)
    if (err) {
      setFormError(err)
      return
    }
    const line = formatAliasLine({ name: draft.name.trim(), expansion: draft.expansion.trim() })

    setBusy(true)
    try {
      const newText =
        editingLine !== null
          ? replaceLine(editor.text, editingLine, line)
          : appendUnderPlayerSection(editor.text, line)
      await editor.applyAndSave(newText, reloadAliases)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteEntry = async (a: Alias) => {
    if (!confirm(`Delete this alias?\n\n${formatAliasLine(a)}`)) return
    setBusy(true)
    try {
      await editor.applyAndSave(removeLine(editor.text, a.sourceLine), reloadAliases)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const restoreOriginal = async () => {
    if (!confirm('Undo every alias change made in this editor and go back to the file as it was before?'))
      return
    setBusy(true)
    try {
      await editor.restoreOriginal(reloadAliases)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
          <Play className="h-3 w-3" /> Test a command before you save anything
        </label>
        <input
          type="text"
          value={testCommand}
          onChange={(e) => setTestCommand(e.target.value)}
          placeholder="Type it the way you would in the game pane, e.g. appc my silver sword"
          className="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-sm text-ink placeholder:text-ink-faint placeholder:font-sans"
        />
        {testResult && (
          <div className="mt-2 rounded border border-border bg-surface px-2 py-1.5 font-mono text-sm text-ink">
            {testResult.text || <span className="text-ink-faint">(sends nothing)</span>}
          </div>
        )}
        {testResult && (
          <div className="mt-1 text-xs text-ink-faint">
            {testResult.expanded
              ? `Expanded via ${testResult.chain.join(' → ')}${testResult.capped ? ' — stopped early (a loop or too many steps)' : ''}`
              : 'No alias matches the first word - this would be sent exactly as typed.'}
          </div>
        )}
        {testVariables.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-faint">
            {testVariables.map(({ name, value }) => (
              <span key={name}>
                <code className="text-ink-muted">${name}</code> ={' '}
                {value === null ? (
                  <span className="italic">not set right now</span>
                ) : (
                  <code className="text-ink-muted">{value || '(empty)'}</code>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or expansion"
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <button
          type="button"
          onClick={startImport}
          title="Paste several #alias lines at once - from a guildmate's shared config, for instance"
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Import multiple
        </button>
        <button
          type="button"
          onClick={startAdd}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Add alias
        </button>
      </div>

      {editor.loading && <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-faint"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading…</div>}
      {editor.error && !editor.loading && editor.entries.length === 0 && (
        <div className="rounded border border-border bg-surface-raised p-3 text-sm text-ink-muted">
          {editor.error}
        </div>
      )}

      {importing && (
        <div className="rounded-lg border border-accent-soft bg-surface-raised p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">Import multiple aliases - paste #alias lines below</span>
            <button
              type="button"
              onClick={cancelForm}
              aria-label="Cancel alias import"
              title="Cancel alias import"
              className="rounded p-1 text-ink-faint hover:text-ink"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'#alias {appc} {appraise $0 careful}\n#alias {anec} {accuse $1 necromancy}'}
            rows={6}
            className="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint"
          />
          {importPreview && (
            <div className="mt-2 text-xs">
              <div className="text-good">
                {importPreview.valid.length} {importPreview.valid.length === 1 ? 'alias' : 'aliases'} ready to import
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
            <span className="text-xs font-semibold text-ink">{adding ? 'New alias' : 'Edit alias'}</span>
            <button
              type="button"
              onClick={cancelForm}
              aria-label={adding ? 'Cancel new alias' : 'Cancel editing alias'}
              title={adding ? 'Cancel new alias' : 'Cancel editing alias'}
              className="rounded p-1 text-ink-faint hover:text-ink"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-ink-muted">Name - one word, what you'll type</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
                placeholder="e.g. appc"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-muted">
                Expansion - <code className="text-ink-faint">$0</code> is everything typed after the
                name, <code className="text-ink-faint">$1</code>/<code className="text-ink-faint">$2</code>
                /… are that split into words
              </span>
              <input
                type="text"
                value={draft.expansion}
                onChange={(e) => setDraft({ ...draft, expansion: e.target.value })}
                className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
                placeholder="e.g. appraise $0 careful"
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
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-[#1a1408] disabled:opacity-50"
            >
              {busy ? 'Saving…' : adding ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {filtered.map((a) => (
          <div key={a.sourceLine} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
            <span className="w-28 shrink-0 truncate font-mono text-xs font-medium text-ink" title={a.name}>
              {a.name}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted" title={a.expansion}>
              {a.expansion}
            </span>
            {isPlayerAddedLine(editor.text, a.sourceLine) && (
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-[#1a1408]">
                yours
              </span>
            )}
            <button type="button" onClick={() => startEdit(a)} className="shrink-0 rounded p-1 text-ink-faint hover:text-ink" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void deleteEntry(a)}
              className="shrink-0 rounded p-1 text-ink-faint hover:text-danger"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!editor.loading && filtered.length === 0 && editor.entries.length > 0 && (
          <div className="py-6 text-center text-sm text-ink-faint">No alias matches “{search}”.</div>
        )}
      </div>

      {editor.entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-ink-faint">{editor.entries.length} aliases</span>
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
