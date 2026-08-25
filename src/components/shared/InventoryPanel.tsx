import { Package } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { capabilitiesForCharacter } from '../../lib/accountCapabilities'

export function InventoryPanel({ dense = false }: { dense?: boolean }) {
  const inventory = useAppStore((s) => s.inventory)
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)

  if (!inventory) {
    return (
      <div className="text-xs text-ink-faint px-1 py-2">No inventory data</div>
    )
  }

  const caps = character ? capabilitiesForCharacter(character) : null
  const pressureColor =
    inventory.pressure === 'full'
      ? 'text-danger'
      : inventory.pressure === 'high'
        ? 'text-warn'
        : 'text-good'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-ink-faint uppercase tracking-wider">
          Inventory
        </span>
        <span className={pressureColor}>
          {inventory.pressure === 'ok'
            ? 'Space OK'
            : inventory.pressure === 'high'
              ? 'Getting full'
              : 'Full'}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-surface-raised divide-y divide-border">
        {inventory.containers.map((c) => {
          const pct = Math.round((c.used / Math.max(1, c.capacity)) * 100)
          return (
            <div key={c.name} className="px-3 py-2 space-y-1">
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="text-ink flex items-center gap-1.5 min-w-0">
                  <Package className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                  <span className="truncate">{c.name}</span>
                </span>
                <span
                  className={
                    pct >= 90
                      ? 'text-danger text-xs'
                      : pct >= 70
                        ? 'text-warn text-xs'
                        : 'text-ink-muted text-xs'
                  }
                >
                  {c.used}/{c.capacity}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface overflow-hidden border border-border/40">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct >= 90
                      ? 'bg-danger'
                      : pct >= 70
                        ? 'bg-warn'
                        : 'bg-good'
                  }`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          )
        })}
        <div className="px-3 py-2 flex justify-between text-xs text-ink-faint">
          <span>Worn {inventory.wornCount}</span>
          <span>Loose {inventory.looseCount}</span>
        </div>
      </div>

      {caps?.inventoryPressureTight && (
        <p className="text-xs text-warn leading-snug">
          Tight inventory tier — loot stays selective.
        </p>
      )}

      {!dense && (
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 text-xs rounded-lg border border-border px-2 py-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay"
            onClick={() => requestIntent('loot')}
          >
            Loot pass
          </button>
          <button
            type="button"
            className="flex-1 text-xs rounded-lg border border-border px-2 py-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay"
            onClick={() => requestIntent('stow_all')}
          >
            Stow all
          </button>
        </div>
      )}
    </div>
  )
}
