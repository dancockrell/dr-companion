/**
 * What these rules would do to real game text.
 *
 * # It calls the resolver, it does not imitate it
 *
 * Every line below goes through `applyLineRules` - the same function
 * `useGameLines()` calls, with the same arguments. A preview that matched
 * with its own `indexOf` would agree with the game pane on the day it was
 * written and drift the first time either side changed, and the player would
 * have no way to tell which of the two was lying to them.
 * `tools/line-rules-test.mjs` greps this file and the two tabs for a matcher
 * of their own and requires zero, so the property is a build failure rather
 * than a promise in this comment.
 *
 * # Raw lines, deliberately
 *
 * `useRawGameLines()` rather than `useGameLines()`, because the sanctioned
 * hook now returns the *after* and this pane needs the before. It is the same
 * subscribed read; the rules are simply not applied to it yet.
 *
 * With nothing in the buffer - which is every first run, and every session
 * before the player attaches - it previews against a short sample instead of
 * showing an empty box. An empty preview and a preview where nothing matched
 * look identical, and the first is the one that makes a player think the
 * editor is broken.
 */
import { useMemo } from 'react'
import { applyLineRules, type LineRuleSet } from '../../lib/lineRules.ts'
import { useRawGameLines } from '../../lib/useGameLines.ts'

/** How far back the preview looks. The design's number. */
const WINDOW = 200

/**
 * Stand-in text for a client that has not attached yet.
 *
 * Real DragonRealms output in shape, so a rule written against the sample
 * behaves the same way against the game.
 */
const SAMPLE = [
  'A Gor’Tog guard just arrived.',
  'You feel fully rested.',
  'Your mind is clear.',
  'A kobold guard swings a scimitar at you!',
  'You sense a change in the weather.',
  'The Gor’Tog guard leaves north.',
]

export function LineRulePreview({ rules, label }: { rules: LineRuleSet; label: string }) {
  const raw = useRawGameLines()
  const usingSample = raw.length === 0
  const source = useMemo(
    () => (usingSample ? SAMPLE : raw.slice(-WINDOW).map((l) => l.text)),
    [raw, usingSample]
  )

  const rows = useMemo(
    () =>
      source.map((text, i) => ({ key: i, before: text, ...applyLineRules(text, rules) })),
    [source, rules]
  )
  const changed = rows.filter((r) => r.matched.length > 0)

  return (
    <div className="rounded border border-border p-2" data-testid="line-rule-preview">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Preview</h3>
      <p className="mt-1 text-xs text-ink-muted">
        {usingSample
          ? `No game text yet, so this is a sample. ${changed.length} of ${source.length} sample lines would change.`
          : `${changed.length} of the last ${source.length} game lines would change.`}{' '}
        {label}
      </p>
      {changed.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">
          Nothing here matches. That is the rules saying nothing, not the preview being empty.
        </p>
      ) : (
        <ul className="mt-2 space-y-1" data-testid="line-rule-preview-rows">
          {changed.map((row) => (
            <li key={row.key} className="font-mono text-xs leading-snug">
              <div className="text-ink-faint line-through">{row.before}</div>
              <div className={row.gagged ? 'text-warn' : 'text-ink'}>
                {row.gagged ? '(hidden)' : row.text}
                <span className="ml-2 font-sans text-ink-faint">
                  {row.matched.length} rule{row.matched.length === 1 ? '' : 's'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
