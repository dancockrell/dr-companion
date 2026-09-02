import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  Backpack,
  BicepsFlexed,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Eye,
  Footprints,
  Hand,
  HardHat,
  PanelTop,
  PersonStanding,
  Plus,
  Repeat,
  RotateCw,
  Shield,
  ShieldCheck,
  ShieldOff,
  Shirt,
  Trash2,
} from 'lucide-react'
import { isIntentImplemented, useAppStore } from '../../store/useAppStore'
import { useDragScroll } from '../../lib/useDragScroll'
import { scrollableRegionProps } from '../../lib/scrollableRegion'
import { nextArmorInRotation } from '../../lib/armorRotation'
import {
  ARMOR_COVERAGE,
  armorCandidates,
  armorCommandTarget,
  armorPieceId,
  inferArmorCoverage,
  isLikelyArmor,
  loadArmorLoadouts,
  sameArmorItem,
  saveArmorLoadouts,
  type ArmorCoverage,
  type ArmorLoadoutPiece,
  type ArmorLoadouts,
} from '../../lib/armorLoadout'

const COVERAGE_META: Record<ArmorCoverage, { label: string; short: string; Icon: ComponentType<{ className?: string }> }> = {
  head: { label: 'Head', short: 'HD', Icon: HardHat },
  eyes: { label: 'Eyes', short: 'EY', Icon: Eye },
  neck: { label: 'Neck', short: 'NK', Icon: CircleDot },
  chest: { label: 'Chest', short: 'CH', Icon: Shirt },
  abdomen: { label: 'Abdomen', short: 'AB', Icon: PanelTop },
  back: { label: 'Back', short: 'BK', Icon: Backpack },
  arms: { label: 'Arms', short: 'AR', Icon: BicepsFlexed },
  hands: { label: 'Hands', short: 'HN', Icon: Hand },
  legs: { label: 'Legs', short: 'LG', Icon: PersonStanding },
  feet: { label: 'Feet', short: 'FT', Icon: Footprints },
  shield: { label: 'Shield', short: 'SH', Icon: Shield },
}

function wornNow(name: string, worn: string[]): boolean {
  return worn.some((candidate) => sameArmorItem(candidate, name))
}

function pieceFor(name: string): ArmorLoadoutPiece {
  return {
    id: armorPieceId(name),
    name,
    coverage: inferArmorCoverage(name),
    provenance: 'derived',
  }
}

/**
 * A compact, persistent armour rack over the otherwise unused upper-right
 * radar quadrant. It never pretends the bridge knows coverage: name-derived
 * locations carry a dot, and touching any location turns the piece into an
 * explicit player choice that future inventory refreshes never overwrite.
 */
export function ArmorManager() {
  const character = useAppStore((state) => state.character)
  const inventory = useAppStore((state) => state.inventory)
  const bridgeIntents = useAppStore((state) => state.bridgeIntents)
  const requestIntent = useAppStore((state) => state.requestIntent)
  const [expanded, setExpanded] = useState(false)
  const [loadouts, setLoadouts] = useState<ArmorLoadouts>(loadArmorLoadouts)
  const [selected, setSelected] = useState('')
  const [coverageFilter, setCoverageFilter] = useState<ArmorCoverage | null>(null)
  const drag = useDragScroll()

  const characterKey = character?.name.trim().toLowerCase() || 'unknown'
  const pieces = loadouts[characterKey] ?? []
  const worn = inventory?.worn ?? []
  const candidates = useMemo(() => armorCandidates(inventory), [inventory])
  const available = isIntentImplemented(bridgeIntents, 'armor_manage')
  const canSend = Boolean(character?.connected && available && !character.stopLatched)

  const updatePieces = (next: ArmorLoadoutPiece[] | ((current: ArmorLoadoutPiece[]) => ArmorLoadoutPiece[])) => {
    setLoadouts((current) => {
      const previous = current[characterKey] ?? []
      const resolved = typeof next === 'function' ? next(previous) : next
      if (resolved === previous) return current
      const value = { ...current, [characterKey]: resolved }
      saveArmorLoadouts(value)
      return value
    })
  }

  // Seed real worn armour once it becomes visible. Player-edited pieces are
  // never changed here, and non-armour clothing/jewellery is not guessed into
  // the rack merely because the character happens to wear it.
  useEffect(() => {
    const inferred = worn.filter(isLikelyArmor)
    if (inferred.length === 0) return
    updatePieces((current) => {
      const additions = inferred
        .filter((name) => !current.some((piece) => sameArmorItem(piece.name, name)))
        .map(pieceFor)
      return additions.length ? [...current, ...additions] : current
    })
    // The worn list and character are the only external facts this sync reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterKey, inventory?.worn])

  useEffect(() => {
    if (!selected || candidates.includes(selected)) return
    setSelected('')
  }, [candidates, selected])

  const run = (operation: 'wear' | 'remove' | 'adjust' | 'swap', names: string[]) => {
    if (!canSend || names.length === 0) return
    requestIntent('armor_manage', { operation, items: names })
  }

  const wearAll = pieces.filter((piece) => !wornNow(piece.name, worn)).map((piece) => piece.name)
  const removeAll = pieces.filter((piece) => wornNow(piece.name, worn)).map((piece) => piece.name).reverse()
  const shieldPiece = pieces.find((piece) => piece.coverage.includes('shield'))

  // Head and hands get their own row rather than living only in the scrolling
  // list below: players often remove them independently for manual-dexterity
  // tasks, and a rack may carry more than one configured option per slot.
  const headPieces = pieces.filter((piece) => piece.coverage.includes('head'))
  const handsPieces = pieces.filter((piece) => piece.coverage.includes('hands'))
  const headWorn = headPieces.find((piece) => wornNow(piece.name, worn))
  const handsWorn = handsPieces.find((piece) => wornNow(piece.name, worn))
  const rotateSlot = (candidatesInSlot: ArmorLoadoutPiece[], current: ArmorLoadoutPiece | undefined) => {
    const next = nextArmorInRotation(candidatesInSlot, current)
    if (!next) return
    if (current && current.id !== next.id) run('swap', [next.name, current.name])
    else if (!current) run('wear', [next.name])
  }
  const bareTargets = [headWorn, handsWorn].filter((piece): piece is ArmorLoadoutPiece => Boolean(piece)).map((piece) => piece.name)

  const coverageCount = new Map<ArmorCoverage, number>()
  for (const piece of pieces) {
    for (const part of piece.coverage) coverageCount.set(part, (coverageCount.get(part) ?? 0) + 1)
  }
  const bodyCovered = ARMOR_COVERAGE.filter((part) => part !== 'shield' && (coverageCount.get(part) ?? 0) > 0).length
  const overlaps = ARMOR_COVERAGE.filter((part) => (coverageCount.get(part) ?? 0) > 1).length
  const shownPieces = coverageFilter ? pieces.filter((piece) => piece.coverage.includes(coverageFilter)) : pieces

  const addSelected = () => {
    if (!selected) return
    updatePieces((current) => current.some((piece) => sameArmorItem(piece.name, selected)) ? current : [...current, pieceFor(selected)])
    setSelected('')
    setExpanded(true)
  }

  const toggleCoverage = (id: string, coverage: ArmorCoverage) => {
    updatePieces((current) => current.map((piece) => {
      if (piece.id !== id) return piece
      const enabled = piece.coverage.includes(coverage)
      return {
        ...piece,
        coverage: enabled ? piece.coverage.filter((part) => part !== coverage) : [...piece.coverage, coverage],
        provenance: 'player',
      }
    }))
  }

  return (
    <aside
      className="absolute top-2 z-30 max-w-[calc(100%-8rem)] overflow-hidden rounded-xl border border-info/35 bg-surface/88 text-ink shadow-xl shadow-black/40 backdrop-blur-md"
      style={{ right: 'calc(var(--radar-rail, 68px) + 8px)', width: 'var(--armor-width, 288px)' }}
      aria-label="Armor manager"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-overlay/80"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={`${bodyCovered}/10 body zones covered; ${pieces.length} pieces in this character's armor rack`}
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-info" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide">Armor</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">{bodyCovered}/10 · {pieces.length} pcs</span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {expanded && <div className="grid grid-cols-6 gap-px border-y border-border/60 bg-border/60" aria-label="Current armor coverage — select a body location to filter the rack">
        {ARMOR_COVERAGE.map((part) => {
          const { Icon, label, short } = COVERAGE_META[part]
          const count = coverageCount.get(part) ?? 0
          return (
            <button
              type="button"
              key={part}
              className={`relative flex min-h-7 items-center justify-center gap-1 bg-surface/95 px-1 ${count === 0 ? 'text-ink-faint' : count === 1 ? 'text-good' : 'text-warn'} ${coverageFilter === part ? 'ring-1 ring-inset ring-accent' : 'hover:bg-surface-overlay'}`}
              title={`${label}: ${count === 0 ? 'uncovered' : count === 1 ? 'covered' : `${count} overlapping pieces`} — click to ${coverageFilter === part ? 'show all armor' : `show ${label.toLowerCase()} pieces`}`}
              aria-label={`${label}: ${count === 0 ? 'uncovered' : `${count} pieces`}`}
              aria-pressed={coverageFilter === part}
              onClick={() => {
                setCoverageFilter((current) => current === part ? null : part)
                setExpanded(true)
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{short}</span>
              {count > 0 && <span className="text-xs tabular-nums">{count}</span>}
            </button>
          )
        })}
      </div>}

      {expanded && (
        <div className="space-y-1.5 p-2">
          <div className="flex items-center gap-1 text-xs text-ink-muted">
            <span>{10 - bodyCovered} open zones</span>
            <span aria-hidden>·</span>
            <span className={overlaps ? 'text-warn' : 'text-good'}>{overlaps} overlaps</span>
            {coverageFilter && (
              <button type="button" onClick={() => setCoverageFilter(null)} className="ml-auto rounded border border-accent/45 px-1.5 py-0.5 text-accent hover:bg-accent/10" title="Show every armor piece">
                {COVERAGE_META[coverageFilter].label} · clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button type="button" disabled={!canSend || wearAll.length === 0} onClick={() => run('wear', wearAll)} className="flex items-center justify-center gap-1 rounded border border-good/45 bg-good/10 px-1 py-1 text-xs text-good hover:bg-good/20 disabled:cursor-not-allowed disabled:opacity-35" title={wearAll.length ? `Wear ${wearAll.length} missing rack pieces` : 'Every rack piece is already worn'}><ShieldCheck className="h-3.5 w-3.5" />Wear all</button>
            <button type="button" disabled={!canSend || removeAll.length === 0} onClick={() => run('remove', removeAll)} className="flex items-center justify-center gap-1 rounded border border-danger/45 bg-danger/10 px-1 py-1 text-xs text-danger hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-35" title={removeAll.length ? `Remove ${removeAll.length} worn rack pieces` : 'No rack pieces are currently worn'}><ShieldOff className="h-3.5 w-3.5" />Off all</button>
            <button type="button" disabled={!canSend || !shieldPiece} onClick={() => shieldPiece && run('adjust', [shieldPiece.name])} className="flex items-center justify-center gap-1 rounded border border-info/45 bg-info/10 px-1 py-1 text-xs text-info hover:bg-info/20 disabled:cursor-not-allowed disabled:opacity-35" title={shieldPiece ? `Adjust ${shieldPiece.name}` : 'Assign a shield to enable this'}><RotateCw className="h-3.5 w-3.5" />Adjust</button>
          </div>

          {shieldPiece && (
            <div className="grid grid-cols-3 gap-1" aria-label="Shield controls">
              <button type="button" disabled={!canSend || wornNow(shieldPiece.name, worn)} onClick={() => run('wear', [shieldPiece.name])} className="rounded border border-border px-1 py-0.5 text-xs text-ink-muted hover:text-good disabled:opacity-35" title={`Wear ${shieldPiece.name}`}>Wear shield</button>
              <button type="button" disabled={!canSend} onClick={() => run('adjust', [shieldPiece.name])} className="rounded border border-border px-1 py-0.5 text-xs text-ink-muted hover:text-info disabled:opacity-35" title={`Adjust ${shieldPiece.name}`}>Adjust shield</button>
              <button type="button" disabled={!canSend || !wornNow(shieldPiece.name, worn)} onClick={() => run('remove', [shieldPiece.name])} className="rounded border border-border px-1 py-0.5 text-xs text-ink-muted hover:text-danger disabled:opacity-35" title={`Remove ${shieldPiece.name}`}>Remove shield</button>
            </div>
          )}

          {/* One-click slot controls for the two pieces players most often
              remove independently. Rotation appears only when the rack has a
              genuine alternative configured for that slot. */}
          {(headPieces.length > 0 || handsPieces.length > 0) && (
            <div className="grid grid-cols-2 gap-1" aria-label="Helm and glove controls">
              {headPieces.length > 0 && (
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => headWorn ? run('remove', [headWorn.name]) : rotateSlot(headPieces, headWorn)}
                  className="flex items-center justify-center gap-1 rounded border border-border px-1 py-1 text-xs text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
                  title={headWorn ? `Remove ${armorCommandTarget(headWorn.name)}` : `Wear ${armorCommandTarget(headPieces[0].name)}`}
                >
                  <HardHat className="h-3.5 w-3.5" />{headWorn ? 'Helm off' : 'Helm on'}
                </button>
              )}
              {handsPieces.length > 0 && (
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => handsWorn ? run('remove', [handsWorn.name]) : rotateSlot(handsPieces, handsWorn)}
                  className="flex items-center justify-center gap-1 rounded border border-border px-1 py-1 text-xs text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
                  title={handsWorn ? `Remove ${armorCommandTarget(handsWorn.name)}` : `Wear ${armorCommandTarget(handsPieces[0].name)}`}
                >
                  <Hand className="h-3.5 w-3.5" />{handsWorn ? 'Gloves off' : 'Gloves on'}
                </button>
              )}
              {headPieces.length > 1 && (
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => rotateSlot(headPieces, headWorn)}
                  className="flex items-center justify-center gap-1 rounded border border-info/40 px-1 py-0.5 text-xs text-info hover:bg-info/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
                  title={`Rotate to the next of ${headPieces.length} helms in the rack`}
                >
                  <Repeat className="h-3 w-3" />Rotate helm
                </button>
              )}
              {handsPieces.length > 1 && (
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => rotateSlot(handsPieces, handsWorn)}
                  className="flex items-center justify-center gap-1 rounded border border-info/40 px-1 py-0.5 text-xs text-info hover:bg-info/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
                  title={`Rotate to the next of ${handsPieces.length} gloves in the rack`}
                >
                  <Repeat className="h-3 w-3" />Rotate gloves
                </button>
              )}
              {bareTargets.length > 0 && (
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => run('remove', bareTargets)}
                  className="col-span-2 flex items-center justify-center gap-1 rounded border border-warn/40 px-1 py-0.5 text-xs text-warn hover:bg-warn/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
                  title="Remove helm and gloves — locksmithing, first aid, forging and most manual-dexterity tasks want bare hands"
                >
                  Bare head &amp; hands
                </button>
              )}
            </div>
          )}

          <div className="flex min-w-0 gap-1">
            <select value={selected} onChange={(event) => setSelected(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-info" aria-label="Add an inventory item to the armor rack">
              <option value="">Add carried or worn item…</option>
              {candidates.map((name) => <option key={name} value={name}>{isLikelyArmor(name) ? '◆ ' : ''}{name}</option>)}
            </select>
            <button type="button" disabled={!selected} onClick={addSelected} className="grid w-7 shrink-0 place-items-center rounded border border-info/45 text-info hover:bg-info/10 disabled:opacity-35" title="Add selected item" aria-label="Add selected item to armor rack"><Plus className="h-3.5 w-3.5" /></button>
          </div>

          <div
            {...scrollableRegionProps('Armor pieces')}
            ref={drag.ref}
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
            className="max-h-48 cursor-grab space-y-1 overflow-y-auto active:cursor-grabbing"
          >
            {shownPieces.map((piece) => {
              const on = wornNow(piece.name, worn)
              const conflicting = on ? [] : pieces.filter((candidate) =>
                candidate.id !== piece.id
                && wornNow(candidate.name, worn)
                && candidate.coverage.some((part) => piece.coverage.includes(part)),
              )
              return (
                <div key={piece.id} className={`rounded border px-1.5 py-1 ${on ? 'border-good/45 bg-good/5' : 'border-border bg-surface-raised/80'}`}>
                  <div className="flex min-w-0 items-center gap-1">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${piece.provenance === 'player' ? 'bg-accent' : 'bg-ink-faint'}`} title={piece.provenance === 'player' ? 'Coverage set by player' : 'Coverage inferred from item name'} />
                    <span className="min-w-0 flex-1 truncate text-xs" title={piece.name}>{piece.name}</span>
                    <button
                      type="button"
                      disabled={!canSend}
                      onClick={() => run(on ? 'remove' : conflicting.length ? 'swap' : 'wear', [piece.name, ...conflicting.map((candidate) => candidate.name)])}
                      className={`rounded px-1 py-0.5 text-xs ${on ? 'text-danger hover:bg-danger/10' : conflicting.length ? 'text-warn hover:bg-warn/10' : 'text-good hover:bg-good/10'} disabled:opacity-35`}
                      title={on
                        ? `Remove ${armorCommandTarget(piece.name)}`
                        : conflicting.length
                          ? `Swap to ${armorCommandTarget(piece.name)}; remove overlapping ${conflicting.map((candidate) => armorCommandTarget(candidate.name)).join(', ')}`
                          : `Wear ${armorCommandTarget(piece.name)}`}
                    >{on ? 'Off' : conflicting.length ? 'Swap' : 'Wear'}</button>
                    <button type="button" onClick={() => updatePieces((current) => current.filter((candidate) => candidate.id !== piece.id))} className="rounded p-0.5 text-ink-faint hover:bg-danger/10 hover:text-danger" title={`Remove ${piece.name} from this rack`} aria-label={`Remove ${piece.name} from this armor rack`}><Trash2 className="h-3 w-3" /></button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {ARMOR_COVERAGE.map((part) => {
                      const active = piece.coverage.includes(part)
                      const meta = COVERAGE_META[part]
                      return (
                        <button key={part} type="button" onClick={() => toggleCoverage(piece.id, part)} className={`rounded border px-1 py-0.5 text-xs leading-none ${active ? 'border-info/55 bg-info/15 text-info' : 'border-border/70 text-ink-faint hover:text-ink'}`} title={`${active ? 'Remove' : 'Add'} ${meta.label.toLowerCase()} coverage`}>{meta.short}</button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {pieces.length === 0 && <p className="px-1 py-2 text-center text-xs text-ink-faint">Add armor from inventory.</p>}
            {pieces.length > 0 && shownPieces.length === 0 && <p className="px-1 py-2 text-center text-xs text-ink-faint">Nothing covers {coverageFilter ? COVERAGE_META[coverageFilter].label.toLowerCase() : 'this location'}.</p>}
          </div>

          {!available && <p className="text-xs text-warn">Update the Companion bridge to enable armor commands.</p>}
        </div>
      )}
    </aside>
  )
}
