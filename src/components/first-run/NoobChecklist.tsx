import { NOOB_CHECKLIST } from '../../data/noobChecklist'

export function NoobChecklist() {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3 space-y-2">
      <h3 className="text-xs font-medium text-ink uppercase tracking-wider">
        Before serious training (noob checklist)
      </h3>
      {/* No height cap.
        *
        * It was `max-h-40 overflow-y-auto`, which showed seven of thirteen
        * items in a scrolling box, on a page with about four hundred pixels of
        * empty space underneath it. Content squeezed into a scroller while the
        * page it sits on is half blank.
        *
        * Invisible in the source and obvious in a render, which is the reason
        * tools/look.mjs exists. A cap is right when a container has a fixed
        * height to defend; the setup wizard scrolls as a page, so this has
        * nothing to defend and the list should just be the list. */}
      <ul className="space-y-1.5">
        {NOOB_CHECKLIST.map((item) => (
          <li key={item.id} className="text-xs leading-snug">
            <span
              className={
                item.priority === 'required' ? 'text-warn font-medium' : 'text-ink-muted'
              }
            >
              {item.priority === 'required' ? '●' : '○'} {item.label}
            </span>
            <span className="text-ink-faint"> — {item.detail}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-faint">
        STR/STAM first, multi-skill weapons, distinct bags, bank plats at major hubs.
      </p>
    </div>
  )
}
