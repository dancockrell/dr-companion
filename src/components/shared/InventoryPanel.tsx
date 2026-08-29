import { Package } from 'lucide-react'
import { useAppStore, isIntentImplemented } from '../../store/useAppStore'
import { capabilitiesForCharacter } from '../../lib/accountCapabilities'

export function InventoryPanel({ dense = false }: { dense?: boolean }) {
  const inventory = useAppStore((s) => s.inventory)
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const bridgeIntents = useAppStore((s) => s.bridgeIntents)
  const lootAvailable = isIntentImplemented(bridgeIntents, 'loot')

  if (!inventory) {
    return (
      <div className="text-xs text-ink-faint px-1 py-2">No inventory data</div>
    )
  }

  const caps = character ? capabilitiesForCharacter(character) : null

  /**
   * `pressure`/`used`/`capacity` come from the bridge already fabricated:
   * `companion_bridge.lic` hardcodes `used: 0, capacity: 0, pressure: 'ok'`
   * for every container (issue #5) — a live bridge currently can't even reach
   * that far, since it calls a `DRCI.get_worn_containers` method that does
   * not exist in Lich and silently returns an empty list instead. Nothing
   * here is measured yet, so nothing here is drawn as though it were. DR
   * containers always have a real capacity above zero, so `capacity === 0`
   * unambiguously means "not reported" rather than "holds nothing" — that's
   * what gates the bar below, no separate unknown flag needed until the
   * bridge starts sending a real number.
   *
   * `character.encumbrance` is real, already sent by the bridge
   * (`DRStats.encumbrance`), and was never read here — the panel computed
   * its own fake pressure instead of using the true one sitting unused on
   * the character. Use that for the header instead of `inventory.pressure`.
   */
  const encumbrance = character?.encumbrance
  const pressureColor =
    encumbrance === 'overloaded' || encumbrance === 'heavy'
      ? 'text-danger'
      : encumbrance === 'moderate' || encumbrance === 'light'
        ? 'text-warn'
        : encumbrance
          ? 'text-good'
          : 'text-ink-faint'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        {/* A heading, not a span - this box is mounted bare (no Box `title`,
         * see DashboardLayout), so this is the only accessible name the
         * panel has. A visually-identical span with no heading role reads
         * as unlabelled content to a screen reader. */}
        <h2 className="font-medium text-ink-faint uppercase tracking-wider">
          Inventory
        </h2>
        <span className={pressureColor}>{encumbrance ?? 'not reported'}</span>
      </div>

      <div className="rounded-xl border border-border bg-surface-raised divide-y divide-border">
        {inventory.containers.map((c) => {
          const known = c.capacity > 0
          const pct = known ? Math.round((c.used / c.capacity) * 100) : 0
          return (
            <div key={c.name} className="px-3 py-2 space-y-1">
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="text-ink flex items-center gap-1.5 min-w-0">
                  <Package className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                  <span className="truncate">{c.name}</span>
                </span>
                <span
                  className={
                    !known
                      ? 'text-ink-faint text-xs'
                      : pct >= 90
                        ? 'text-danger text-xs'
                        : pct >= 70
                          ? 'text-warn text-xs'
                          : 'text-ink-muted text-xs'
                  }
                >
                  {known ? `${c.used}/${c.capacity}` : 'contents unknown'}
                </span>
              </div>
              {known && (
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
              )}
            </div>
          )
        })}
        {inventory.containers.length === 0 && (
          <div className="px-3 py-2 text-xs text-ink-faint">
            No containers reported
          </div>
        )}
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

      {/* carryMax/carryWarnAt were sitting in AccountCapabilities with no
        * reader anywhere (issue #39) — the free-account carry ceiling was
        * computed and then thrown away. Worn + loose is the same total the
        * game itself warns against; there is no separate "junk room" count
        * the bridge sends. */}
      {caps?.carryMax != null && (() => {
        const carried = inventory.wornCount + inventory.looseCount
        const overWarn = caps.carryWarnAt != null && carried >= caps.carryWarnAt
        const overMax = carried >= caps.carryMax
        if (!overWarn) return null
        return (
          <p className={`text-xs leading-snug ${overMax ? 'text-danger' : 'text-warn'}`}>
            Carrying {carried} of {caps.carryMax} — free accounts get junk-room
            warnings past this.
          </p>
        )
      })()}

      {!dense && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!lootAvailable}
            className="flex-1 text-xs rounded-lg border border-border px-2 py-1.5 text-ink-muted hover:text-ink hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            title={lootAvailable ? undefined : 'Not yet implemented in the connected bridge.'}
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
