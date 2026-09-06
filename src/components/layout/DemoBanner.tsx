import { useAppStore } from '../../store/useAppStore.ts'

/**
 * Says, in words, that nothing on screen is real.
 *
 * The demo world used to be the default on a fresh install, and it was
 * labelled: a `MOCK` badge by the character name, a "Mock" indicator in the
 * corner, "Not attached" in the command box. A first run on a clean VM
 * (defect 3 of `docs/verification/first-run-2026-09-05.md`, issue #382) showed
 * why that was not enough - the labels were small relative to the fiction, and
 * the fiction was a full stat block, a room, eighteen people and a health bar
 * reading "In combat, 84 of 100".
 *
 * So this is a band across the whole window rather than another badge, and it
 * carries its own way out. The badges stay: they answer "is this live" at a
 * glance for somebody who already knows what the app is, which is a different
 * question from the one a person seeing it for the first time is asking.
 *
 * `shrink-0` because it sits in the app's top-level flex column, above the
 * workspace row that owns the remaining height.
 *
 * `compact` is the popped-out window case (issue #400). Those windows are one
 * panel tall, so the `DEMO` pill and some of the padding go. What does not go
 * is the sentence or the way out: a band that no longer says the data is
 * invented is the bug, not a tidier version of the fix.
 */
export function DemoBanner({ compact = false }: { compact?: boolean }) {
  const setBridgeMode = useAppStore((s) => s.setBridgeMode)
  const connectBridge = useAppStore((s) => s.connectBridge)

  return (
    <div
      className={`flex shrink-0 items-center border-b border-warn/40 bg-warn/15 text-xs text-warn ${
        compact ? 'gap-2 px-2 py-1' : 'gap-3 px-3 py-1.5'
      }`}
      role="status"
      aria-label="Demo mode"
    >
      {!compact && (
        <span className="rounded bg-warn/25 px-1.5 py-0.5 font-semibold uppercase tracking-wider">
          Demo
        </span>
      )}
      <span className="min-w-0 flex-1">
        Demo: this is invented data. Attach to Lich to see your character.
      </span>
      <button
        type="button"
        onClick={() => {
          // The same pair Settings uses, in the same order: switch the mode,
          // which clears the invented character, then attach the real one.
          setBridgeMode('live')
          connectBridge()
        }}
        className="shrink-0 rounded border border-warn/50 px-2 py-0.5 font-semibold hover:bg-warn/25"
      >
        Leave the demo
      </button>
    </div>
  )
}
