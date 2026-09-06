/**
 * Substitutes: text rewritten before a line is shown.
 *
 * The rewrite is a display rule. The raw transcript keeps the original, which
 * is why the preview can show both sides of it and why the bug bundle is
 * still the game's own words. See `lib/lineRules.ts`.
 *
 * No matcher of its own: the preview calls `applyLineRules` and the save
 * button calls `ruleRefusal`, both from `lineRules.ts`, so what this pane
 * shows and what the game pane does cannot come apart.
 */
import { useState } from 'react'
import {
  addEntry,
  newId,
  removeEntry,
  updateEntry,
  usePlayerConfig,
  type SubstituteRule,
} from '../../lib/playerConfig.ts'
import { ruleRefusal } from '../../lib/lineRules.ts'
import { LineRulePreview } from './LineRulePreview.tsx'

export function SubstitutesTab() {
  const config = usePlayerConfig()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [regex, setRegex] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  const add = () => {
    const why = ruleRefusal(find, regex)
    if (why) {
      // Refused here, so it never reaches the store and never reaches the
      // render path. A pattern that cannot run is not saved and then quietly
      // skipped forever; the player is told now, while they are looking at it.
      setRefused(why)
      return
    }
    setRefused(null)
    const rule: SubstituteRule = {
      id: newId('substitutes'),
      enabled: true,
      source: 'player',
      find,
      replace,
      ...(regex ? { regex: true } : {}),
    }
    const write = addEntry('substitutes', rule)
    if (!write.ok) {
      setRefused(write.message)
      return
    }
    setFind('')
    setReplace('')
  }

  return (
    <div className="flex flex-col gap-2">
      {/* No heading sentence here: the panel prints `TAB_PLACEHOLDER` above
        * every tab, and a second copy of it inside would be the same claim in
        * two places, free to drift. */}
      <div className="flex flex-wrap items-end gap-2" data-testid="substitute-add">
        <label className="flex flex-col text-xs text-ink-faint">
          Find
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            data-testid="substitute-find"
            className="w-48 rounded border border-border bg-surface px-1 py-0.5 text-xs text-ink"
          />
        </label>
        <label className="flex flex-col text-xs text-ink-faint">
          Show instead
          <input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            data-testid="substitute-replace"
            className="w-48 rounded border border-border bg-surface px-1 py-0.5 text-xs text-ink"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={regex}
            onChange={(e) => setRegex(e.target.checked)}
            data-testid="substitute-regex"
          />
          Regex
        </label>
        <button
          type="button"
          onClick={add}
          disabled={!find}
          data-testid="substitute-add-button"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {refused && (
        <p className="text-xs text-warn" data-testid="substitute-refused">
          Not saved: {refused}
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="substitute-list">
        {config.substitutes.map((rule) => (
          <li
            key={rule.id}
            className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 text-xs"
            data-testid={`substitute-row-${rule.id}`}
          >
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => updateEntry('substitutes', rule.id, { enabled: e.target.checked })}
              aria-label={`Use this substitute for ${rule.find}`}
            />
            <code className="text-ink">{rule.find}</code>
            <span className="text-ink-faint">shows as</span>
            <code className="text-ink">{rule.replace || '(nothing)'}</code>
            {rule.regex && <span className="text-ink-faint">regex</span>}
            {rule.source === 'genie-import' && <span className="text-ink-faint">imported</span>}
            <button
              type="button"
              onClick={() => removeEntry('substitutes', rule.id)}
              data-testid={`substitute-delete-${rule.id}`}
              className="ml-auto rounded border border-border px-1 text-ink-muted hover:text-ink"
            >
              Delete
            </button>
          </li>
        ))}
        {config.substitutes.length === 0 && (
          <li className="text-xs text-ink-faint">No substitutes yet.</li>
        )}
      </ul>

      <LineRulePreview
        rules={{ substitutes: config.substitutes, gags: [] }}
        label="Gags are previewed on their own tab."
      />

      <p className="text-xs text-ink-faint">
        Imported from Genie as <code>#substitute {'{find} {replace}'}</code>. That format is
        inferred from the way every other Genie directive is written, not read from a populated
        file: the <code>substitutes.cfg</code> this was built against was empty. If yours parses
        wrongly, that is the reason, and it is worth reporting.
      </p>
    </div>
  )
}
