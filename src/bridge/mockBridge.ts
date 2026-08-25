/**
 * Mock bridge — simulates Lich status stream for UI development
 * without a live game connection.
 */

import type { CharacterStatus, InventorySummary } from '../types'
import type { BridgeClientMessage, BridgeServerMessage, IntentName } from './types'
import { capabilitiesForCharacter, intentBlockReason } from '../lib/accountCapabilities'
import { pickBestHealer, scoreHealers } from '../data/healers'
import { planTownRun } from '../data/townRun'
import { pickSuggestedHunt, rankHuntingGrounds, HUNTING_GROUNDS } from '../data/hunting'
import { simulateCombatLoop, describeCombatState } from '../data/combatMachine'
import { planTravel } from '../data/travelPath'
import type { GuildId } from '../data/hunting'
import type { SkillState } from '../data/skills'

type Listener = (msg: BridgeServerMessage) => void

/**
 * Build a plausible skill spread for a demo character.
 *
 * Deliberately uneven: a couple of skills near mind lock, a couple with room.
 * A flat spread would make the training panel look pointless, and the whole
 * point of the mechanic is that skills diverge.
 */
function demoSkills(level: number): SkillState[] {
  const spread: [string, SkillState['skillset'], number, number][] = [
    ['Small Edged', 'Weapon', 1.0, 33],
    ['Large Edged', 'Weapon', 0.7, 8],
    ['Parry Ability', 'Weapon', 0.9, 21],
    ['Light Armor', 'Armor', 0.95, 34],
    ['Shield Usage', 'Armor', 0.8, 14],
    ['Evasion', 'Survival', 1.0, 29],
    ['Athletics', 'Survival', 0.6, 4],
    ['Perception', 'Survival', 0.7, 11],
    ['Stealth', 'Survival', 0.5, 2],
    ['Locksmithing', 'Survival', 0.4, 30],
    ['Primary Magic', 'Magic', 0.85, 17],
    ['Appraisal', 'Lore', 0.3, 0],
    ['Scholarship', 'Lore', 0.35, 6],
  ]
  return spread.map(([name, skillset, factor, mindstate]) => ({
    name,
    skillset,
    ranks: Math.max(1, Math.round(level * factor)),
    mindstate,
  }))
}

export type DemoPresetId = 'basic_prime' | 'f2p_prime' | 'fallen_sub' | 'premium_prime' | 'platinum_fallen'

interface DemoPreset {
  id: DemoPresetId
  label: string
  character: CharacterStatus
  inventory: InventorySummary
}

const presets: Record<DemoPresetId, DemoPreset> = {
  basic_prime: {
    id: 'basic_prime',
    label: 'Basic · Prime',
    character: {
      name: 'Dan the Bold',
      instance: 'Prime',
      accountTier: 'basic',
      guild: 'barbarian',
      skillRanks: 55,
      location: {
        title: 'Crossing – Town Square Central',
        zone: 'Crossing',
        province: 'Zoluren',
        isTown: true,
        isSafe: true,
      },
      vitals: {
        health: 84,
        healthMax: 100,
        spirit: 100,
        spiritMax: 100,
        fatigue: 62,
        fatigueMax: 100,
      },
      situation: [],
      activity: 'Ready',
      connected: true,
    },
    inventory: {
      containers: [
        { name: 'backpack', used: 18, capacity: 30 },
        { name: 'belt pouch', used: 4, capacity: 8 },
        { name: 'thigh bag', used: 2, capacity: 6 },
      ],
      wornCount: 12,
      looseCount: 0,
      pressure: 'ok',
    },
  },
  f2p_prime: {
    id: 'f2p_prime',
    label: 'F2P · Prime',
    character: {
      name: 'Explorer Miri',
      instance: 'Prime',
      accountTier: 'f2p',
      guild: 'thief',
      skillRanks: 35,
      location: {
        title: 'Crossing – Town Square Central',
        zone: 'Crossing',
        province: 'Zoluren',
        isTown: true,
        isSafe: true,
      },
      vitals: {
        health: 70,
        healthMax: 90,
        spirit: 90,
        spiritMax: 90,
        fatigue: 40,
        fatigueMax: 90,
      },
      situation: [],
      activity: 'Ready',
      connected: true,
    },
    inventory: {
      containers: [
        { name: 'backpack', used: 22, capacity: 25 },
        { name: 'belt', used: 5, capacity: 6 },
      ],
      wornCount: 8,
      looseCount: 1,
      pressure: 'high',
    },
  },
  fallen_sub: {
    id: 'fallen_sub',
    label: 'Fallen sub · Fallen',
    character: {
      name: 'Ashen Keth',
      instance: 'Fallen',
      accountTier: 'fallen',
      guild: 'necromancer',
      skillRanks: 90,
      location: {
        title: 'Shard – Inner Gate',
        zone: 'Shard',
        province: 'Ilithi',
        isTown: true,
        isSafe: true,
      },
      vitals: {
        health: 95,
        healthMax: 110,
        spirit: 110,
        spiritMax: 110,
        fatigue: 55,
        fatigueMax: 110,
      },
      situation: [],
      activity: 'Ready',
      connected: true,
    },
    inventory: {
      containers: [
        { name: 'backpack', used: 14, capacity: 30 },
        { name: 'satchel', used: 6, capacity: 12 },
      ],
      wornCount: 11,
      looseCount: 0,
      pressure: 'ok',
    },
  },
  premium_prime: {
    id: 'premium_prime',
    label: 'Premium · Prime',
    character: {
      name: 'Estate Lord Venn',
      instance: 'Prime',
      accountTier: 'premium',
      guild: 'cleric',
      skillRanks: 110,
      location: {
        title: 'Fang Cove – Commons',
        zone: 'Fang Cove',
        province: 'Ilithi',
        isTown: true,
        isSafe: true,
      },
      vitals: {
        health: 120,
        healthMax: 120,
        spirit: 120,
        spiritMax: 120,
        fatigue: 80,
        fatigueMax: 120,
      },
      situation: [],
      activity: 'Ready',
      connected: true,
    },
    inventory: {
      containers: [
        { name: 'backpack', used: 10, capacity: 35 },
        { name: 'hiertog', used: 3, capacity: 15 },
        { name: 'belt pouch', used: 2, capacity: 8 },
      ],
      wornCount: 14,
      looseCount: 0,
      pressure: 'ok',
    },
  },
  platinum_fallen: {
    id: 'platinum_fallen',
    label: 'Platinum · Fallen',
    character: {
      name: 'Platinum Shade',
      instance: 'Fallen',
      accountTier: 'platinum',
      guild: 'paladin',
      skillRanks: 150,
      location: {
        title: 'Shard – Merchants',
        zone: 'Shard',
        province: 'Ilithi',
        isTown: true,
        isSafe: true,
      },
      vitals: {
        health: 130,
        healthMax: 130,
        spirit: 130,
        spiritMax: 130,
        fatigue: 90,
        fatigueMax: 130,
      },
      situation: [],
      activity: 'Ready',
      connected: true,
    },
    inventory: {
      containers: [
        { name: 'backpack', used: 8, capacity: 35 },
        { name: 'vault-linked pack', used: 2, capacity: 20 },
      ],
      wornCount: 15,
      looseCount: 0,
      pressure: 'ok',
    },
  },
}

// Give every preset a skill spread and a favor count, derived from its level,
// so the demo exercises the same code paths the live bridge will.
for (const p of Object.values(presets)) {
  const level = p.character.skillRanks ?? 50
  p.character.skills = demoSkills(level)
  p.character.favors = Math.max(0, Math.round(level / 8))
  p.character.circle = Math.max(1, Math.round(level / 3))
  p.character.roomPlayers = level > 80 ? ['Someguy'] : []
  p.character.encumbrance = level > 100 ? 'Somewhat Burdened' : 'Light'
}

export const DEMO_PRESET_LIST = Object.values(presets).map((p) => ({
  id: p.id,
  label: p.label,
}))

export class MockBridge {
  private listeners = new Set<Listener>()
  private character: CharacterStatus = { ...presets.basic_prime.character }
  private inventory: InventorySummary = structuredClone(presets.basic_prime.inventory)
  private scripts: string[] = []
  private connected = false
  private timer: number | null = null

  connect() {
    if (this.connected) return
    this.connected = true
    this.emit({
      type: 'hello',
      protocol: 1,
      lichVersion: '5.20.1-mock',
      bridgeVersion: '0.1.0',
    })
    this.emitStatus()
    this.emit({ type: 'inventory', payload: this.inventory })
    this.emit({ type: 'log', line: 'Mock bridge connected (no live Lich).' })
    const cap = capabilitiesForCharacter(this.character)
    cap.notes.forEach((n: string) => this.emit({ type: 'log', line: `Capability: ${n}` }))
    this.timer = window.setInterval(() => {
      if (!this.connected) return
      const f = this.character.vitals.fatigue
      if (this.scripts.length > 0 && f < this.character.vitals.fatigueMax) {
        this.character = {
          ...this.character,
          vitals: {
            ...this.character.vitals,
            fatigue: Math.min(this.character.vitals.fatigueMax, f + 1),
          },
        }
        this.emitStatus()
      }
    }, 8000)
  }

  disconnect() {
    this.connected = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  loadPreset(id: DemoPresetId) {
    const p = presets[id]
    if (!p) return
    this.character = { ...p.character, connected: this.connected }
    this.inventory = structuredClone(p.inventory)
    this.scripts = []
    this.emitStatus()
    this.emit({ type: 'inventory', payload: this.inventory })
    this.emit({ type: 'scripts', payload: [] })
    this.emit({
      type: 'log',
      line: `Preset: ${p.label} (${p.character.instance} / ${p.character.accountTier})`,
    })
    capabilitiesForCharacter(this.character).notes.forEach((n: string) =>
      this.emit({ type: 'log', line: `Capability: ${n}` })
    )
  }

  onMessage(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  send(msg: BridgeClientMessage) {
    if (!this.connected) {
      this.emit({ type: 'error', message: 'Not connected' })
      return
    }
    if (msg.type === 'ping') {
      this.emit({ type: 'log', line: 'pong' })
      return
    }
    if (msg.type === 'get_status' || msg.type === 'subscribe') {
      this.emitStatus()
      return
    }
    if (msg.type === 'get_inventory') {
      this.emit({ type: 'inventory', payload: this.inventory })
      return
    }
    if (msg.type === 'intent') {
      this.handleIntent(msg.intent, msg.args)
    }
  }

  simulateLowHealth() {
    this.character = {
      ...this.character,
      vitals: { ...this.character.vitals, health: Math.max(1, Math.floor(this.character.vitals.healthMax * 0.22)) },
      situation: ['low_health'],
      activity: 'Injured',
    }
    this.emitStatus()
    this.emit({ type: 'log', line: 'Demo: health critical.', level: 'warn' })
  }

  simulateCombat() {
    this.character = {
      ...this.character,
      situation: [...new Set([...this.character.situation, 'in_combat' as const])],
      activity: 'In combat',
    }
    this.emitStatus()
    this.emit({ type: 'log', line: 'Demo: combat engaged.' })
  }

  simulateSafe() {
    this.character = {
      ...this.character,
      vitals: {
        ...this.character.vitals,
        health: this.character.vitals.healthMax,
      },
      situation: [],
      activity: 'Ready',
    }
    this.emitStatus()
    this.emit({ type: 'log', line: 'Demo: restored to safe status.' })
  }

  private handleIntent(intent: IntentName, _args?: Record<string, unknown>) {
    const block = intentBlockReason(intent, this.character)
    if (block) {
      this.emit({ type: 'intent_ack', intent, ok: false, detail: block })
      this.emit({ type: 'log', line: `Blocked: ${block}`, level: 'warn' })
      return
    }

    this.emit({ type: 'intent_ack', intent, ok: true })
    const cap = capabilitiesForCharacter(this.character)

    switch (intent) {

      case 'start_combat': {
        this.scripts = ['combat-loop']
        const sim = simulateCombatLoop(6, {
          healthPct: this.character.vitals.health / Math.max(1, this.character.vitals.healthMax),
          retreatHealth: 0.35,
          inCombat: false,
          hasTarget: false,
          lootPending: false,
        })
        sim.log.forEach((line) => this.emit({ type: 'log', line: `combat: ${line}` }))
        this.character = {
          ...this.character,
          activity: `Combat — ${describeCombatState(sim.state)}`,
        }
        this.emit({ type: 'scripts', payload: [{ name: 'combat-loop', status: 'running' }] })
        this.emitStatus()
        this.emit({
          type: 'log',
          line: 'Combat state machine (companion). Stay at keyboard. Stop always available.',
        })
        break
      }
      case 'burgle': {
        this.scripts = ['house-entry']
        const g = (this.character.guild || 'unknown').toLowerCase()
        const method = (_args?.method as string) || 'lockpick_ring'
        const maxSearches = (_args?.maxSearches as number) || 3
        const hide = _args?.hide !== false
        this.character = { ...this.character, activity: 'House entry (attended)' }
        this.emit({ type: 'scripts', payload: [{ name: 'house-entry', status: 'running' }] })
        this.emitStatus()
        this.emit({ type: 'log', line: `Entry method: ${method} · max searches ${maxSearches} · hide=${hide}` })
        if (g === 'thief') {
          this.emit({ type: 'log', line: 'Prep: stealth meditations before entry' })
        } else if (g === 'necromancer') {
          this.emit({ type: 'log', line: 'Prep: profile/visibility tools; justice risk high' })
        } else if (g === 'moon_mage') {
          this.emit({ type: 'log', line: 'Prep: invisibility support if available' })
        }
        this.emit({
          type: 'log',
          line: 'House-entry cycle (companion). Confirm no guard. Leave on footsteps. Respect cooldown.',
        })
        break
      }
      case 'travel': {
        const dest = (_args?.destination as string) || 'crossing'
        const plan = planTravel({
          destinationId: dest,
          instance: this.character.instance,
          accountTier: this.character.accountTier,
          fromArea: this.character.location?.zone || this.character.location?.title,
        })
        this.scripts = ['travel']
        if (plan && !plan.ok) {
          this.emit({
            type: 'log',
            line: `Travel blocked to ${dest}: ${plan.reasons.join('; ')}`,
            level: 'warn',
          })
          this.character = { ...this.character, activity: 'Travel blocked' }
        } else if (plan) {
          plan.steps.forEach((s) =>
            this.emit({ type: 'log', line: `  ${s.kind}: ${s.label}` })
          )
          plan.reasons.forEach((r) => this.emit({ type: 'log', line: r }))
          this.character = {
            ...this.character,
            activity: `Travel → ${plan.destination.label}`,
          }
        } else {
          this.emit({ type: 'log', line: `Unknown destination: ${dest}`, level: 'warn' })
          this.character = { ...this.character, activity: 'Travel failed' }
        }
        this.emit({ type: 'scripts', payload: [{ name: 'travel', status: 'running' }] })
        this.emitStatus()
        break
      }
      case 'escape_heal':
        this.scripts = ['uber-heal']
        this.character = { ...this.character, activity: 'Escaping → healer' }
        this.emit({ type: 'scripts', payload: [{ name: 'uber', status: 'running' }] })
        this.emitStatus()
        this.emit({ type: 'log', line: 'Escape → healer (companion mock / our healer scorer).' })
        break
      case 'stop_all':
        this.scripts = []
        this.character = { ...this.character, activity: 'Stopped' }
        this.emit({ type: 'scripts', payload: [] })
        this.emitStatus()
        this.emit({ type: 'log', line: 'All automation stopped.' })
        break
      case 'pause':
        this.character = { ...this.character, activity: 'Paused' }
        this.emitStatus()
        this.emit({ type: 'log', line: 'Automation paused.' })
        break
      case 'resume':
        this.character = { ...this.character, activity: 'Ready' }
        this.emitStatus()
        this.emit({ type: 'log', line: 'Automation resumed.' })
        break
      case 'go_healer': {
        this.character = { ...this.character, activity: 'Evaluating healers…' }
        this.emitStatus()
        this.emit({
          type: 'log',
          line: 'Scoring healers (instance + tier + path + cost)…',
        })
        const ctx = {
          instance: this.character.instance,
          accountTier: this.character.accountTier,
          mobilityScore: 55,
          preferFree: true,
        }
        const ranked = scoreHealers(ctx)
        const best = pickBestHealer(ctx)
        ranked
          .filter((r) => !r.rejected)
          .slice(0, 3)
          .forEach((r) =>
            this.emit({
              type: 'log',
              line: `  candidate ${r.option.name} score=${r.score} (${r.reasons.join('; ')})`,
            })
          )
        ranked
          .filter((r) => r.rejected)
          .slice(0, 3)
          .forEach((r) =>
            this.emit({
              type: 'log',
              line: `  rejected ${r.option.name}: ${r.reasons.join('; ')}`,
              level: 'warn',
            })
          )
        if (!best) {
          this.emit({
            type: 'log',
            line: 'No suitable healer found for this tier/instance.',
            level: 'error',
          })
          this.character = { ...this.character, activity: 'No healer route' }
          this.emitStatus()
          break
        }
        const dest = best.option.name
        window.setTimeout(() => {
          this.character = {
            ...this.character,
            activity: `Traveling to ${dest}`,
            location: {
              ...this.character.location,
              title: `${best.option.area} – ${best.option.name}`,
              isTown: true,
              isSafe: true,
            },
            vitals: {
              ...this.character.vitals,
              health: this.character.vitals.healthMax,
            },
            situation: [],
          }
          this.emitStatus()
          this.emit({
            type: 'log',
            line: `Selected: ${dest} (score ${best.score}). ${best.reasons.join('; ')}`,
          })
          window.setTimeout(() => {
            this.character = { ...this.character, activity: 'Healed — Ready' }
            this.emitStatus()
          }, 900)
        }, 1100)
        break
      }
      case 'town_run': {
        this.scripts = ['town-run']
        const plan = planTownRun(this.character.instance, this.character.accountTier, {
          needsHeal: this.character.vitals.health < this.character.vitals.healthMax,
          hasGems: true,
          hasSkins: false,
        })
        plan.skipped.forEach((s) =>
          this.emit({ type: 'log', line: `Town run skip ${s.id}: ${s.reason}`, level: 'warn' })
        )
        this.character = {
          ...this.character,
          activity: `Town run (${plan.summary})`,
        }
        this.emit({ type: 'scripts', payload: [{ name: 'town-run', status: 'running' }] })
        this.emitStatus()
        this.emit({ type: 'log', line: `Town run plan: ${plan.summary}` })
        plan.steps.forEach((s) =>
          this.emit({ type: 'log', line: `  step: ${s.label} @ ${s.area}` })
        )
        break
      }
      case 'start_training': {
        this.scripts = ['training-core']
        if (cap.expThrottled) {
          this.emit({
            type: 'log',
            line: 'Note: F2P experience is throttled — returns diminish sooner.',
            level: 'warn',
          })
        }
        if (this.character.instance === 'Fallen') {
          this.emit({ type: 'log', line: 'Using Fallen hunting data (not Prime maps).' })
        }
        const focus = (_args?.focus as string[] | undefined) || []
        const favorites = (_args?.favorites as string[] | undefined) || []
        const huntMode = (_args?.huntMode as 'suggest' | 'favorites_only' | 'manual') || 'suggest'
        const selectedHuntId = (_args?.selectedHuntId as string | null) || null
        const guild = ((_args?.guild as string) || this.character.guild || 'unknown') as GuildId
        const skillRanks =
          typeof _args?.skillRanks === 'number'
            ? (_args.skillRanks as number)
            : this.character.skillRanks ?? 50

        if (focus.length) {
          this.emit({ type: 'log', line: `Training focus: ${focus.join(', ')}` })
        }
        this.emit({
          type: 'log',
          line: `Hunt mode: ${huntMode} · guild: ${guild} · ranks ~${skillRanks}`,
        })

        const huntOpts = {
          instance: this.character.instance,
          accountTier: this.character.accountTier,
          focus,
          guild,
          skillRanks,
          favorites,
          mode: huntMode,
        }

        let best = null as ReturnType<typeof pickSuggestedHunt>
        if (huntMode === 'manual' && selectedHuntId) {
          const g = HUNTING_GROUNDS.find((x) => x.id === selectedHuntId)
          if (g) {
            best = {
              ground: g,
              score: 100,
              rejected: false,
              reasons: ['Manual pick'],
            }
            this.emit({ type: 'log', line: `Manual hunt: ${g.name}` })
          }
        } else {
          const ranked = rankHuntingGrounds(huntOpts)
          ranked
            .filter((r) => !r.rejected)
            .slice(0, 3)
            .forEach((r) =>
              this.emit({
                type: 'log',
                line: `  hunt ${r.ground.name} [${r.ground.minRanks}–${r.ground.maxRanks}] score=${r.score}`,
              })
            )
          ranked
            .filter((r) => r.rejected)
            .slice(0, 2)
            .forEach((r) =>
              this.emit({
                type: 'log',
                line: `  skip ${r.ground.name}: ${r.reasons.join('; ')}`,
                level: 'warn',
              })
            )
          best = pickSuggestedHunt(huntOpts)
        }

        const where = best ? best.ground.name : 'default training loop'
        this.character = {
          ...this.character,
          activity: `Training @ ${where}`,
          location: best
            ? {
                ...this.character.location,
                title: `${best.ground.area} – ${best.ground.name}`,
                isTown: false,
                isSafe: (best.ground.minRanks ?? 0) <= 30,
              }
            : this.character.location,
        }
        this.emit({ type: 'scripts', payload: [{ name: 'training-core', status: 'running' }] })
        this.emitStatus()
        this.emit({
          type: 'log',
          line: best
            ? `Selected: ${best.ground.name} (${best.ground.minRanks}–${best.ground.maxRanks} ranks). You're watching — Stop is always available.`
            : 'No auto hunt (manual mode or no match). Pick a ground or change mode.',
        })

        break
      }
      case 'loot':
        if (cap.inventoryPressureTight) {
          this.emit({
            type: 'log',
            line: 'Loot: selective mode (tight F2P inventory).',
            level: 'warn',
          })
        } else {
          this.emit({ type: 'log', line: 'Loot pass (mock).' })
        }
        break
      case 'buffs':
        this.emit({ type: 'log', line: 'Buff routine (mock).' })
        break
      default:
        this.emit({ type: 'log', line: `Intent received: ${intent}` })
    }
  }

  private emitStatus() {
    this.emit({
      type: 'status',
      payload: { ...this.character, connected: this.connected },
    })
  }

  private emit(msg: BridgeServerMessage) {
    this.listeners.forEach((fn) => fn(msg))
  }
}

export const mockBridge = new MockBridge()
