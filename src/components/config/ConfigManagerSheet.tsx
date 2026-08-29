/**
 * The entry point: highlights and aliases, one sheet, two tabs.
 *
 * Wider and taller than SettingsSheet - a list-plus-form editor needs real
 * room, where settings toggles don't - but the same visual language
 * (surface/border tokens, an X to close, backdrop click to close).
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import { HighlightsEditor } from './HighlightsEditor'
import { AliasesEditor } from './AliasesEditor'
import { MacrosEditor } from './MacrosEditor'
import { cn } from '../../lib/cn'

type Tab = 'highlights' | 'aliases' | 'macros'

export function ConfigManagerSheet({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('highlights')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl max-h-[88vh]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-1">
            <h2 className="mr-2 text-sm font-semibold text-ink">Highlights, aliases &amp; macros</h2>
            <TabButton active={tab === 'highlights'} onClick={() => setTab('highlights')}>
              Highlights
            </TabButton>
            <TabButton active={tab === 'aliases'} onClick={() => setTab('aliases')}>
              Aliases
            </TabButton>
            <TabButton active={tab === 'macros'} onClick={() => setTab('macros')}>
              Macros
            </TabButton>
          </div>
          <button type="button" className="rounded-md p-1 text-ink-faint hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {tab === 'highlights' && <HighlightsEditor />}
          {tab === 'aliases' && <AliasesEditor />}
          {tab === 'macros' && <MacrosEditor />}
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-accent text-[#1a1408]' : 'text-ink-faint hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}
