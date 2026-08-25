import { NOOB_CHECKLIST } from '../../data/noobChecklist'

export function NoobChecklist() {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3 space-y-2">
      <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
        Before serious training (noob checklist)
      </h3>
      <ul className="space-y-1.5 max-h-40 overflow-y-auto">
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
