/**
 * Gags: lines hidden from the game pane.
 *
 * Hidden, not deleted. The line stays in the buffer, the transcript and the
 * bug bundle, and the game pane's "Show hidden" switch puts it back on screen
 * without changing a rule. That is the whole reason the rewrite happens on
 * read - see `lib/lineRules.ts` - and it is what makes a gag safe to
 * experiment with.
 *
 * No matcher of its own, for the reason `SubstitutesTab.tsx` gives.
 */
import { useState } from 'react'
import {
  addEntry,
  newId,
  removeEntry,
  updateEntry,
  usePlayerConfig,
  type GagRule,
} from '../../lib/playerConfig.ts'
import { ruleRefusal } from '../../lib/lineRules.ts'
import { setShowGaggedLines, useShowGaggedLines } from '../../lib/useGameLines.ts'
import { LineRulePreview } from './LineRulePreview.tsx'

export function GagsTab() {
  const config = usePlayerConfig()
  const showGagged = useShowGaggedLines()
  const [pattern, setPattern] = useState('')
  const [regex, setRegex] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const add = () => {
    const why = ruleRefusal(pattern, regex)
    if (why) {
      setRefused(why)
      return
    }
    setRefused(null)
    const rule: GagRule = {
      id: newId('gags'),
      enabled: true,
      source: 'player',
      pattern,
      ...(regex ? { regex: true } : {}),
    }
    const write = addEntry('gags', rule)
    if (!write.ok) {
      setRefused(write.message)
      return
    }
    setPattern('')
  }

  return (
    <div className="flex flex-col gap-2">
      {/* No heading sentence: the panel prints `TAB_PLACEHOLDER` above every
        * tab, and a second copy of it here would be the same claim in two
        * places, free to drift. */}
      <div className="flex flex-wrap items-end gap-2" data-testid="gag-add">
        <label className="flex flex-col text-xs text-ink-faint">
          Hide lines containing
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            data-testid="gag-pattern"
            className="w-64 rounded border border-border bg-surface px-1 py-0.5 text-xs text-ink"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={regex}
            onChange={(e) => setRegex(e.target.checked)}
            data-testid="gag-regex"
          />
          Regex
        </label>
        <button
          type="button"
          onClick={add}
          disabled={!pattern}
          data-testid="gag-add-button"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {refused && (
        <p className="text-xs text-warn" data-testid="gag-refused">
          Not saved: {refused}
        </p>
      )}

      <label className="flex items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={showGagged}
          onChange={(e) => setShowGaggedLines(e.target.checked)}
          data-testid="gag-show-hidden"
        />
        Show hidden lines in the game pane, marked
      </label>

      <ul className="flex flex-col gap-1" data-testid="gag-list">
        {config.gags.map((rule) => (
          <li
            key={rule.id}
            className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 text-xs"
            data-testid={`gag-row-${rule.id}`}
          >
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => updateEntry('gags', rule.id, { enabled: e.target.checked })}
              aria-label={`Use this gag for ${rule.pattern}`}
            />
            <code className="text-ink">{rule.pattern}</code>
            {rule.regex && <span className="text-ink-faint">regex</span>}
            {rule.source === 'genie-import' && <span className="text-ink-faint">imported</span>}
            <button
              type="button"
              onClick={() => removeEntry('gags', rule.id)}
              data-testid={`gag-delete-${rule.id}`}
              className="ml-auto rounded border border-border px-1 text-ink-muted hover:text-ink"
            >
              Delete
            </button>
          </li>
        ))}
        {config.gags.length === 0 && <li className="text-xs text-ink-faint">No gags yet.</li>}
      </ul>

      <LineRulePreview
        rules={{ substitutes: config.substitutes, gags: config.gags }}
        label="Substitutes run first, so a gag matches the text you would have read."
      />

      <p className="text-xs text-ink-faint">
        Imported from Genie as <code>#gag {'{pattern}'}</code>. That format is inferred from the
        way every other Genie directive is written, not read from a populated file: the{' '}
        <code>gags.cfg</code> this was built against was empty. If yours parses wrongly, that is
        the reason.
      </p>
    </div>
  )
}
