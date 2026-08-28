import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_FLOWS,
  allFlows,
  customFlowNote,
  loadCustomFlows,
  newFlow,
  saveCustomFlows,
  type TaskFlow,
} from '../../data/taskFlows'
import { FlowDriver } from '../../lib/flowDriver'
import { onStopAll, onPauseAll, onResumeAll, onStartFlow } from '../../lib/flowStop'
import { describeFlow, isFinished, type FlowState } from '../../lib/flowRunner'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

/**
 * Task flows.
 *
 * The panel the Activities list should have been. Its buttons were one press
 * each and told you nothing afterwards: "combat loop" started something and
 * then the interface went quiet until you pressed Stop, so a working loop and
 * a wedged one looked the same.
 *
 * Three things fix that and they are all visible here. Every flow says what it
 * does before you press it. A running flow says which step it is on and, if it
 * loops, which pass. And the flows are editable, because the built-in seven
 * are a starting set and a player's own hunting cycle is the one they will
 * actually press.
 */
export function TaskFlowPanel({ dense = false }: { dense?: boolean }) {
  const requestIntent = useAppStore((s) => s.requestIntent)
  const addLog = useAppStore((s) => s.addLog)
  const connected = useAppStore((s) => s.bridgeConnected)
  const setActiveFlow = useAppStore((s) => s.setActiveFlow)

  const [custom, setCustom] = useState<TaskFlow[]>([])
  const [state, setState] = useState<FlowState | null>(null)
  const [editing, setEditing] = useState<TaskFlow | null>(null)

  // Said out loud rather than left as a flow that quietly is not in the list.
  // A rejected flow and a flow that was never saved look identical from here,
  // and they need different things from the player. See customFlowNote().
  useEffect(() => {
    setCustom(loadCustomFlows())
    const note = customFlowNote()
    if (note) addLog(note, 'warn')
  }, [addLog])

  const driver = useRef<FlowDriver | null>(null)
  if (!driver.current) {
    driver.current = new FlowDriver({
      send: (commands) => {
        requestIntent('run_macro', { commands })
        return true
      },
      onChange: (s) => {
        setState(s)
        // Published as well as held locally. The safety bar reports what the
        // app is doing, and a flow is the most likely thing it is doing: with
        // this state living only here, the bar read Idle through an hour-long
        // hunting loop.
        setActiveFlow(isFinished(s) ? null : describeFlow(s))
      },
      log: addLog,
    })
  }

  // A flow driving a character through a bridge that has gone away is the
  // worst case here: the steps keep firing into nothing and the panel keeps
  // saying it is working.
  useEffect(() => {
    if (!connected) driver.current?.interrupt('the bridge went down')
  }, [connected])

  // SafetyFooter's Stop all lives outside this panel and has no reference to
  // this driver — see flowStop.ts. Without this, pressing it aborted the
  // in-flight step at the bridge while the driver's own timer, none the
  // wiser, fired the next one on schedule: the flow kept running and the
  // panel kept reporting it as active. A player's stop, not the bridge going
  // away, so `stop()` and not `interrupt()`.
  useEffect(() => onStopAll(() => driver.current?.stop()), [])

  // Same reasoning as Stop all, for the other two buttons that claimed to
  // reach this driver and never did: "Hold automation where it is" held
  // nothing, and "Carry on from where it paused" had nothing to carry on
  // from, because nothing client-side had a pause/resume at all.
  useEffect(() => onPauseAll(() => driver.current?.pause()), [])
  useEffect(() => onResumeAll(() => driver.current?.resume()), [])

  // The timer outlives the component otherwise, and a popped-out panel
  // unmounts while a hunting loop is mid-pass.
  useEffect(
    () => () => {
      driver.current?.dispose()
      setActiveFlow(null)
    },
    [setActiveFlow]
  )

  const flows = useMemo(() => allFlows(custom), [custom])

  // The Command Palette starts a flow by id with no reference to this
  // driver, same shape as Stop/Pause/Resume above. Re-subscribes when the
  // flow list changes so a flow added or edited this session is reachable
  // immediately rather than only after a remount.
  useEffect(
    () =>
      onStartFlow((flowId) => {
        const flow = flows.find((f) => f.id === flowId)
        if (flow) driver.current?.start(flow)
      }),
    [flows]
  )

  const running = state && !isFinished(state) ? state : null

  const persist = useCallback((next: TaskFlow[]) => {
    setCustom(next.filter((f) => f.custom))
    saveCustomFlows(next)
  }, [])

  if (editing) {
    return (
      <FlowEditor
        flow={editing}
        onCancel={() => setEditing(null)}
        onDelete={() => {
          persist(custom.filter((f) => f.id !== editing.id))
          setEditing(null)
        }}
        onSave={(f) => {
          persist([...custom.filter((x) => x.id !== f.id), f])
          setEditing(null)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {/* What it is doing, in words, above the buttons.
       *
       * Reserved whether or not a flow is running, so starting one does not
       * push every button down by a line. */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs',
          running
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-transparent text-ink-faint'
        )}
      >
        <span className="truncate">
          {state ? describeFlow(state) : 'No flow running'}
        </span>
        {running && (
          <button
            type="button"
            onClick={() => driver.current?.stop()}
            className="shrink-0 rounded border border-danger/40 bg-danger/15 px-2 py-0.5 font-semibold text-danger hover:bg-danger/25"
          >
            Stop
          </button>
        )}
      </div>

      <div className="grid min-h-0 grid-cols-2 gap-1 overflow-auto">
        {flows.map((f) => {
          const active = running?.flow.id === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => driver.current?.start(f)}
              onContextMenu={(e) => {
                e.preventDefault()
                // Right-click edits. A built-in is copied rather than changed,
                // so the seven defaults are always there to fall back to.
                setEditing(
                  f.custom
                    ? f
                    : { ...f, id: `${f.id}-${Date.now().toString(36)}`, title: `${f.title} (mine)`, custom: true }
                )
              }}
              title={`${f.summary}\n\n${f.steps.map((s, i) => `${i + 1}. ${s.label}: ${s.commands.join('; ')}`).join('\n')}\n\nRight-click to ${f.custom ? 'edit' : 'copy and edit'}`}
              className={cn(
                'rounded border px-2 py-1.5 text-left transition-colors',
                active
                  ? 'border-accent bg-accent/15'
                  : 'border-border bg-surface-raised hover:border-ink-faint'
              )}
            >
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-medium text-ink">{f.title}</span>
                {/* An endless flow has to look different before it is pressed. */}
                {f.loops && <span className="shrink-0 text-xs text-ink-faint" title="Repeats until stopped">↻</span>}
                {f.custom && <span className="shrink-0 text-xs text-accent" title="Yours">•</span>}
              </div>
              {!dense && (
                <p className="truncate text-xs leading-tight text-ink-faint">{f.summary}</p>
              )}
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setEditing(newFlow(`flow-${Date.now().toString(36)}`))}
          className="rounded border border-dashed border-border px-2 py-1.5 text-xs text-ink-faint hover:border-ink-faint hover:text-ink"
        >
          + New flow
        </button>
      </div>
    </div>
  )
}

/**
 * The editor.
 *
 * Commands are edited as plain text, one per line, because that is what they
 * are. A builder with dropdowns would have to know every command in
 * DragonRealms, and the ones a player most wants in their own flow are exactly
 * the ones a fixed list would not have.
 */
function FlowEditor({
  flow,
  onSave,
  onCancel,
  onDelete,
}: {
  flow: TaskFlow
  onSave: (f: TaskFlow) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState<TaskFlow>(flow)
  const known = DEFAULT_FLOWS.some((f) => f.id === flow.id)

  /**
   * The first step that would make `loadCustomFlows()` reject this whole flow,
   * or null.
   *
   * Held here rather than inlined into `disabled` so the same answer drives
   * both the gate and the message beside it. Two conditions that mean the same
   * thing drift, and the drift this replaces was exactly that: the gate asked
   * whether *some* step had commands while the loader required *every* step to.
   */
  const emptyStep = (() => {
    const i = draft.steps.findIndex((s) => s.commands.filter((c) => c.trim()).length === 0)
    return i === -1 ? null : i
  })()

  const setStep = (i: number, patch: Partial<TaskFlow['steps'][number]>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)),
    }))

  return (
    <div className="flex min-h-0 flex-col gap-1.5 overflow-auto text-xs">
      <input
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        placeholder="Name"
        className="rounded border border-border bg-surface px-2 py-1 text-ink"
      />
      <input
        value={draft.summary}
        onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        placeholder="What it does, and where it stops"
        className="rounded border border-border bg-surface px-2 py-1 text-ink-muted"
      />

      <label className="flex items-center gap-1.5 text-ink-muted">
        <input
          type="checkbox"
          checked={!!draft.loops}
          onChange={(e) => setDraft({ ...draft, loops: e.target.checked })}
        />
        Repeat until stopped
      </label>

      {draft.steps.map((s, i) => (
        <div key={i} className="rounded border border-border p-1.5">
          <div className="flex gap-1">
            <input
              value={s.label}
              onChange={(e) => setStep(i, { label: e.target.value })}
              placeholder={`Step ${i + 1}`}
              className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-0.5 text-ink"
            />
            <input
              type="number"
              min={0}
              value={s.settle ?? 0}
              onChange={(e) => setStep(i, { settle: Number(e.target.value) || undefined })}
              title="Seconds to wait after this step, for things the game gives no roundtime for"
              className="w-12 rounded border border-border bg-surface px-1 py-0.5 text-ink-muted"
            />
            <button
              type="button"
              onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, n) => n !== i) })}
              className="rounded border border-border px-1.5 text-ink-faint hover:text-danger"
              title="Remove this step"
            >
              ×
            </button>
          </div>
          <textarea
            value={s.commands.join('\n')}
            onChange={(e) =>
              setStep(i, { commands: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })
            }
            rows={Math.max(2, s.commands.length)}
            placeholder="One command per line"
            className="mt-1 w-full rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-ink-muted"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setDraft({ ...draft, steps: [...draft.steps, { label: `Step ${draft.steps.length + 1}`, commands: [] }] })
        }
        className="rounded border border-dashed border-border px-2 py-1 text-ink-faint hover:text-ink"
      >
        + Step
      </button>

      {/* Named, not just disabled. Save going dead with no reason given is its
          own small mystery, and "+ Step" produces an empty step by design, so
          this is the ordinary state of a half-finished edit rather than an
          error the player has to have made. */}
      {emptyStep !== null && (
        <span className="text-xs text-warn">
          Step {emptyStep + 1} sends nothing. Give it a command, or remove it.
        </span>
      )}

      <div className="flex gap-1">
        <button
          type="button"
          // `every`, not `some`. A flow with one empty step among several saves
          // happily and is then rejected wholesale by loadCustomFlows(), which
          // requires every step to send something - so the player adds a step,
          // gets distracted, saves, sees the flow in the list, and finds the
          // whole thing gone on next launch. The loss is logged, but from where
          // they were standing the save worked.
          //
          // Repairing it instead - dropping empty steps on save - was the other
          // option and is the wrong one here: an empty step is a decision about
          // what the flow does, and this app's rule is repair what cannot reach
          // the game, reject what can. Rejecting in front of the player beats
          // discarding behind them.
          disabled={emptyStep !== null}
          onClick={() => onSave(draft)}
          className="flex-1 rounded border border-accent/40 bg-accent/15 px-2 py-1 font-semibold text-accent disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-2 py-1 text-ink-muted"
        >
          Cancel
        </button>
        {!known && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-danger/40 px-2 py-1 text-danger"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
