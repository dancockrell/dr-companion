import { Anvil, Apple, Backpack, Beer, Bone, BookOpen, BowArrow, Box, Coins, Cookie, FlaskConical, Gem, Hammer, Key, Leaf, Package, Pickaxe, ScrollText, Shield, Shirt, Skull, Sparkles, Sword, Utensils, Wand2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { nounOf } from '../../lib/room'
import { useRoomItemTake } from '../../lib/useRoomItemTake'
import { useDragScroll } from '../../lib/useDragScroll'

/**
 * The floor, as its own row — pulled off the battle board itself
 * (`CombatRadar` used to draw it as its own corner) so the board stays
 * about who's fighting, not what's lying around after. Same pill style
 * `BattleActionBar` already uses: icon, label, one row, no group headers.
 *
 * Identical names collapse into one pill with a count, same idea CardDeck
 * already uses for duplicate creatures — three piles of "some copper
 * kronars" read as one pill worth three rather than three indistinguishable
 * coin pills in a row.
 */

/**
 * A generic-but-good icon for a floor item, guessed from its name the same
 * way a player glances at a pile and knows "that's coins" without reading a
 * label. Only a handful of keywords get their own icon — the things people
 * actually dig through a corpse for — everything else gets the same plain
 * "pile of something" icon rather than a wrong specific guess. Nothing here
 * is a claim about what the item actually is beyond what its own name
 * already says; the full name is still right there as the pill's label.
 */
function iconForItem(name: string) {
  const n = name.toLowerCase()
  if (/\bcoins?\b|\bkronars?\b|\blirums?\b|\bdokoras?\b/.test(n)) return Coins
  if (/\bgems?\b|\bjewels?\b|\bstones?\b/.test(n)) return Gem
  if (/\bbox\b|\bchest\b|\bcrate\b|\bcase\b/.test(n)) return Box
  if (/\bbackpack\b|\bbag\b|\bpouch\b|\bsack\b|\bpack\b/.test(n)) return Backpack
  if (/\bcorpse\b|\bcarcass\b|\bskull\b/.test(n)) return Skull
  if (/\bbones?\b|\btusk\b|\bfang\b|\bclaw\b/.test(n)) return Bone
  if (/\bbook\b|\btome\b|\bgrimoire\b/.test(n)) return BookOpen
  if (/\bscroll\b|\bletter\b|\bnote\b|\bparchment\b/.test(n)) return ScrollText
  if (/\bwand\b|\bstaff\b|\borb\b/.test(n)) return Wand2
  if (/\bbow\b|\bcrossbow\b|\barrows?\b|\bbolts?\b/.test(n)) return BowArrow
  if (/\bsword\b|\bblade\b|\bdagger\b|\bknife\b|\baxe\b|\bmace\b|\bspear\b/.test(n)) return Sword
  if (/\bshield\b|\bbuckler\b/.test(n)) return Shield
  if (/\barmor\b|\barmour\b|\bhauberk\b|\bbrigandine\b|\bhelm\b/.test(n)) return Shirt
  if (/\bherb\b|\bleaf\b|\broot\b|\bflower\b|\bremedy\b/.test(n)) return Leaf
  if (/\bskin\b|\bpelt\b|\bhide\b/.test(n)) return Shirt
  if (/\bingot\b|\bore\b|\bmetal\b/.test(n)) return Anvil
  if (/\bpickaxe\b|\bmining\b/.test(n)) return Pickaxe
  if (/\bhammer\b|\btool\b|\bkit\b/.test(n)) return Hammer
  if (/\bkey\b|\blockpick\b/.test(n)) return Key
  if (/\bpotion\b|\bphial\b|\bvial\b|\bflask\b/.test(n)) return FlaskConical
  if (/\bbeer\b|\bale\b|\bwine\b|\bdrink\b/.test(n)) return Beer
  if (/\bapple\b|\bfruit\b/.test(n)) return Apple
  if (/\bcookie\b|\bcake\b|\bbread\b/.test(n)) return Cookie
  if (/\bfood\b|\bmeat\b|\bstew\b/.test(n)) return Utensils
  if (/\bmagic\b|\bglowing\b|\bshimmering\b|\bcambrinth\b/.test(n)) return Sparkles
  return Package
}

export function FloorItems({ items }: { items?: string[] }) {
  const { take, canSend, reason } = useRoomItemTake()
  const drag = useDragScroll()

  if (!items || items.length === 0) return null

  const groups: { name: string; count: number }[] = []
  const indexOf = new Map<string, number>()
  for (const name of items) {
    const i = indexOf.get(name)
    if (i != null) groups[i].count++
    else {
      indexOf.set(name, groups.length)
      groups.push({ name, count: 1 })
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={drag.ref}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerCancel}
        className={cn('no-scrollbar flex touch-none gap-1 overflow-x-auto', drag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab')}
      >
        {groups.map(({ name, count }) => {
          const Icon = iconForItem(name)
          const label = count > 1 ? `${name} (${count})` : name
          const tooltip = reason ?? `get ${nounOf(name)}`
          return (
            <button
              key={name}
              type="button"
              disabled={!canSend}
              onClick={() => take(name)}
              title={tooltip}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-1 text-xs',
                'text-ink-muted hover:border-ink-faint hover:text-ink',
                'disabled:cursor-not-allowed disabled:opacity-40'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          )
        })}
      </div>
      {reason && <p className="text-xs text-warn leading-snug">{reason}</p>}
    </div>
  )
}
