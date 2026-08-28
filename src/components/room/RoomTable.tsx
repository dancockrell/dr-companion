/**
 * The room, as a table: the background is the felt, the chips sit on it.
 *
 * "Make the background of the room the table the objects and people play
 * against" was the exact ask. `RoomScene` already draws the background —
 * real room art once it exists, a deterministic terrain fingerprint until
 * then — so this does not replace it, it puts chips on top of it. Hostile
 * chips sit along the far edge, the way opponents sit across a real table;
 * people and allies sit along the near edge, your side of it. Loose items
 * are small tokens in the middle, because a coin or a dagger lying on felt
 * is a smaller thing than a creature and should read as smaller.
 *
 * The data underneath is the same `fromRoom()` → `collapse()` → `sortCards()`
 * pipeline BattlePanel's cards already use. Nothing about what counts as
 * hostile, what a stack is, or how lore is matched is reinvented here — only
 * the shape it is drawn in changes.
 */
import { useEffect, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { fromRoom } from '../../lib/room'
import { collapse, sortCards, type RoomCard } from '../../lib/cards'
import { RoomScene } from './RoomScene'
import { CreatureChip } from '../shared/CreatureChip'
import { playChipIn, playChipOut } from '../../lib/chipSound'
import { Package } from 'lucide-react'

/**
 * What changed since the last render, for sound only — nothing here affects
 * what is drawn. A chip landing (a card id that was not present a moment
 * ago) plays the "in" sound; a card that flipped to dead plays "out". Status
 * changes other than death (stunned, etc.) are silent on purpose: this is a
 * table ambience, not a combat log, and a tone for every flicker would be
 * the "client that pings constantly" alertSound.ts already warns against.
 */
function useTableSounds(cards: RoomCard[]) {
  const previous = useRef<Map<string, RoomCard['status']> | null>(null)

  useEffect(() => {
    const prev = previous.current
    const next = new Map(cards.map((c) => [c.id, c.status]))
    if (prev) {
      for (const [id, status] of next) {
        const before = prev.get(id)
        if (before === undefined) playChipIn()
        else if (before !== 'dead' && status === 'dead') playChipOut()
      }
    }
    previous.current = next
    // Deliberately not a cleanup-returning effect: this only ever needs to
    // compare against the last committed set, never to undo anything.
  }, [cards])
}

export function RoomTable({
  zone,
  room,
  title,
  text,
  height = 260,
}: {
  zone: string
  room: number
  title?: string | null
  text?: string | null
  /** Taller than the bare scene's default — there is more on it now. */
  height?: number
}) {
  const character = useAppStore((s) => s.character)
  const cards = sortCards(collapse(fromRoom(character)))
  const hostile = cards.filter((c) => c.deck === 'hostile')
  const friendly = cards.filter((c) => c.deck !== 'hostile')
  const items = character?.roomItems ?? []

  useTableSounds(cards)

  return (
    <RoomScene zone={zone} room={room} title={title} text={text} height={height}>
      {/* A felt tint over the art/fingerprint, so a bright room photo does not
          fight the chips sitting on it — the same reason real felt is a flat,
          saturated colour rather than whatever pattern is under the table. */}
      <div className="absolute inset-0 bg-good/10" aria-hidden="true" />

      {/* Hostile: the far edge. */}
      {hostile.length > 0 && (
        <div className="absolute inset-x-0 top-2 flex flex-wrap justify-center gap-3 px-2">
          {hostile.map((c) => (
            <CreatureChip key={c.id} card={c} size={52} />
          ))}
        </div>
      )}

      {/* Loose items: small tokens in the middle of the table. */}
      {items.length > 0 && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-wrap justify-center gap-2 px-2">
          {items.slice(0, 8).map((name) => (
            <span
              key={name}
              title={name}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface/80 text-ink-faint shadow"
            >
              <Package className="h-3.5 w-3.5" />
            </span>
          ))}
          {items.length > 8 && (
            <span className="flex h-7 items-center rounded-full border border-border bg-surface/80 px-2 text-xs text-ink-faint shadow">
              +{items.length - 8}
            </span>
          )}
        </div>
      )}

      {/* People and allies: the near edge, your side of the table. */}
      {friendly.length > 0 && (
        <div className="absolute inset-x-0 bottom-8 flex flex-wrap justify-center gap-3 px-2">
          {friendly.map((c) => (
            <CreatureChip key={c.id} card={c} size={52} />
          ))}
        </div>
      )}
    </RoomScene>
  )
}
