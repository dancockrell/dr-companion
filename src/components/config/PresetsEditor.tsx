/**
 * Genie's UI colour scheme - search, edit, delete, with a live swatch.
 *
 * Deliberately no "add" and no bulk import, unlike the other five tabs.
 * A `#preset` name is part of Genie's own fixed internal vocabulary
 * (`health`, `roomname`, `automapper.line`, ...) - typing a name Genie does
 * not recognise produces a saved line that colours nothing, ever, because
 * nothing in Genie looks it up. Editing the colour or weight of a name
 * that's already here is real and safe; inventing a new one is not
 * something this app can do usefully, so it doesn't offer to.
 */
import { useMemo, useState } from 'react'
import { Trash2, Pencil, X, RotateCcw, Search } from 'lucide-react'
import { parsePresets, presetColours, type Preset } from '../../lib/presets'
import { LoadingNotice } from '../shared/LoadingNotice'
import { reloadPresets } from '../../lib/usePresets'
import { useGenieConfigEditor } from '../../lib/useGenieConfigEditor'
import {
  formatPresetLine,
  hasUnsafeBraces,
  replaceLine,
  removeLine,
} from '../../lib/genieConfigEdit'

interface DraftPreset {
  fg: string
  bg: string
  bold: boolean
}

function draftFrom(p: Preset): DraftPreset {
  const { fg, bg } = presetColours(p.colours)
  return { fg, bg: bg ?? '', bold: p.bold }
}

function validateDraft(d: DraftPreset): string | null {
  if (!d.fg.trim()) return 'Foreground colour cannot be empty.'
  if (hasUnsafeBraces(d.fg) || hasUnsafeBraces(d.bg)) {
    return 'Neither field can contain { or } - Genie uses braces to separate fields.'
  }
  if (d.fg.includes(',') || d.bg.includes(',')) {
    return 'A colour name cannot contain a comma - that character separates foreground from background.'
  }
  return null
}

function Swatch({ colours }: { colours: string }) {
  const { fg, bg } = presetColours(colours)
  return (
    <span
      className="flex h-5 w-9 shrink-0 items-center justify-center rounded border border-border text-xs font-bold"
      style={{ color: fg, backgroundColor: bg ?? 'transparent' }}
      title={colours}
    >
      Aa
    </span>
  )
}

export function PresetsEditor() {
  const editor = useGenieConfigEditor<Preset>('presets.cfg', parsePresets)
  const [search, setSearch] = useState('')
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftPreset>({ fg: '', bg: '', bold: false })
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return editor.entries
    return editor.entries.filter(
      (p) => p.name.toLowerCase().includes(q) || p.colours.toLowerCase().includes(q)
    )
  }, [editor.entries, search])

  const startEdit = (p: Preset) => {
    setDraft(draftFrom(p))
    setEditingLine(p.sourceLine)
    setFormError('')
  }

  const cancelForm = () => {
    setEditingLine(null)
    setFormError('')
  }

  const submitForm = async (p: Preset) => {
    const err = validateDraft(draft)
    if (err) {
      setFormError(err)
      return
    }
    const colours = draft.bg.trim() ? `${draft.fg.trim()}, ${draft.bg.trim()}` : draft.fg.trim()
    const line = formatPresetLine({ name: p.name, colours, bold: draft.bold })

    setBusy(true)
    try {
      await editor.applyAndSave(replaceLine(editor.text, p.sourceLine, line), reloadPresets)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteEntry = async (p: Preset) => {
    if (
      !confirm(
        `Delete this preset?\n\n${formatPresetLine(p)}\n\nGenie will fall back to its own built-in colour for "${p.name}" - this doesn't turn the element off, just stops overriding its colour.`
      )
    )
      return
    setBusy(true)
    try {
      await editor.applyAndSave(removeLine(editor.text, p.sourceLine), reloadPresets)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const restoreOriginal = async () => {
    if (
      !confirm('Undo every preset change made in this editor and go back to the file as it was before?')
    )
      return
    setBusy(true)
    try {
      await editor.restoreOriginal(reloadPresets)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs text-ink-muted">
        Genie's UI colour scheme - health bar, room text, the map's own lines and nodes. Each name
        is one Genie already recognises; there's no "add" here because a name it doesn't recognise
        colours nothing, ever.
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or colour"
          className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-faint"
        />
      </div>

      {editor.loading && <LoadingNotice />}
      {editor.error && !editor.loading && editor.entries.length === 0 && (
        <div className="rounded border border-border bg-surface-raised p-3 text-sm text-ink-muted">
          {editor.error}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {filtered.map((p) => {
          const editing = editingLine === p.sourceLine
          return (
            <div key={p.sourceLine} className="rounded border border-border bg-surface px-2 py-1.5">
              <div className="flex items-center gap-2">
                <Swatch colours={p.colours} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={p.name}>
                  {p.name}
                </span>
                <span className="shrink-0 truncate font-mono text-xs text-ink-faint" title={p.colours}>
                  {p.colours}
                  {p.bold ? ', bold' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => (editing ? cancelForm() : startEdit(p))}
                  className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
                  title={editing ? 'Cancel' : 'Edit'}
                >
                  {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteEntry(p)}
                  className="shrink-0 rounded p-1 text-ink-faint hover:text-danger"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {editing && (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2 text-xs">
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-muted">Foreground</span>
                    <input
                      type="text"
                      value={draft.fg}
                      onChange={(e) => setDraft({ ...draft, fg: e.target.value })}
                      className="w-28 rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
                      placeholder="e.g. Red"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-muted">Background (optional)</span>
                    <input
                      type="text"
                      value={draft.bg}
                      onChange={(e) => setDraft({ ...draft, bg: e.target.value })}
                      className="w-28 rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
                      placeholder="e.g. #400000"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 pb-1.5 text-ink-muted">
                    <input
                      type="checkbox"
                      checked={draft.bold}
                      onChange={(e) => setDraft({ ...draft, bold: e.target.checked })}
                    />
                    Bold
                  </label>
                  <Swatch colours={draft.bg.trim() ? `${draft.fg}, ${draft.bg}` : draft.fg} />
                  <button
                    type="button"
                    onClick={() => void submitForm(p)}
                    disabled={busy}
                    className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-[#1a1408] disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  {formError && <div className="w-full rounded bg-danger/10 px-2 py-1 text-danger">{formError}</div>}
                </div>
              )}
            </div>
          )
        })}
        {!editor.loading && filtered.length === 0 && editor.entries.length > 0 && (
          <div className="py-6 text-center text-sm text-ink-faint">No preset matches “{search}”.</div>
        )}
      </div>

      {editor.entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-ink-faint">{editor.entries.length} presets</span>
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
