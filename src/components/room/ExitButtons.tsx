import { useMacroRunner } from '../../lib/useMacroRunner'

/**
 * The room's own exits, clickable — the same words `ClassicRoomText`'s
 * "Obvious paths" line already prints, next to the room id line rather
 * than repeated a second time in that line itself. A direction is a real
 * DragonRealms command on its own (`north`, `out`, `up`), so a click here
 * sends exactly what typing the word would have.
 */
export function ExitButtons({ exits }: { exits?: string[] }) {
  const { run, canSend, reason } = useMacroRunner()

  if (!exits || exits.length === 0) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {exits.map((dir) => (
        <button
          key={dir}
          type="button"
          disabled={!canSend}
          onClick={() => run([dir])}
          title={reason ?? `Go ${dir}`}
          className="rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:border-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {dir}
        </button>
      ))}
    </span>
  )
}
