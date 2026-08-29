/**
 * The highlights manager: search, add, edit, delete, and - the thing Genie
 * itself gives you none of - a live tester that shows exactly what a real
 * line of game text would do against the current config before you save
 * anything.
 *
 * Every write goes through `genieConfigEdit.ts`'s line-level patches, so a
 * player's own additions never disturb the curated corpus's comments, and an
 * edit or delete touches only its own line. See that file's header for why.
 */
import { useMemo, useState } from 'react'
import { Play, Plus, Trash2, Pencil, X, RotateCcw, Search } from 'lucide-react'
import { parseHighlights, paint, segments, type Highlight, type HighlightType } from '../../lib/highlights'
import { reloadHighlights } from '../../lib/useHighlights'
import { useGenieConfigEditor } from '../../lib/useGenieConfigEditor'
import {
  formatHighlightLine,
  hasUnsafeBraces,
  replaceLine,
  removeLine,
  appendUnderPlayerSection,
  isPlayerAddedLine,
} from '../../lib/genieConfigEdit'
import { listSounds } from '../../lib/genieConfigWrite'
import { invokeTauri, isTauri } from '../../lib/tauri'

const TYPES: HighlightType[] = ['line', 'string', 'beginswith', 'regexp']

const TYPE_HINT: Record<HighlightType, string> = {
  line: 'colours the whole line when the pattern appears anywhere in it',
  string: 'colours only the matched text, not the rest of the line',
  beginswith: 'matches only at the start of the line (after leading spaces)',
  regexp: 'a JavaScript-style regular expression',
}

interface DraftHighlight {
  type: HighlightType
  colour: string
  pattern: string
  cls: string
  sound: string
}

const EMPTY_DRAFT: DraftHighlight = { type: 'line', colour: '#FFFFFF', pattern: '', cls: '', sound: '' }

function draftFrom(h: Highlight): DraftHighlight {
  return { type: h.type, colour: h.colour, pattern: h.pattern, cls: h.cls ?? '', sound: h.sound ?? '' }
}

function validateDraft(d: DraftHighlight): string | null {
  if (!d.pattern.trim()) return 'Pattern cannot be empty.'
  if (hasUnsafeBraces(d.pattern) || hasUnsafeBraces(d.cls) || hasUnsafeBraces(d.sound)) {
    return 'None of these fields can contain { or } - Genie uses braces to separate fields.'
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(d.colour)) return 'Colour must be a 6-digit hex code.'
  if (d.type === 'regexp') {
    try {
      new RegExp(d.pattern)
    } catch (e) {
      return `Not a valid regular expression: ${(e as Error).message}`
    }
  }
  return null
}

/** A short, silent-by-default preview player - deliberately not routed
 * through alertSound.ts's channels, so auditioning a sound in the picker
 * works even while every channel is muted, at one fixed sensible volume. */
async function previewSound(name: string) {
  if (!isTauri() || !name) return
  try {
    const file = (await invokeTauri('read_sound', { name })) as { found: boolean; dataUrl: string }
    if (!file.found) return
    const audio = new Audio(file.dataUrl)
    audio.volume = 0.6
    void audio.play().catch(() => {})
  } catch {
    /* Auditioning a sound failing is not worth surfacing. */
  }
}

export function HighlightsEditor() {
  const editor = useGenieConfigEditor<Highlight>('highlights.cfg', parseHighlights)
  const [search, setSearch] = useState('')
  const [testLine, setTestLine] = useState('')
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftHighlight>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)
  const [sounds, setSounds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')

  // Loaded once, lazily, the first time the sound picker could plausibly be
  // opened - a player who never adds a sound never pays for the directory
  // listing.
  const ensureSounds = () => {
    if (sounds.length === 0) void listSounds().then(setSounds)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return editor.entries
    return editor.entries.filter(
      (h) =>
        h.pattern.toLowerCase().includes(q) ||
        (h.cls ?? '').toLowerCase().includes(q) ||
        (h.sound ?? '').toLowerCase().includes(q)
    )
  }, [editor.entries, search])

  const grouped = useMemo(() => {
    const byClass = new Map<string, Highlight[]>()
    for (const h of filtered) {
      const key = h.cls ?? '(no class)'
      if (!byClass.has(key)) byClass.set(key, [])
      byClass.get(key)!.push(h)
    }
    return [...byClass.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const testResult = useMemo(() => {
    if (!testLine) return null
    return paint(testLine, editor.entries)
  }, [testLine, editor.entries])

  const testSegments = testResult ? segments(testLine, testResult) : []

  const startAdd = () => {
    setDraft(EMPTY_DRAFT)
    setEditingLine(null)
    setAdding(true)
    setFormError('')
    ensureSounds()
  }

  const startEdit = (h: Highlight) => {
    setDraft(draftFrom(h))
    setEditingLine(h.sourceLine)
    setAdding(false)
    setFormError('')
    ensureSounds()
  }

  const cancelForm = () => {
    setAdding(false)
    setEditingLine(null)
    setFormError('')
  }

  const submitForm = async () => {
    const err = validateDraft(draft)
    if (err) {
      setFormError(err)
      return
    }
    const fields = {
      type: draft.type,
      colour: draft.colour.toUpperCase(),
      pattern: draft.pattern,
      cls: draft.cls.trim() || undefined,
      sound: draft.sound.trim() || undefined,
    }
    const line = formatHighlightLine(fields)

    setBusy(true)
    try {
      const newText =
        editingLine !== null
          ? replaceLine(editor.text, editingLine, line)
          : appendUnderPlayerSection(editor.text, line)
      await editor.applyAndSave(newText, reloadHighlights)
      cancelForm()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const deleteEntry = async (h: Highlight) => {
    if (!confirm(`Delete this highlight?\n\n${formatHighlightLine(h)}`)) return
    setBusy(true)
    try {
      await editor.applyAndSave(removeLine(editor.text, h.sourceLine), reloadHighlights)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const restoreOriginal = async () => {
    if (
      !confirm(
        'Undo every highlight change made in this editor and go back to the file as it was before?'
      )
    )
      return
    setBusy(true)
    try {
      await editor.restoreOriginal(reloadHighlights)
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
          <Play className="h-3 w-3" /> Test a line before you save anything
        </label>
        <input
          type="text"
          value={testLine}
          onChange={(e) => setTestLine(e.target.value)}
          placeholder="Paste a real line of game text, e.g. You notice as a black lynx pads into the area."
          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
        />
        {testResult && (
          <div className="mt-2 rounded border border-border bg-surface px-2 py-1.5 font-mono text-sm">
            {testSegments.map((seg, i) => (
              <span key={i} style={seg.colour ? { color: seg.colour } : undefined}>
                {seg.text}
              </span>
            ))}
          </div>
        )}
        {testResult && (
          <div className="mt-1 text-xs text-ink-faint">
            {testResult.matched.length
              ? `Matched ${testResult.matched.length} ${testResult.matched.length === 1 ? 'entry' : 'entries'}${testResult.sounds.length ? ` — would play ${testResult.sounds.join(', ')}` : ''}`
              : 'No entry matches this line.'}
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
            placeholder="Search pattern, class, or sound"
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" /> Add highlight
        </button>
      </div>

      {editor.loading && <div className="py-6 text-center text-sm text-ink-faint">Loading…</div>}
      {editor.error && !editor.loading && editor.entries.length === 0 && (
        <div className="rounded border border-border bg-surface-raised p-3 text-sm text-ink-muted">
          {editor.error}
        </div>
      )}

      {(adding || editingLine !== null) && (
        <HighlightForm
          draft={draft}
          setDraft={setDraft}
          sounds={sounds}
          error={formError}
          busy={busy}
          isNew={adding}
          onCancel={cancelForm}
          onSubmit={submitForm}
          onPreviewSound={previewSound}
        />
      )}

      <div className="flex flex-col gap-3">
        {grouped.map(([cls, entries]) => (
          <div key={cls}>
            <div className="mb-1 px-0.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {cls} <span className="font-normal normal-case text-ink-faint">({entries.length})</span>
            </div>
            <div className="flex flex-col gap-1">
              {entries.map((h) => (
                <div
                  key={h.sourceLine}
                  className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: h.colour }}
                    title={h.colour}
                  />
                  <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-ink-faint">
                    {h.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={h.pattern}>
                    {h.pattern}
                  </span>
                  {h.sound && (
                    <button
                      type="button"
                      onClick={() => previewSound(h.sound!)}
                      title={`Play ${h.sound}`}
                      className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
                    >
                      <Play className="h-2.5 w-2.5" /> {h.sound}
                    </button>
                  )}
                  {isPlayerAddedLine(editor.text, h.sourceLine) && (
                    <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-[#1a1408]">
                      yours
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(h)}
                    className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteEntry(h)}
                    className="shrink-0 rounded p-1 text-ink-faint hover:text-danger"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!editor.loading && filtered.length === 0 && editor.entries.length > 0 && (
          <div className="py-6 text-center text-sm text-ink-faint">No highlight matches “{search}”.</div>
        )}
      </div>

      {editor.entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="text-xs text-ink-faint">
            {editor.entries.length} highlights{editor.skipped.length ? `, ${editor.skipped.length} skipped` : ''}
          </span>
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

function HighlightForm({
  draft,
  setDraft,
  sounds,
  error,
  busy,
  isNew,
  onCancel,
  onSubmit,
  onPreviewSound,
}: {
  draft: DraftHighlight
  setDraft: (d: DraftHighlight) => void
  sounds: string[]
  error: string
  busy: boolean
  isNew: boolean
  onCancel: () => void
  onSubmit: () => void
  onPreviewSound: (name: string) => void
}) {
  return (
    <div className="rounded-lg border border-accent-soft bg-surface-raised p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">{isNew ? 'New highlight' : 'Edit highlight'}</span>
        <button type="button" onClick={onCancel} className="rounded p-1 text-ink-faint hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Type</span>
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as HighlightType })}
            className="rounded border border-border bg-surface px-2 py-1 text-ink"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-faint">{TYPE_HINT[draft.type]}</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Colour</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={draft.colour}
              onChange={(e) => setDraft({ ...draft, colour: e.target.value })}
              className="h-7 w-9 shrink-0 rounded border border-border bg-surface"
            />
            <input
              type="text"
              value={draft.colour}
              onChange={(e) => setDraft({ ...draft, colour: e.target.value })}
              className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
            />
          </div>
        </label>

        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-ink-muted">
            Pattern {draft.type === 'regexp' ? '(regular expression)' : '(plain text)'}
          </span>
          <input
            type="text"
            value={draft.pattern}
            onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            className="w-full rounded border border-border bg-surface px-2 py-1 font-mono text-ink"
            placeholder={draft.type === 'regexp' ? 'e.g. lodged .* into your' : 'e.g. into the area'}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Class (optional)</span>
          <input
            type="text"
            value={draft.cls}
            onChange={(e) => setDraft({ ...draft, cls: e.target.value })}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-ink"
            placeholder="e.g. danger"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Sound (optional)</span>
          <div className="flex items-center gap-1">
            <select
              value={draft.sound}
              onChange={(e) => setDraft({ ...draft, sound: e.target.value })}
              className="w-full rounded border border-border bg-surface px-2 py-1 text-ink"
            >
              <option value="">No sound</option>
              {sounds.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {draft.sound && (
              <button
                type="button"
                onClick={() => onPreviewSound(draft.sound)}
                title={`Play ${draft.sound}`}
                className="shrink-0 rounded border border-border p-1 text-ink-muted hover:border-accent hover:text-accent"
              >
                <Play className="h-3 w-3" />
              </button>
            )}
          </div>
        </label>
      </div>

      {error && <div className="mt-2 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{error}</div>}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-[#1a1408] disabled:opacity-50"
        >
          {busy ? 'Saving…' : isNew ? 'Add' : 'Save'}
        </button>
      </div>
    </div>
  )
}
