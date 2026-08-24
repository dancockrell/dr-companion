import { DEMO_PRESET_LIST } from '../../bridge'
import { useAppStore } from '../../store/useAppStore'
import { capabilitiesForCharacter } from '../../lib/accountCapabilities'

/** Demo-only: switch mock character tier/instance. Remove when live bridge exists. */
export function PresetBar() {
  const character = useAppStore((s) => s.character)
  const loadPreset = useAppStore((s) => s.loadPreset)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const setBridgeMode = useAppStore((s) => s.setBridgeMode)
  const connectBridge = useAppStore((s) => s.connectBridge)

  const notes = character ? capabilitiesForCharacter(character).notes : []

  return (
    <section className="px-4 pb-2 shrink-0 space-y-2">
      <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
        Bridge / demo
      </h2>
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className={`flex-1 rounded-lg border px-2 py-1 ${
            bridgeMode === 'mock'
              ? 'border-accent text-accent bg-accent/10'
              : 'border-border text-ink-muted'
          }`}
          onClick={() => {
            setBridgeMode('mock')
            connectBridge()
          }}
        >
          Mock
        </button>
        <button
          type="button"
          className={`flex-1 rounded-lg border px-2 py-1 ${
            bridgeMode === 'live'
              ? 'border-accent text-accent bg-accent/10'
              : 'border-border text-ink-muted'
          }`}
          onClick={() => {
            setBridgeMode('live')
            connectBridge()
          }}
        >
          Live Lich
        </button>
      </div>
      <select
        className="w-full text-xs bg-surface-overlay border border-border rounded-lg px-2 py-1.5 text-ink"
        defaultValue="basic_prime"
        onChange={(e) => loadPreset(e.target.value)}
      >
        {DEMO_PRESET_LIST.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {notes.length > 0 && (
        <ul className="text-[11px] text-ink-faint space-y-0.5 leading-snug">
          {notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
