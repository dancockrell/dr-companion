import { useMacroRunner } from '../../lib/useMacroRunner.ts'
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
 */
export function ExitButtons({ exits }: { exits?: string[] }) {
  const { run, canSend, reason } = useMacroRunner()

  const controls = exitControls(exits)
  if (controls.length === 0) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {controls.map((control) => (
        <button
          key={control.label}
          type="button"
          disabled={!canSend}
          onClick={() => run([control.command])}
          title={reason ?? `Go ${control.label}`}
          className="rounded-md border border-info/35 bg-info/5 px-2 py-1 text-xs font-medium text-info hover:border-info hover:bg-info/15 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {control.label}
        </button>
      ))}
    </span>
  )
}
