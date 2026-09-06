/**
 * The Aliases tab: short words that expand into commands.
 *
 * The editor half of `aliases.ts`. It writes `AliasRule`s into the one store
 * and changes nothing about how a typed line expands - `expandAlias` is the
 * same function `GameCommandBar` calls, and this screen only decides what it
 * reads.
 *
 * # Why a rule can be visible and refused
 *
 * 87 of the 356 aliases in the real config measured for Q1 contain Genie
 * script - `#queue`, `#setvar`, a `\x` escape - and import switched off with
 * their text intact. Switching one on would send `#queue {...}` to
 * DragonRealms as literal text. So the toggle is refused for those, in words,
 * beside the rule: a player can see exactly what Genie had and why this app
 * will not run it, which is more use than either hiding the rule or letting it
 * fire.
 *
 * The refusal is `aliasEnableRefusal`, the same answer `resolveAliases` gives,
 * so the screen and the runtime cannot disagree about which rules run.
 */
import { useState } from 'react'
import { aliasEnableRefusal, resolveVariables } from '../../lib/aliases.ts'
import {
  addEntry,
  newId,
  removeEntry,
  updateEntry,
  usePlayerConfig,
  type AliasRule,
} from '../../lib/playerConfig.ts'

/** `$name` tokens in an expansion that no enabled variable answers. */
function unknownVariablesIn(expansion: string, known: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const m of expansion.matchAll(/\$([A-Za-z_][A-Za-z0-9_.]*)/g)) {
    if (!known.has(m[1]) && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

export function AliasesTab() {
  const config = usePlayerConfig()
  const { variables } = resolveVariables(config)
  const known = new Set(variables.keys())
  const [name, setName] = useState('')
  const [expansion, setExpansion] = useState('')
  const [problem, setProblem] = useState('')

  const add = () => {
    const trimmedName = name.trim()
    const trimmedExpansion = expansion.trim()
    if (!trimmedName || !trimmedExpansion) {
      setProblem('An alias needs a name and something to expand into.')
      return
    }
    if (config.aliases.some((a) => a.name.toLowerCase() === trimmedName.toLowerCase())) {
      setProblem(`You already have an alias called ${trimmedName}.`)
      return
    }
    const rule: AliasRule = {
      id: newId('aliases'),
      // A scripted expansion is stored switched off for the same reason the
      // import stores one that way, rather than being refused outright: the
      // text is the player's and is worth keeping where they can see it.
      enabled:
        aliasEnableRefusal({ name: trimmedName, expansion: trimmedExpansion }, { variables }) ===
        null,
      source: 'player',
      name: trimmedName,
      expansion: trimmedExpansion,
    }
    const write = addEntry('aliases', rule)
    setProblem(write.ok ? '' : `Could not save: ${write.message}`)
    if (write.ok) {
      setName('')
      setExpansion('')
    }
  }

  return (
    <div data-testid="aliases-tab" className="flex flex-col gap-2">
      <p className="text-xs text-ink-muted">
        Type the name and the rest of the line becomes <code>$0</code>, each word{' '}
        <code>$1</code>, <code>$2</code> and so on. A <code>$name</code> is a variable from the
        Variables tab. Several commands can be joined with a semicolon.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-muted">
          <span className="mr-1">Name</span>
          <input
            data-testid="alias-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-28 rounded border border-border bg-surface px-1 py-0.5 text-ink"
          />
        </label>
        <label className="flex-1 text-xs text-ink-muted">
          <span className="mr-1">Expands to</span>
          <input
            data-testid="alias-expansion"
            value={expansion}
            onChange={(e) => setExpansion(e.target.value)}
            className="w-full min-w-40 rounded border border-border bg-surface px-1 py-0.5 text-ink"
          />
        </label>
        <button
          type="button"
          data-testid="alias-add"
          onClick={add}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
        >
          Add alias
        </button>
      </div>

      {problem && (
        <p className="text-xs text-warn" data-testid="alias-problem">
          {problem}
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="alias-list">
        {config.aliases.map((rule) => {
          const refusal = aliasEnableRefusal(rule, { variables })
          const missing = unknownVariablesIn(rule.expansion, known)
          return (
            <li
              key={rule.id}
              data-testid={`alias-row-${rule.name}`}
              className="rounded border border-border px-2 py-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Switch on ${rule.name}`}
                  data-testid={`alias-enabled-${rule.name}`}
                  checked={rule.enabled && refusal === null}
                  disabled={refusal !== null}
                  onChange={(e) => updateEntry('aliases', rule.id, { enabled: e.target.checked })}
                />
                <code className="text-ink">{rule.name}</code>
                <input
                  aria-label={`What ${rule.name} expands to`}
                  data-testid={`alias-text-${rule.name}`}
                  value={rule.expansion}
                  onChange={(e) => updateEntry('aliases', rule.id, { expansion: e.target.value })}
                  className="min-w-40 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-ink"
                />
                {rule.source === 'genie-import' && (
                  <span className="text-xs text-ink-faint">from Genie</span>
                )}
                <button
                  type="button"
                  data-testid={`alias-remove-${rule.name}`}
                  onClick={() => removeEntry('aliases', rule.id)}
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
                >
                  Remove
                </button>
              </div>
              {refusal && (
                <p className="mt-1 text-xs text-warn" data-testid={`alias-refused-${rule.name}`}>
                  {refusal}
                </p>
              )}
              {missing.length > 0 && (
                <p className="mt-1 text-xs text-warn" data-testid={`alias-unknown-${rule.name}`}>
                  No variable {missing.map((v) => `$${v}`).join(', ')}. It will be sent as typed.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
