/**
 * The Variables tab: `$name` values an alias or a macro can use.
 *
 * `$shop`, `$patient`, `$preposition` - the tokens the real aliases already
 * write. `docs/PLAYER_CONFIG.md` §4.3 is why they are `$name` and not
 * `%name%`: importing 356 aliases and then not resolving the tokens they
 * contain produces a config that looks imported and does not work.
 *
 * # Reserved names, shown rather than silently missing
 *
 * A real `variables.cfg` is mostly Genie's own bookkeeping - `roomid`,
 * `downid` and the whole `Time.*` block, written by Genie while it plays. 12
 * of the 46 in the config measured for Q1 are these, and the import counts and
 * names them rather than copying them in: a stale room id in a player's
 * variable table would let an alias resolve `$roomid` to somewhere they were
 * last May. This app does not maintain them, so they are listed here as
 * reserved and creating one is refused by name - which is the difference
 * between a player knowing those 12 are not supported and a player wondering
 * where they went.
 */
import { useState } from 'react'
import {
  addEntry,
  isBookkeepingVariable,
  newId,
  removeEntry,
  RESERVED_VARIABLE_NAMES,
  updateEntry,
  usePlayerConfig,
  type VariableRule,
} from '../../lib/playerConfig.ts'

export function VariablesTab() {
  const config = usePlayerConfig()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [problem, setProblem] = useState('')

  const add = () => {
    const trimmed = name.trim().replace(/^\$/, '')
    if (!trimmed) {
      setProblem('A variable needs a name.')
      return
    }
    if (isBookkeepingVariable(trimmed)) {
      setProblem(
        `$${trimmed} is one of Genie's own names. This app does not keep it up to date, so ` +
          'it cannot be set here.'
      )
      return
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed)) {
      setProblem(
        `$${trimmed} cannot be used in an alias: a name starts with a letter and holds ` +
          'letters, digits, underscores and dots.'
      )
      return
    }
    if (config.variables.some((v) => v.name === trimmed)) {
      setProblem(`You already have a variable called $${trimmed}.`)
      return
    }
    const rule: VariableRule = {
      id: newId('variables'),
      enabled: true,
      source: 'player',
      name: trimmed,
      value,
    }
    const write = addEntry('variables', rule)
    setProblem(write.ok ? '' : `Could not save: ${write.message}`)
    if (write.ok) {
      setName('')
      setValue('')
    }
  }

  return (
    <div data-testid="variables-tab" className="flex flex-col gap-2">
      <p className="text-xs text-ink-muted">
        An alias or a macro can write <code>$name</code> and get the value below.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-muted">
          <span className="mr-1">Name</span>
          <input
            data-testid="variable-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-28 rounded border border-border bg-surface px-1 py-0.5 text-ink"
          />
        </label>
        <label className="flex-1 text-xs text-ink-muted">
          <span className="mr-1">Value</span>
          <input
            data-testid="variable-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full min-w-40 rounded border border-border bg-surface px-1 py-0.5 text-ink"
          />
        </label>
        <button
          type="button"
          data-testid="variable-add"
          onClick={add}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
        >
          Add variable
        </button>
      </div>

      {problem && (
        <p className="text-xs text-warn" data-testid="variable-problem">
          {problem}
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="variable-list">
        {config.variables.map((rule) => (
          <li
            key={rule.id}
            data-testid={`variable-row-${rule.name}`}
            className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1"
          >
            <input
              type="checkbox"
              aria-label={`Use $${rule.name}`}
              data-testid={`variable-enabled-${rule.name}`}
              checked={rule.enabled}
              onChange={(e) => updateEntry('variables', rule.id, { enabled: e.target.checked })}
            />
            <code className="text-ink">${rule.name}</code>
            <input
              aria-label={`Value of $${rule.name}`}
              data-testid={`variable-text-${rule.name}`}
              value={rule.value}
              onChange={(e) => updateEntry('variables', rule.id, { value: e.target.value })}
              className="min-w-40 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-ink"
            />
            {rule.source === 'genie-import' && (
              <span className="text-xs text-ink-faint">from Genie</span>
            )}
            <button
              type="button"
              data-testid={`variable-remove-${rule.name}`}
              onClick={() => removeEntry('variables', rule.id)}
              className="rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="rounded border border-border p-2" data-testid="variable-reserved">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Names this app does not support
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          Genie writes these itself while it plays, so they are not imported and cannot be set
          here: {RESERVED_VARIABLE_NAMES.map((n) => `$${n}`).join(', ')}. A real config had 12 of
          them. Nothing is hidden: they are left out because this app does not keep them up to
          date, and a stale value would be worse than none.
        </p>
      </div>
    </div>
  )
}
