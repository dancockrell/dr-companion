import { useAppStore } from '../../store/useAppStore.ts'
import { canSendMacro } from '../../lib/canSendMacro.ts'
import { requestGameAction } from '../../lib/gameActions.ts'
import { exitControls } from '../../lib/roomExits.ts'

/**
 * The room's own exits, clickable — the same words `ClassicRoomText`'s
 * "Obvious paths" line already prints, next to the room id line rather
 * than repeated a second time in that line itself. A direction is a real
 * DragonRealms command on its own (`north`, `out`, `up`), so a click here
 * sends exactly what typing the word would have.
 *
 * This is one of the three ways to travel Dan named on 6 September 2026 —
 * "by clicking on another tile or by clicking on the words in the interface
 * or by hotkey" — and it is the one that needs no 3D viewer and no map
 * database. The list itself is `exitControls`, so what is offered and what
 * each control sends are decided in a pure function
 * `tools/exit-controls-test.mjs` can assert against real parsed room text,
 * rather than inside a component nothing in this repository can render.
 *
 * # Why this sends through the command lane and not the macro runner
 *
 * It used the macro runner first, and that was the wrong lane twice over.
 * `run_macro` is a bridge intent, so a click here went out beside the
 * outbound command lane rather than through it — no ordering against a
 * script's walk loop, no roundtime pacing, nothing for Stop to flush — which
 * is exactly the invariant `command_gate.rs` exists to hold. And the macro
 * in-flight gate refuses a second press while the first is outstanding,
 * which is right for a five-command attack macro and wrong for the two
 * things a player does with a direction: press it twice, or press it and
 * then press another one. The lane already coalesces duplicate movement and
 * holds against the roundtime the game reports, so the pacing this needs is
 * the pacing it now gets, from the one place that has the roundtime.
 *
 * `canSendMacro` is still the source of the disabled state and its wording,
 * minus `inFlight` for the reason above: "not connected" and "stopped —
 * press Resume first" are the same two answers here as anywhere else, and a
 * second phrasing of them is how two of them drift apart.
 */
export function ExitButtons({ exits }: { exits?: string[] }) {
  const character = useAppStore((s) => s.character)
  const { canSend, reason } = canSendMacro({
    stopLatched: character?.stopLatched,
    connected: !!character,
  })

  const controls = exitControls(exits)
  if (controls.length === 0) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {controls.map((control) => (
        <button
          key={control.label}
          type="button"
          disabled={!canSend}
          onClick={() => requestGameAction(control.command, `Go ${control.label}`, 'ui-action')}
          title={reason ?? `Go ${control.label}`}
          className="rounded-md border border-info/35 bg-info/5 px-2 py-1 text-xs font-medium text-info hover:border-info hover:bg-info/15 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {control.label}
        </button>
      ))}
    </span>
  )
}
