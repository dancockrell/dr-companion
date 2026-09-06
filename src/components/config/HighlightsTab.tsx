/**
 * The player's highlight rules, and a preview that is the game pane.
 *
 * # Why there is no matching code in this file
 *
 * A preview that runs its own matcher is a second answer to "does this rule
 * fire", and the two will disagree - a `beginswith` that trims leading
 * whitespace here and not there, a first-wins ordering implemented twice.
 * Then the player tunes a rule against a preview that is lying to them.
 *
 * So the preview calls `paint()` and renders through `HighlightedText`, the
 * same two functions `GameLineRow` uses, over lines it takes from
 * `useGameLines()` - and `tools/highlight-test.mjs` greps this file for the
 * two matching primitives a hand-rolled matcher would need and requires zero
 * of each, with a positive control on `highlights.ts` so a zero here is a
 * fact about this file rather than about the grep. That check is what keeps
 * it this way; this paragraph only says why. (The needles themselves are
 * deliberately not written out here, since prose counts too.)
 *
 * # Why an invalid pattern is refused here rather than reported later
 *
 * `resolveHighlights` already refuses one and says why, so a bad rule cannot
 * reach `paint()` through the store. That is the backstop. This is the gate:
 * `compilePattern` is called before every write, so an unclosed group or a
 * pattern that backtracks exponentially never lands in localStorage at all,
 * and the player is told at the moment they typed it instead of finding a
 * rule quietly absent from a refusal list.
 *
 * One gate, on one function: `commit()` below is the only path from this
 * component to `updateEntry`, so a field that changes what the pattern means
 * (the type, not only the pattern text) is checked too.
 */
import { useState } from 'react'
import {
  addEntry,
  newId,
  removeEntry,
  updateEntry,
  usePlayerConfig,
  type HighlightRule,
} from '../../lib/playerConfig.ts'
import {
  DEFAULT_HIGHLIGHT_COLOUR,
  HIGHLIGHT_PREVIEW_LINES,
  HIGHLIGHT_PREVIEW_SAMPLE,
  asHexColour,
  compilePattern,
  paint,
  type HighlightType,
} from '../../lib/highlights.ts'
import { useHighlights } from '../../lib/useHighlights.ts'
import { useGameLines } from '../../lib/useGameLines.ts'
import { useOffClasses } from '../../lib/offClasses.ts'
import { HighlightedText } from '../room/HighlightedText.tsx'

const TYPES: readonly HighlightType[] = ['line', 'string', 'beginswith', 'regexp']

const TYPE_HELP: Record<HighlightType, string> = {
  line: 'colours the whole line when the text appears in it',
  string: 'colours only the matched text',
  beginswith: 'colours the whole line when it starts with the text',
  regexp: 'a regular expression; the whole line is coloured',
}

export function HighlightsTab() {
  const config = usePlayerConfig()
  // The runtime's own view, not a second resolve: this is the function the
  // game pane's hook returns, so a rule that is not painted here is not
  // painted there either.
  const { highlights, note } = useHighlights()
  const off = useOffClasses()
  const lines = useGameLines()

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState('')
  const [addType, setAddType] = useState<HighlightType>('line')
  const [addError, setAddError] = useState<string | null>(null)

  const setError = (id: string, why: string | null) =>
    setErrors((prev) => {
      const next = { ...prev }
      if (why) next[id] = why
      else delete next[id]
      return next
    })

  /** The only path from this component to the store. */
  const commit = (rule: HighlightRule, fields: Partial<HighlightRule>) => {
    const next = { ...rule, ...fields }
    const check = compilePattern(next.type, next.pattern)
    if (!check.ok) {
      setError(rule.id, check.why)
      return
    }
    const write = updateEntry('highlights', rule.id, fields)
    setError(rule.id, write.ok ? null : `Could not save: ${write.message}`)
  }

  const add = () => {
    const pattern = adding.trim()
    const check = compilePattern(addType, pattern)
    if (!check.ok) {
      setAddError(check.why)
      return
    }
    const entry: HighlightRule = {
      id: newId('highlights'),
      enabled: true,
      source: 'player',
      type: addType,
      pattern,
      colour: DEFAULT_HIGHLIGHT_COLOUR,
    }
    const write = addEntry('highlights', entry)
    setAddError(write.ok ? null : `Could not save: ${write.message}`)
    if (write.ok) setAdding('')
  }

  const previewLines = lines.length
    ? lines.slice(-HIGHLIGHT_PREVIEW_LINES).map((l) => l.text)
    : [...HIGHLIGHT_PREVIEW_SAMPLE]
  // The denominator. A preview handed no lines and a rule that matches nothing
  // look identical on screen, so the count of what was searched is printed
  // beside the count of what matched.
  const hits = previewLines.filter((text) => {
    const painted = paint(text, highlights, off)
    return painted.lineColour !== undefined || painted.spans.length > 0
  }).length

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="highlights-tab">
      <div className="flex flex-wrap items-center gap-1">
        <select
          aria-label="New rule type"
          value={addType}
          onChange={(e) => setAddType(e.target.value as HighlightType)}
          data-testid="highlight-add-type"
          className="rounded border border-border bg-transparent px-1 py-1 text-xs"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          aria-label="New rule pattern"
          value={adding}
          placeholder="text to look for"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          data-testid="highlight-add-pattern"
          className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 py-1 text-xs"
        />
        <button
          type="button"
          onClick={add}
          data-testid="highlight-add"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
        >
          Add rule
        </button>
      </div>
      <p className="text-xs text-ink-faint">{TYPE_HELP[addType]}</p>
      {addError && (
        <p className="text-xs text-warn" data-testid="highlight-add-error">
          {addError}
        </p>
      )}

      <p className="text-xs text-ink-faint" data-testid="highlight-note">
        {note}
      </p>

      {config.highlights.length === 0 ? (
        <p className="text-xs text-ink-muted">
          No rules yet. Add one above and the preview below will show it on the last lines the
          game sent.
        </p>
      ) : (
        <ul
          className="flex max-h-40 min-h-0 flex-col gap-1 overflow-y-auto"
          data-testid="highlight-list"
        >
          {config.highlights.map((rule) => {
            const hex = asHexColour(rule.colour ?? '')
            const draft = drafts[rule.id] ?? rule.pattern
            return (
              <li
                key={rule.id}
                data-testid={`highlight-row-${rule.id}`}
                className="flex flex-wrap items-center gap-1 rounded border border-border px-1 py-1"
              >
                <input
                  type="checkbox"
                  aria-label="Rule on"
                  checked={rule.enabled}
                  onChange={(e) => commit(rule, { enabled: e.target.checked })}
                  data-testid={`highlight-enabled-${rule.id}`}
                />
                <select
                  aria-label="Rule type"
                  value={rule.type}
                  onChange={(e) => commit(rule, { type: e.target.value as HighlightType })}
                  data-testid={`highlight-type-${rule.id}`}
                  className="rounded border border-border bg-transparent px-1 text-xs"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Pattern"
                  value={draft}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [rule.id]: e.target.value }))
                  }
                  onBlur={() => commit(rule, { pattern: draft })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(rule, { pattern: draft })
                  }}
                  data-testid={`highlight-pattern-${rule.id}`}
                  className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 text-xs"
                />
                <select
                  aria-label="Style"
                  value={rule.presetId ?? ''}
                  onChange={(e) =>
                    commit(
                      rule,
                      e.target.value
                        ? { presetId: e.target.value, colour: undefined }
                        : { presetId: undefined, colour: rule.colour ?? DEFAULT_HIGHLIGHT_COLOUR }
                    )
                  }
                  data-testid={`highlight-preset-${rule.id}`}
                  className="rounded border border-border bg-transparent px-1 text-xs"
                >
                  <option value="">its own colour</option>
                  {config.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!rule.presetId &&
                  (hex ? (
                    <input
                      type="color"
                      aria-label="Colour"
                      value={hex}
                      onChange={(e) => commit(rule, { colour: e.target.value })}
                      data-testid={`highlight-colour-${rule.id}`}
                      className="h-5 w-8 rounded border border-border bg-transparent"
                    />
                  ) : (
                    <input
                      aria-label="Colour"
                      value={rule.colour ?? ''}
                      onChange={(e) => commit(rule, { colour: e.target.value })}
                      data-testid={`highlight-colour-${rule.id}`}
                      className="w-20 rounded border border-border bg-transparent px-1 text-xs"
                    />
                  ))}
                <input
                  aria-label="Sound file"
                  value={rule.sound ?? ''}
                  placeholder="sound"
                  onChange={(e) => commit(rule, { sound: e.target.value || undefined })}
                  data-testid={`highlight-sound-${rule.id}`}
                  className="w-20 rounded border border-border bg-transparent px-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeEntry('highlights', rule.id)}
                  data-testid={`highlight-delete-${rule.id}`}
                  className="rounded border border-border px-1 text-xs text-ink-muted hover:text-ink"
                >
                  Delete
                </button>
                {errors[rule.id] && (
                  <p
                    className="w-full text-xs text-warn"
                    data-testid={`highlight-error-${rule.id}`}
                  >
                    {errors[rule.id]}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="min-h-0 rounded border border-border p-1" data-testid="highlight-preview">
        <p className="text-xs text-ink-faint" data-testid="highlight-preview-count">
          Preview: {hits} of {previewLines.length} lines matched
          {lines.length ? ' from the game' : ' from a sample, because nothing is attached'}.
        </p>
        <div className="mt-1 max-h-32 overflow-y-auto font-mono text-xs">
          {previewLines.map((text, i) => (
            <div key={i} data-testid="highlight-preview-line">
              <HighlightedText text={text} highlights={highlights} offClasses={off} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
