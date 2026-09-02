/**
 * Choosing a tile's icon by hand.
 *
 * A centered modal, same reasoning as PinEditor's own: this panel's box
 * width varies (a 300px dock column, a wide "Arrange freely" tile), and an
 * anchored popover would need its own positioning math for each rather than
 * the one layout a modal needs regardless of where it was opened from.
 *
 * Exists because `scriptIcons.ts`'s guess is exactly that - a guess, run
 * against 200+ scripts this app never wrote and cannot read the intent of.
 * A wrong guess should cost one click to fix, not stay wrong forever.
 */
import { SCRIPT_ICON_KEYS, type ScriptIconKey } from '../../lib/scriptIcons'
import { SCRIPT_ICON_COMPONENT } from '../../lib/scriptIconComponents'
import { cn } from '../../lib/cn'
import { useModalDialog } from '../../lib/useModalDialog'

export function ScriptIconPicker({
  title,
  current,
  guessed,
  onPick,
  onReset,
  onClose,
}: {
  /** The task/script title, shown so the picker says what it is choosing an icon for. */
  title: string
  /** The icon currently shown on the tile - a player's own choice, or the guess. */
  current: ScriptIconKey
  /** What scriptIcons.ts would pick on its own, for the reset option. */
  guessed?: ScriptIconKey
  onPick: (icon: ScriptIconKey) => void
  onReset?: () => void
  onClose: () => void
}) {
  const dialogRef = useModalDialog(onClose)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      data-gameplay-shortcuts="suspend"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-icon-picker-title"
        tabIndex={-1}
        className="w-full max-w-xs rounded-lg border border-border bg-surface p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="script-icon-picker-title" className="text-sm font-semibold text-ink">Choose an icon</h3>
        <p className="mt-0.5 truncate text-xs text-ink-faint">{title}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SCRIPT_ICON_KEYS.map((key) => {
            const Icon = SCRIPT_ICON_COMPONENT[key]
            return (
              <button
                key={key}
                type="button"
                title={key}
                aria-label={`Icon: ${key}`}
                aria-pressed={current === key}
                onClick={() => onPick(key)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded border',
                  current === key
                    ? 'border-accent text-accent'
                    : 'border-border text-ink-faint hover:border-ink-faint hover:text-ink'
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {onReset ? (
            <button
              type="button"
              onClick={onReset}
              disabled={guessed === undefined || current === guessed}
              className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-40"
            >
              Reset to guess
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
