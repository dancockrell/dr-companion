/**
 * Named colour sets a highlight can point at.
 *
 * # What reaches the game pane, and what does not
 *
 * Stated here rather than left for a player to discover: **only `fg` is
 * rendered today.** `paint()` returns one colour per line and one per span,
 * and `HighlightedText` sets `color` from it - there is nowhere for a
 * background or a weight to go without changing that signature, which Q2 is
 * explicitly not doing (`docs/PLAN_TO_1_0.md`, Q2 `do:`).
 *
 * `bg` and `bold` are still edited here because they are already in the store:
 * a real `presets.cfg` carries them and Q1's import brought 31 of them across.
 * Dropping the fields from the editor would lose a player's imported values
 * the first time they touched a preset. So they are kept, and the tab says on
 * screen that they are not painted yet - a field nobody reads is an absence
 * with more steps, and the honest version of that is to admit it rather than
 * to render a control that quietly does nothing.
 *
 * Italic and underline are deliberately **not** here. Adding two fields the
 * store does not declare and the renderer cannot use would be that same
 * absence, freshly built.
 */
import { useState } from 'react'
import {
  addEntry,
  newId,
  removeEntry,
  updateEntry,
  usePlayerConfig,
  type PresetRule,
} from '../../lib/playerConfig.ts'
import {
  DEFAULT_HIGHLIGHT_COLOUR,
  asHexColour,
  highlightsUsingPreset,
  refuseDeletingPreset,
} from '../../lib/highlights.ts'

export function PresetsTab() {
  const config = usePlayerConfig()
  const [note, setNote] = useState<string | null>(null)

  const addPreset = () => {
    const entry: PresetRule = {
      id: newId('presets'),
      enabled: true,
      source: 'player',
      name: `preset ${config.presets.length + 1}`,
      fg: DEFAULT_HIGHLIGHT_COLOUR,
      bold: false,
    }
    const write = addEntry('presets', entry)
    setNote(write.ok ? null : `Could not save: ${write.message}`)
  }

  const patch = (id: string, fields: Partial<PresetRule>) => {
    const write = updateEntry('presets', id, fields)
    setNote(write.ok ? null : `Could not save: ${write.message}`)
  }

  /*
   * The refusal, and why it is a refusal rather than a warning.
   *
   * A preset that goes away takes the colour of every rule naming it with no
   * visible cause: the rules still fire, still match, and are simply grey.
   * `resolveHighlights` reports each one, but that report is read after the
   * fact. Naming the rules here is the version the player can act on before
   * anything changes.
   */
  const deletePreset = (preset: PresetRule) => {
    const verdict = refuseDeletingPreset(preset, config.highlights)
    if (!verdict.ok) {
      setNote(verdict.why)
      return
    }
    const write = removeEntry('presets', preset.id)
    setNote(write.ok ? `Deleted "${preset.name}".` : `Could not save: ${write.message}`)
  }

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="presets-tab">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addPreset}
          data-testid="preset-add"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
        >
          Add preset
        </button>
        <span className="text-xs text-ink-faint" data-testid="preset-count">
          {config.presets.length} presets. Only the text colour is painted so far; background and
          bold are stored and kept for a later release.
        </span>
      </div>

      {note && (
        <p className="text-xs text-warn" data-testid="preset-note">
          {note}
        </p>
      )}

      {config.presets.length === 0 ? (
        <p className="text-xs text-ink-muted">
          No presets yet. A preset is a name for a colour, so a dozen rules can share one and
          change together.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto" data-testid="preset-list">
          {config.presets.map((preset) => {
            const users = highlightsUsingPreset(preset.id, config.highlights)
            const hex = asHexColour(preset.fg)
            return (
              <li
                key={preset.id}
                data-testid={`preset-row-${preset.id}`}
                className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1"
              >
                <input
                  aria-label="Preset name"
                  value={preset.name}
                  onChange={(e) => patch(preset.id, { name: e.target.value })}
                  data-testid={`preset-name-${preset.id}`}
                  className="w-28 rounded border border-border bg-transparent px-1 text-xs"
                />
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <span>Text</span>
                  {hex ? (
                    <input
                      type="color"
                      value={hex}
                      onChange={(e) => patch(preset.id, { fg: e.target.value })}
                      data-testid={`preset-fg-${preset.id}`}
                      className="h-5 w-8 rounded border border-border bg-transparent"
                    />
                  ) : (
                    <input
                      value={preset.fg}
                      onChange={(e) => patch(preset.id, { fg: e.target.value })}
                      data-testid={`preset-fg-${preset.id}`}
                      className="w-20 rounded border border-border bg-transparent px-1 text-xs"
                    />
                  )}
                </label>
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={preset.bold}
                    onChange={(e) => patch(preset.id, { bold: e.target.checked })}
                    data-testid={`preset-bold-${preset.id}`}
                  />
                  <span>Bold</span>
                </label>
                <span
                  className="rounded px-1 text-xs"
                  style={{
                    color: preset.fg,
                    ...(preset.bg ? { backgroundColor: preset.bg } : {}),
                    ...(preset.bold ? { fontWeight: 700 } : {}),
                  }}
                  data-testid={`preset-swatch-${preset.id}`}
                >
                  sample
                </span>
                <span className="text-xs text-ink-faint">
                  {users.length} {users.length === 1 ? 'rule' : 'rules'}
                </span>
                <button
                  type="button"
                  onClick={() => deletePreset(preset)}
                  data-testid={`preset-delete-${preset.id}`}
                  className="ml-auto rounded border border-border px-1 text-xs text-ink-muted hover:text-ink"
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
