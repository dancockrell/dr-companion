/**
 * The Macros tab: a key chord that sends a list of commands.
 *
 * The gap this closes is the one `docs/PLAYER_CONFIG.md` §2 records as **Key
 * macros — Gone**: `keybindings.ts` ships `MOVEMENT` and `F_KEYS` hardcoded
 * and a player has had no way to bind anything of their own since PR #456.
 *
 * # The dry run
 *
 * A macro is a list of commands aimed at a live character. Trying one to see
 * what it does is not a free action: the wrong list, pressed while standing in
 * a bank, is a real thing that happens to a real character. So the button
 * beside every macro shows exactly what the outbound lane would receive, in
 * order, after aliases and variables have been resolved, and sends nothing.
 *
 * It is the *same* function as the real fire (`runMacroCommands`), called with
 * `dryRun`, rather than a preview that assembles the list a second way - a
 * preview computing its own answer would be showing the player a second
 * implementation's opinion of what the first would do. The `send` handed to it
 * throws, so a dry run that ever reached the send path would fail loudly here
 * rather than quietly putting a command on the wire.
 *
 * Since #485 the plan carries `planRefusals` beside it, so what is shown is
 * what the outbound lane would *accept*. Same code path, one step longer: the
 * real fire ends at `requestGameAction` → `validateGameActionCommand`, which
 * refuses `;` and control characters, and a variable is expanded before that
 * happens. `$shop = "bank;withdraw 5000 coins"` planned as one command and was
 * thrown away by the lane, and this listed it as though it would go.
 *
 * # The chord
 *
 * Captured with `chordOf`, the same translation `resolveKeybinding` uses, so
 * the editor cannot store a chord under a name the resolver will never
 * produce. `builtinForChord` says what the key already does, because a player
 * binding NumPad8 should be told they are overriding "walk north" rather than
 * discovering it. Their binding wins; the built-in stays for every chord they
 * have not bound.
 */
import { useState } from 'react'
import { expandAlias, resolveAliases, resolveVariables } from '../../lib/aliases.ts'
import {
  builtinForChord,
  chordLabel,
  chordOf,
  macroEnableRefusal,
  runMacroCommands,
} from '../../lib/keybindings.ts'
import {
  addEntry,
  newId,
  removeEntry,
  updateEntry,
  usePlayerConfig,
  type MacroRule,
} from '../../lib/playerConfig.ts'

export function MacrosTab() {
  const config = usePlayerConfig()
  const [chord, setChord] = useState<{ key: string; modifiers: Array<'Shift' | 'Control' | 'Alt'> } | null>(
    null
  )
  const [capturing, setCapturing] = useState(false)
  const [commands, setCommands] = useState('')
  const [problem, setProblem] = useState('')
  const [plan, setPlan] = useState<{
    id: string
    commands: string[]
    refusals: Array<string | null>
  } | null>(null)

  const { entries: aliases } = resolveAliases(config)
  const { variables } = resolveVariables(config)
  const expand = (command: string) => expandAlias(command, aliases, { variables }).text

  const capture = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!capturing) return
    e.preventDefault()
    const got = chordOf(e)
    if (!got) {
      setProblem('That key cannot be bound. Try an F key, a NumPad key, a letter or a digit.')
      return
    }
    setChord(got)
    setCapturing(false)
    setProblem('')
  }

  const add = () => {
    if (!chord) {
      setProblem('Press the key you want to bind first.')
      return
    }
    const list = commands
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean)
    if (list.length === 0) {
      setProblem('A macro needs at least one command.')
      return
    }
    const label = chordLabel(chord.key, chord.modifiers)
    if (config.macros.some((m) => chordLabel(m.key, m.modifiers) === label)) {
      setProblem(`${label} is already bound. Change that macro instead of adding a second one.`)
      return
    }
    const rule: MacroRule = {
      id: newId('macros'),
      enabled: macroEnableRefusal({ key: chord.key, commands: list }, { variables }) === null,
      source: 'player',
      key: chord.key,
      modifiers: chord.modifiers,
      commands: list,
    }
    const write = addEntry('macros', rule)
    setProblem(write.ok ? '' : `Could not save: ${write.message}`)
    if (write.ok) {
      setChord(null)
      setCommands('')
    }
  }

  const dryRun = (rule: MacroRule) => {
    const result = runMacroCommands(rule.commands, {
      expand,
      variables,
      dryRun: true,
      // Reached only if the dry run ever stopped being one. Loud on purpose:
      // a dry run that sent a command quietly is the one failure this whole
      // feature must not have.
      send: () => {
        throw new Error('a dry run must not send anything')
      },
    })
    setPlan({ id: rule.id, commands: result.plan, refusals: result.planRefusals })
  }

  const pendingLabel = chord ? chordLabel(chord.key, chord.modifiers) : null
  const pendingBuiltin = chord ? builtinForChord(chord.key, chord.modifiers) : null

  return (
    <div data-testid="macros-tab" className="flex flex-col gap-2">
      <p className="text-xs text-ink-muted">
        Press a key, list the commands one per line, and the key sends them in order. A dry run
        shows what would be sent and sends nothing.
      </p>

      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          data-testid="macro-capture"
          onClick={() => setCapturing(true)}
          onKeyDown={capture}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
        >
          {capturing ? 'Press a key' : (pendingLabel ?? 'Press a key')}
        </button>
        <label className="flex-1 text-xs text-ink-muted">
          <span className="mr-1">Commands, one per line</span>
          <textarea
            data-testid="macro-commands"
            rows={3}
            value={commands}
            onChange={(e) => setCommands(e.target.value)}
            className="w-full min-w-40 rounded border border-border bg-surface px-1 py-0.5 text-ink"
          />
        </label>
        <button
          type="button"
          data-testid="macro-add"
          onClick={add}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-overlay"
        >
          Add macro
        </button>
      </div>

      {pendingBuiltin && (
        <p className="text-xs text-ink-muted" data-testid="macro-pending-conflict">
          {pendingLabel} already does {pendingBuiltin}. Your macro will win on that key.
        </p>
      )}

      {problem && (
        <p className="text-xs text-warn" data-testid="macro-problem">
          {problem}
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="macro-list">
        {config.macros.map((rule) => {
          const label = chordLabel(rule.key, rule.modifiers)
          const refusal = macroEnableRefusal(rule, { variables })
          const builtin = builtinForChord(rule.key, rule.modifiers)
          return (
            <li
              key={rule.id}
              data-testid={`macro-row-${label}`}
              className="rounded border border-border px-2 py-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Switch on ${label}`}
                  data-testid={`macro-enabled-${label}`}
                  checked={rule.enabled && refusal === null}
                  disabled={refusal !== null}
                  onChange={(e) => updateEntry('macros', rule.id, { enabled: e.target.checked })}
                />
                <code className="text-ink">{label}</code>
                <textarea
                  aria-label={`Commands for ${label}`}
                  data-testid={`macro-text-${label}`}
                  rows={Math.min(4, rule.commands.length)}
                  value={rule.commands.join('\n')}
                  onChange={(e) =>
                    updateEntry('macros', rule.id, {
                      commands: e.target.value
                        .split('\n')
                        .map((c) => c.trim())
                        .filter(Boolean),
                    })
                  }
                  className="min-w-40 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-ink"
                />
                <button
                  type="button"
                  data-testid={`macro-dry-run-${label}`}
                  onClick={() => dryRun(rule)}
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
                >
                  Dry run
                </button>
                <button
                  type="button"
                  data-testid={`macro-remove-${label}`}
                  onClick={() => removeEntry('macros', rule.id)}
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
                >
                  Remove
                </button>
              </div>
              {builtin && (
                <p className="mt-1 text-xs text-ink-muted" data-testid={`macro-conflict-${label}`}>
                  {label} also does {builtin} when nothing is bound to it. This macro wins.
                </p>
              )}
              {refusal && (
                <p className="mt-1 text-xs text-warn" data-testid={`macro-refused-${label}`}>
                  {refusal}
                </p>
              )}
              {plan?.id === rule.id && (
                <div className="mt-1" data-testid={`macro-plan-${label}`}>
                  <p className="text-xs text-ink-faint">
                    {(() => {
                      const refused = plan.refusals.filter(Boolean).length
                      const sendable = plan.commands.length - refused
                      // The count the lane would accept, not the count that
                      // was planned - #485. A dry run reporting "would send 2"
                      // for two commands the lane throws away is the defect,
                      // and the denominator is what makes it visible.
                      return refused === 0
                        ? `Would send ${sendable} commands, in this order. Nothing was sent.`
                        : `Would send ${sendable} of ${plan.commands.length}: ${refused} would be refused, and one refusal refuses the whole macro. Nothing was sent.`
                    })()}
                  </p>
                  <ol className="list-decimal pl-5 text-xs text-ink">
                    {plan.commands.map((command, i) => (
                      <li key={`${command}-${i}`}>
                        <code>{command}</code>
                        {plan.refusals[i] && (
                          <span
                            className="ml-1 text-warn"
                            data-testid={`macro-plan-refusal-${label}-${i}`}
                          >
                            {plan.refusals[i]}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
