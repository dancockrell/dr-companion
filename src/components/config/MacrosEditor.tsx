/**
 * The macro manager - same CRUD/search/bulk-import shape as
 * Highlights/AliasesEditor, plus one thing neither of those needs and Genie
 * has no equivalent of at all: a "press a key" capture, so binding F9 means
 * pressing F9, not looking up what Genie calls it in its own config format.
 *
 * What this does NOT do: fire these macros live. `command` can be a bare
 * game line (Dan's F1 = `look @`) or a chain of Genie-script instructions
 * (`#queue clear;#script abort all`, `$variable` substitution, the `\x`
 * escape several of his own F-keys use) - this app has no Genie-script
 * interpreter, and building a partial one to make *some* macros fire live
 * while silently doing nothing for the rest would be worse than not
 * pretending to, the same reasoning `macros.ts`'s header gives. This is a
 * config editor for the file, honestly labelled as exactly that.
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, X, RotateCcw, Search, ClipboardPaste, Keyboard } from 'lucide-react'
import { parseMacros, comboKey, normalizeModifiers, type Macro } from '../../lib/macros'
import { reloadMacros } from '../../lib/useMacros'
import { referencedVariables } from '../../lib/variables'
import { useVariables } from '../../lib/useVariables'
import { codeToGenieKey } from '../../lib/keybindings'
import { useGenieConfigEditor } from '../../lib/useGenieConfigEditor'
import {
  formatMacroLine,
  hasUnsafeBraces,
  replaceLine,
  removeLine,
  appendUnderPlayerSection,
  isPlayerAddedLine,
} from '../../lib/genieConfigEdit'

interface DraftMacro {
  key: string
  modifiers: string[]
  command: string
}

const EMPTY_DRAFT: DraftMacro = { key: '', modifiers: [], command: '' }
const ALL_MODIFIERS = ['Shift', 'Control', 'Alt'] as const

function comboLabel(key: string, modifiers: readonly string[]): string {
  return [...normalizeModifiers(modifiers), key].join(' + ')
}

function validateDraft(d: DraftMacro, existing: Macro[], editingLine: number | null): string | null {
  const key = d.key.trim()
  if (!key) return 'Press a key, or type its Genie name, first.'
  if (!d.command.trim()) return 'Command cannot be empty.'
  if (hasUnsafeBraces(key) || hasUnsafeBraces(d.command)) {
    return 'Neither field can contain { or } - Genie uses braces to separate fields.'
  }
  const combo = comboKey(key, d.modifiers)
  const clash = existing.find(
    (m) => comboKey(m.key, m.modifiers) === combo && m.sourceLine !== editingLine
  )
  if (clash) {
    return `${comboLabel(key, d.modifiers)} is already bound to “${clash.command}”. Delete or edit that one first.`
  }
  return null
}

export function MacrosEditor() {
  const editor = useGenieConfigEditor<Macro>('macros.cfg', parseMacros)
  const [search, setSearch] = useState('')
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftMacro>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [recording, setRecording] = useState(false)

  const { variables } = useVariables()
  /** `$variable` tokens in the draft command, resolved against Genie's live
   * table as a preview only - same reasoning as AliasesEditor's version of
   * this. Doesn't change what gets saved to the file. */
  const draftVariables = useMemo(() => {
    return referencedVariables(draft.command).map((name) => ({
      name,
      value: variables.find((v) => v.name === name)?.value ?? null,
    }))
  }, [draft.command, variables])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return editor.entries
    return editor.entries.filter(
      (m) =>
        comboLabel(m.key, m.modifiers).toLowerCase().includes(q) ||
        m.command.toLowerCase().includes(q)
    )
  }, [editor.entries, search])

  /** Same shape as AliasesEditor's importPreview: reuse the real parser, then
   * add the one check a single add's validateDraft already gets for free -
   * a combo that collides with something already bound. */
  const importPreview = useMemo(() => {
    if (!importText.trim()) return null
    const { entries, skipped } = parseMacros(importText)
    const existingCombos = new Set(editor.entries.map((m) => comboKey(m.key, m.modifiers)))
    const seenInBatch = new Set<string>()
    const valid: Macro[] = []
    const clashes: string[] = []
    for (const m of entries) {
      const combo = comboKey(m.key, m.modifiers)
      if (existingCombos.has(combo)) {
        clashes.push(`${formatMacroLine(m)} - ${comboLabel(m.key, m.modifiers)} is already bound`)
      } else if (seenInBatch.has(combo)) {
        clashes.push(`${formatMacroLine(m)} - ${comboLabel(m.key, m.modifiers)} appears twice in this paste`)
      } else {
        seenInBatch.add(combo)
        valid.push(m)
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
    setRecording(false)
  }

  const startImport = () => {
    setImportText('')
    setImporting(true)
    setAdding(false)
    setEditingLine(null)
    setFormError('')
    setRecording(false)
  }

  const startEdit = (m: Macro) => {
    setDraft({ key: m.key, modifiers: m.modifiers, command: m.command })
    setEditingLine(m.sourceLine)
    setAdding(false)
    setImporting(false)
    setFormError('')
    setRecording(false)
  }

  const cancelForm = () => {
    setAdding(false)
    setEditingLine(null)
    setImporting(false)
    setFormError('')
    setRecording(false)
  }

  /**
   * One-shot capture: the next real keydown fills the key + modifier fields
   * from `codeToGenieKey`, the same table `keybindings.ts` will eventually
   * resolve live bindings through, so a combo recorded here is guaranteed to
   * be one this app can at least recognise. A code the table refuses (a bare
   * modifier press, or a key nothing in the observed corpus ever binds)
   * re-arms the listener rather than filling the field with something wrong.
   */
  const startRecording = () => {
    setRecording(true)
    setFormError('')
    const onKey = (e: KeyboardEvent) => {
      const genieKey = codeToGenieKey(e.code)
      if (!genieKey) return
      e.preventDefault()
      window.removeEventListener('keydown', onKey, true)
      const mods: string[] = []
      if (e.shiftKey) mods.push('Shift')
      if (e.ctrlKey) mods.push('Control')
      if (e.altKey) mods.push('Alt')
      setDraft((d) => ({ ...d, key: genieKey, modifiers: mods }))
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
  }

  const submitImport = async () => {
    if (!importPreview || importPreview.valid.length === 0) {
      setFormError('Nothing valid to import - paste one or more #macro lines bound to keys that are not already used.')
      return
    }
    const pastedLines = importText.split(/\r\n|\n/)
    const rawLines = importPreview.valid.map((m) => pastedLines[m.sourceLine].trim())

    setBusy(true)
    try {
      const newText = rawLines.reduce((acc, line) => appendUnderPlayerSection(acc, line), editor.text)
      await editor.applyAndSave(newText, reloadMacros)
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
    const line = formatMacroLine({
      key: draft.key.trim(),
      modifiers: normalizeModifiers(draft.modifiers),
      command: draft.command.trim(),
    })

    setBusy(true)
    try {
      const newText =
        editingLine !== null
          ? replaceLine(editor.text, editingLine, line)
          : appendUnderPlayerSection(editor.text, line)
      await editor.applyAndSave(newText, reloadMacros)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteEntry = async (m: Macro) => {
    if (!confirm(`Delete this macro?\n\n${formatMacroLine(m)}`)) return
    setBusy(true)
    try {
      await editor.applyAndSave(removeLine(editor.text, m.sourceLine), reloadMacros)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const restoreOriginal = async () => {
    if (!confirm('Undo every macro change made in this editor and go back to the file as it was before?'))
      return
    setBusy(true)
    try {
      await editor.restoreOriginal(reloadMacros)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs text-ink-muted">
        Editing the file, not the live keyboard: a change here takes effect the next time this
        client reads <code className="text-ink-faint">macros.cfg</code>, not while you are pressing keys in
        the game pane right now.
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search key or command"
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <button
          type="button"
          onClick={startImport}
          title="Paste several #macro lines at once - from a guildmate's shared config, for instance"
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Import multiple
        </button>
        <button
          type="button"
          onClick={startAdd}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Add macro
        </button>
      </div>

      {editor.loading && <div className="py-6 text-center text-sm text-ink-faint">Loading…</div>}
      {editor.error && !editor.loading && editor.entries.length === 0 && (
        <div className="rounded border border-border bg-surface-raised p-3 text-sm text-ink-muted">
          {editor.error}
        </div>
      )}

      {importing && (
        <div className="rounded-lg border border-accent-soft bg-surface-raised p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink">Import multiple macros - paste #macro lines below</span>
            <button type="button" onClick={cancelForm} className="rounded p-1 text-ink-faint hover:text-ink" aria-label="Cancel macro import">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'#macro {F1} {look @}\n#macro {F2, Shift} {analyze}'}
            rows={6}
            className="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint"
          />
          {importPreview && (
            <div className="mt-2 text-xs">
              <div className="text-good">
                {importPreview.valid.length} {importPreview.valid.length === 1 ? 'macro' : 'macros'} ready to import
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
            <span className="text-xs font-semibold text-ink">{adding ? 'New macro' : 'Edit macro'}</span>
            <button type="button" onClick={cancelForm} className="rounded p-1 text-ink-faint hover:text-ink" aria-label="Cancel macro editing">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-ink-muted">Key combination</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startRecording}
                  className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-ink hover:border-accent hover:text-accent"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                  {recording ? 'Press a key…' : 'Press to record'}
                </button>
                <span className="min-w-0 flex-1 truncate rounded border border-border bg-surface px-2 py-1 font-mono text-ink">
                  {draft.key ? comboLabel(draft.key, draft.modifiers) : <span className="text-ink-faint">not set</span>}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {ALL_MODIFIERS.map((mod) => (
                <label key={mod} className="flex items-center gap-1 text-ink-muted">
                  <input
                    type="checkbox"
                    checked={draft.modifiers.includes(mod)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        modifiers: e.target.checked
                          ? [...d.modifiers, mod]
                          : d.modifiers.filter((m) => m !== mod),
                      }))
                    }
                  />
                  {mod}
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-ink-muted">
                Command - what to send, exactly as typed - <code className="text-ink-faint">;</code>
                -joined for several in a row
              </span>
              <input
                type="text"
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
                placeholder="e.g. look @"
              />
            </label>
            {draftVariables.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ink-faint">
                {draftVariables.map(({ name, value }) => (
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
        {filtered.map((m) => (
          <div key={m.sourceLine} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
            <span className="w-32 shrink-0 truncate font-mono text-xs font-medium text-ink" title={comboLabel(m.key, m.modifiers)}>
              {comboLabel(m.key, m.modifiers)}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted" title={m.command}>
              {m.command}
            </span>
            {isPlayerAddedLine(editor.text, m.sourceLine) && (
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-[#1a1408]">
                yours
              </span>
            )}
            <button type="button" onClick={() => startEdit(m)} className="shrink-0 rounded p-1 text-ink-faint hover:text-ink" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void deleteEntry(m)}
              className="shrink-0 rounded p-1 text-ink-faint hover:text-danger"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!editor.loading && filtered.length === 0 && editor.entries.length > 0 && (
          <div className="py-6 text-center text-sm text-ink-faint">No macro matches “{search}”.</div>
        )}
      </div>

      {editor.entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-ink-faint">{editor.entries.length} macros</span>
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
