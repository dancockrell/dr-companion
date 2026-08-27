/**
 * Mock bridge — simulates Lich status stream for UI development
 * without a live game connection.
 */

import type { CharacterStatus, InventorySummary } from '../types'
import type { BridgeClientMessage, BridgeServerMessage, IntentName } from './types'
import {
  capabilitiesForCharacter,
  intentBlockReason,
  intentWarnings,
} from '../lib/accountCapabilities'
import {
  pickBestHealer,
  scoreHealers,
  chooseHealer,
  type HealCityId,
} from '../data/healers'
import { planTownRun } from '../data/townRun'
import { pickSuggestedHunt, rankHuntingGrounds, HUNTING_GROUNDS } from '../data/hunting'
import { simulateCombatLoop, describeCombatState } from '../data/combatMachine'
import { planTravel } from '../data/travelPath'
import type { GuildId } from '../data/hunting'
import { ranksOf, type SkillState, SKILLS_BY_SET, SKILL_SETS } from '../data/skills'
import { effectiveAthletics } from '../data/obstacles'
import { DEMO_ZONE, demoPath } from '../data/demoMap'
import { loadZone, DEFAULT_ZONE } from '../lib/mapData'
import { loadPrefs, savePrefs } from '../lib/persistence'

type Listener = (msg: BridgeServerMessage) => void

/**
 * Build a plausible skill spread for a demo character.
 *
 * Deliberately uneven: a couple of skills near mind lock, a couple with room.
 * A flat spread would make the training panel look pointless, and the whole
 * point of the mechanic is that skills diverge.
 */
function demoSkills(level: number): SkillState[] {
  // Past the early game, train everything the guild allows. Best practice in
  // DragonRealms is to keep every skill your class can use in rotation, so a
  // demo showing a dozen is not testing the board it claims to test.
  if (level >= 40) {
    let seed = 7
    const roll = (n: number) => {
      // Deterministic, so the demo does not reshuffle on every render.
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    return SKILL_SETS.flatMap((set) =>
      SKILLS_BY_SET[set].map((name) => ({
        name,
        skillset: set,
        ranks: Math.round(level * (0.5 + roll(60) / 100)),
        // Spread across the whole 0-34 range so every band appears: pools
        // about to fall out, pools absorbing, pools at mind lock.
        mindstate: roll(35),
      }))
    )
  }

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

export type DemoPresetId = 'basic_prime' | 'f2p_prime' | 'fallen_sub' | 'premium_prime' | 'platinum_fallen' | 'bard_prime'

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
        mana: 0,
        manaMax: 100,
      },
      hands: { right: 'a serrated broadsword', left: null },
      spells: [],
      roundtime: 0,
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
        mana: 0,
        manaMax: 90,
      },
      hands: { right: null, left: null },
      spells: [],
      roundtime: 0,
      situation: ['hidden'],
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
        mana: 34,
        manaMax: 110,
        concentration: 78,
        concentrationMax: 110,
      },
      hands: { right: 'a bone-handled dagger', left: 'a tattered grimoire' },
      spells: [
        { name: 'Eyes of the Blind', minutes: 1 },
        { name: 'Sanctuary', minutes: 4 },
        { name: 'Philosophers Preservation', minutes: 47 },
      ],
      roundtime: 0,
      situation: ['poisoned'],
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
        mana: 96,
        manaMax: 120,
      },
      hands: { right: 'a blessed mace', left: 'a wooden shield' },
      spells: [{ name: 'Benediction', minutes: 12 }],
      roundtime: 0,
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
        mana: 61,
        manaMax: 130,
      },
      hands: { right: 'a longsword', left: 'a tower shield' },
      spells: [{ name: 'Aegis of Faith', minutes: 22 }],
      roundtime: 0,
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

  /**
   * A real character, and the reason this preset exists is that the other five
   * are not.
   *
   * Every one of them hits things for a living. Barbarian, necromancer,
   * paladin, and levels from 55 to 150 - a spread that looks varied and is
   * one shape. So the app quietly assumed for its whole life that a
   * DragonRealms character is somebody with weapon skills and a mana pool, and
   * nothing on screen ever disagreed.
   *
   * One evening on a live Bard found four things that had been invisible the
   * entire time: training is modelled as combat only, so a guild that trains
   * Performance in a town street has nothing to press; concentration was
   * reported out of a hardcoded 100 when this character has 330; PLAY is
   * unmodelled despite the game stating a clean 32-song by 18-mood difficulty
   * grid; and a worn helm silently penalises wind instruments with no message
   * anywhere.
   *
   * A mock is not neutral scaffolding. It is a design assumption with a face
   * on it, and this one is here to disagree with the other five rather than to
   * replace them. Numbers below are Phemius as observed on 27 Aug 2026, not
   * invented: Circle 1, 330 concentration, 27 TDPs, and the 1146 Kronar
   * character-creation debt that every new character carries and almost none
   * of them notice.
   */
  bard_prime: {
    id: 'bard_prime',
    label: 'Bard · Circle 1',
    character: {
      name: 'Phemius',
      instance: 'Prime',
      accountTier: 'basic',
      guild: 'bard',
      // Kaldar, observed. Not the Gor'Tog the loop hands to every other preset
      // for portrait-matching: this one is a real character and its race is a
      // fact rather than a convenient default.
      race: 'Kaldar',
      // Circle 1, observed. The loop would derive 2 from the rank count, and
      // this preset exists precisely so the app renders a real beginner.
      circle: 1,
      // The lowest rank count any preset has carried by a wide margin, which
      // is also the point: the app had never rendered a beginner.
      skillRanks: 5,
      location: {
        title: 'Crossing – Firulf Vista',
        zone: 'Crossing',
        province: 'Zoluren',
        isTown: true,
        isSafe: true,
      },
      vitals: {
        // Four percentages and one pool that is not one. Concentration is the
        // whole reason this preset's vitals are worth reading: 330 against a
        // max of 330, where the bridge used to report every maximum as 100.
        health: 100,
        healthMax: 100,
        spirit: 100,
        spiritMax: 100,
        fatigue: 96,
        fatigueMax: 100,
        mana: 100,
        manaMax: 100,
        concentration: 330,
        concentrationMax: 330,
      },
      // A wind instrument, which is what makes the helm penalty visible.
      hands: { right: 'a cocobolo txistu', left: null },

      /**
       * Its own spread, because a level cannot tell you a guild.
       *
       * Performance is the observed one, verbatim off the EXP window:
       *
       *   Performance:      5 07% perusing       (2/34)
       *
       * Five ranks, mindstate 2 of 34, gained in a town street with an
       * instrument out of the character's own pack. No creature, no weapon.
       * That row is the whole argument for issue 11: a third of the guilds
       * train on skills the app has no concept of, and this is what one looks
       * like.
       *
       * The rest are plausible for Circle 1 rather than observed, and are here
       * so the training board has a spread to sort rather than a single row.
       * If somebody reads real numbers off a live Bard, replace them.
       */
      skills: [
        { name: 'Performance', skillset: 'Lore', ranks: 5, mindstate: 2 },
        { name: 'Appraisal', skillset: 'Lore', ranks: 1, mindstate: 0 },
        { name: 'Scholarship', skillset: 'Lore', ranks: 2, mindstate: 1 },
        { name: 'Small Edged', skillset: 'Weapon', ranks: 1, mindstate: 0 },
        { name: 'Light Armor', skillset: 'Armor', ranks: 1, mindstate: 0 },
        { name: 'Evasion', skillset: 'Survival', ranks: 2, mindstate: 3 },
        { name: 'Perception', skillset: 'Survival', ranks: 1, mindstate: 0 },
        { name: 'Athletics', skillset: 'Survival', ranks: 1, mindstate: 0 },
        { name: 'Primary Magic', skillset: 'Magic', ranks: 2, mindstate: 4 },
        { name: 'Elemental Magic', skillset: 'Magic', ranks: 1, mindstate: 0 },
      ],

      spells: [],
      roundtime: 0,
      situation: [],
      activity: 'Ready',
      connected: true,
    },
    inventory: {
      containers: [{ name: 'carpetbag', used: 3, capacity: 20 }],
      // Observed on Phemius, and the helm is the reason this list exists: worn
      // with a wind instrument in hand, it silently slows Performance and the
      // game says so exactly once, when you play.
      worn: [
        'a coarse onyx-hide helm',
        'a sleek cinnabar brigandine hauberk riveted with rose gold studs',
        'a divine charm',
        'a carved wooden amulet',
      ],
      wornCount: 4,
      looseCount: 0,
      pressure: 'ok',
    },
  },
}

// Give every preset a skill spread and a favor count, derived from its level,
// so the demo exercises the same code paths the live bridge will.
//
// A preset may bring its own spread instead. `demoSkills` derives one from a
// level alone, and a level does not know what guild it belongs to: below 40 it
// hands back Small Edged, Large Edged, Parry Ability and Shield Usage to
// whoever asks. That is a fine beginner warrior and a completely wrong Bard,
// and handing a Bard a weapon spread is precisely the assumption this preset
// was added to break.
for (const p of Object.values(presets)) {
  const level = p.character.skillRanks ?? 50
  p.character.skills = p.character.skills ?? demoSkills(level)
  p.character.favors = Math.max(0, Math.round(level / 8))
  // Derived from the level, unless the preset knows better. It was
  // unconditional, which quietly overwrote an observed Circle 1 with a
  // computed 2 - and a fabricated number that looks plausible is worse than an
  // obviously missing one, because nothing about it invites checking.
  p.character.circle = p.character.circle ?? Math.max(1, Math.round(level / 3))
  p.character.roomPlayers = level > 80 ? ['Someguy'] : []
  p.character.encumbrance = level > 100 ? 'Somewhat Burdened' : 'Light'
  // Enough creatures to push the deck through its tiers rather than only ever
  // showing the roomy case. Names are real DragonRealms creatures at roughly
  // the right level, so the bestiary lookup has something to find.
  p.character.roomCreatures = demoCreatures(level)
  p.character.roomDeadCreatures = level > 30 ? ['a kobold which appears dead'] : []
  p.character.injuries = demoInjuries(level)
  // A race, so the portrait has something to match. Every demo preset is a
  // Gor'Tog because it is the least generic-looking of the eleven and shows
  // immediately whether the matching works.
  p.character.race = p.character.race ?? 'Gor'+String.fromCharCode(39)+'Tog'
  p.character.roomItems =
    level > 20 ? ['a kobold skin', 'some copper kronars', 'a rusty dagger'] : []
}

/**
 * A plausible room for a character of this level.
 *
 * Duplicated nouns on purpose: collapsing six identical goblins into one card
 * with a multiplier is a behaviour worth seeing in the demo, because six
 * separate cards is a wall rather than information.
 */
function demoCreatures(level: number): string[] {
  if (level < 20) return ['a kobold', 'a kobold', 'a goblin']
  if (level < 60) {
    return [
      'a snarling goblin',
      'a snarling goblin',
      'a snarling goblin',
      'a rock troll',
      'a wild boar',
    ]
  }
  return [
    "an Adan'f blood warrior",
    "an Adan'f blood warrior",
    "an Adan'f shadow mage",
    'a rock troll',
    'a wild boar',
    'a kobold',
    'a goblin',
    'a giant rat',
  ]
}

/** A few wounds past the early levels, so the doll is not always blank. */
function demoInjuries(level: number) {
  if (level < 20) return {}
  const injuries: Record<string, { wound: 0 | 1 | 2 | 3; scar: 0 | 1 | 2 | 3 }> = {
    leftArm: { wound: 1, scar: 0 },
    chest: { wound: level > 60 ? 2 : 1, scar: 1 },
  }
  if (level > 60) injuries.head = { wound: 1, scar: 0 }
  if (level > 100) injuries.nsys = { wound: 2, scar: 0 }
  return injuries
}

export const DEMO_PRESET_LIST = Object.values(presets).map((p) => ({
  id: p.id,
  label: p.label,
}))

export class MockBridge {
  private listeners = new Set<Listener>()
  /**
   * Whoever was chosen last, not always the barbarian.
   *
   * Read at construction rather than applied later, so the first status the app
   * ever sees is already the right character. Applying it after connect made
   * the dashboard render one character and then swap, which looks like a bug
   * and briefly is one - every panel reading the first payload gets it wrong.
   */
  private static initial(): DemoPresetId {
    const saved = loadPrefs().demoPreset
    return saved && saved in presets ? (saved as DemoPresetId) : 'basic_prime'
  }

  /**
   * Which gates the mock claims. Settable so the degraded state can be looked
   * at without breaking a real bridge to produce it.
   */
  private authMode: 'token' | 'origin-only' = 'token'

  setAuthMode(mode: 'token' | 'origin-only') {
    this.authMode = mode
  }

  private character: CharacterStatus = { ...presets[MockBridge.initial()].character }
  private inventory: InventorySummary = structuredClone(presets[MockBridge.initial()].inventory)
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
      // Reported, because a mock that cannot reach a state means that state is
      // unreachable in development. The origin-only branch existed for an hour
      // with no way to see it outside a real bridge that had failed to write a
      // token - which is not a thing anybody can arrange on demand.
      auth: this.authMode,
      authNote: this.authMode === 'origin-only' ? 'mock: token withheld' : '',
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
    savePrefs({ demoPreset: id })
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
      situation: [
        ...new Set([
          ...this.character.situation,
          'in_combat' as const,
          // The flags a real fight actually produces, rather than one. The
          // status board sorts by seriousness and there is no way to see that
          // it does with a single flag set.
          'prone' as const,
          'bleeding' as const,
        ]),
      ],
      // A live roundtime, because the whole point of the meter is that it
      // counts down and a demo that sets zero cannot show that.
      roundtime: 5,
      activity: 'In combat',
    }
    this.emitStatus()
    this.emit({ type: 'log', line: 'Demo: combat engaged.' })

    // Second push a moment later with the clock advanced, which is how the
    // real bridge behaves: it re-reports rather than streaming a countdown.
    window.setTimeout(() => {
      if (!this.connected) return
      this.character = { ...this.character, roundtime: 2.4 }
      this.emitStatus()
    }, 2600)
  }

  /**
   * Pretend a command got no reply the bridge recognised.
   *
   * This is the failure the console exists for, and it needs to be reachable
   * in demo mode so the report flow can be exercised before anyone is in game.
   */
  simulateBrokenPattern() {
    this.trace('send', 'stow sword')
    this.trace(
      'no_match',
      'stow sword — nothing matched /You put/ or /You (?:can.t|cannot)/ in 6s'
    )
    this.emit({
      type: 'log',
      line: 'stow: no reply the bridge recognised. This is a pattern bug.',
      level: 'warn',
    })
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
      this.trace('refused', `: `)
      this.emit({ type: 'intent_ack', intent, ok: false, detail: block })
      this.emit({ type: 'log', line: `Blocked: ${block}`, level: 'warn' })
      return
    }

    this.trace('send', `intent ${intent}`)
    this.emit({ type: 'intent_ack', intent, ok: true })

    // Things worth knowing that are not reasons to refuse.
    intentWarnings(intent, this.character).forEach((w) =>
      this.emit({ type: 'log', line: w, level: 'warn' })
    )

    const cap = capabilitiesForCharacter(this.character)

    switch (intent) {
      // Map queries, answered from an invented zone. data/demoMap.ts explains
      // why it is invented rather than a copy of real geography.
      case 'map_zone':
        // The real Crossing, 1,060 rooms, not a twelve-room sketch. The demo is
        // where most people meet this app, and a toy map tells them nothing
        // about whether the real one is any good.
        void loadZone(DEFAULT_ZONE).then((zone) => {
          this.emit({
            type: 'map_zone',
            payload: zone
              ? { ...zone, here: zone.rooms?.[0]?.id ?? null }
              : DEMO_ZONE,
          })
        })
        break

      case 'map_here': {
        const here = DEMO_ZONE.rooms?.find((r) => r.id === DEMO_ZONE.here)
        this.emit({
          type: 'map_here',
          payload: {
            available: true,
            id: here?.id ?? null,
            uid: here?.uid ?? null,
            title: here?.title ?? null,
            location: DEMO_ZONE.name ?? null,
            tags: here?.tags ?? [],
            exits: (here?.to ?? []).map(String),
          },
        })
        break
      }

      case 'map_tags':
        this.emit({
          type: 'map_tags',
          payload: [...new Set(DEMO_ZONE.rooms!.flatMap((r) => r.tags ?? []))].sort(),
        })
        break

      case 'map_nearest': {
        const tag = String(_args?.tag ?? '')
        const hit = DEMO_ZONE.rooms?.find((r) => r.tags?.includes(tag))
        if (!hit) {
          this.emit({
            type: 'map_nearest',
            payload: {
              ok: false,
              id: null,
              uid: null,
              title: null,
              location: null,
              reason: `nothing tagged ${tag} is reachable`,
            },
          })
          break
        }
        this.emit({
          type: 'map_nearest',
          payload: {
            ok: true,
            tag,
            id: hit.id,
            uid: hit.uid,
            title: hit.title,
            location: DEMO_ZONE.name ?? null,
            steps: demoPath(DEMO_ZONE.here as number, hit.id as number)?.length ?? null,
          },
        })
        break
      }

      case 'map_path': {
        const to = Number(_args?.to ?? 0)
        const route = demoPath(DEMO_ZONE.here as number, to)
        this.emit({
          type: 'map_path',
          payload: route
            ? {
                ok: true,
                from: DEMO_ZONE.here,
                to,
                steps: route.length,
                rooms: route.map((id) => {
                  const r = DEMO_ZONE.rooms!.find((x) => x.id === id)!
                  return {
                    id: r.id,
                    uid: r.uid,
                    title: r.title,
                    location: DEMO_ZONE.name ?? null,
                  }
                }),
              }
            : { ok: false, reason: `no route from ${DEMO_ZONE.here} to ${to}` },
        })
        break
      }

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
        // Paused, and said so per script. The status was always in this payload
        // and the store dropped it, so the mock could not reproduce the one
        // state where "running: combat-loop" is a lie.
        this.emit({
          type: 'scripts',
          payload: this.scripts.map((name) => ({ name, status: 'paused' })),
        })
        this.emitStatus()
        this.emit({ type: 'log', line: 'Automation paused.' })
        break
      case 'resume':
        this.character = { ...this.character, activity: 'Ready' }
        this.emit({
          type: 'scripts',
          payload: this.scripts.map((name) => ({ name, status: 'running' })),
        })
        this.emitStatus()
        this.emit({ type: 'log', line: 'Automation resumed.' })
        break

      // The bridge has answered this since 0.7.0 with a structured file list
      // and nothing ever asked it to. Mocked so the panel can be seen without
      // a dr-scripts install, including the broken-file case, which is the one
      // the panel actually exists for.
      case 'read_settings': {
        const who = this.character.name.split(' ')[0]
        this.emit({
          type: 'settings',
          character: this.character.name,
          files: [
            {
              path: 'C:/lich5/scripts/dr-scripts/profiles/base.yaml',
              name: 'base.yaml',
              bytes: 41_300,
              kind: 'defaults',
              ok: true,
              count: 8,
              keys: [
                'bag',
                'bag_items',
                'combat_trainer_badly_wounded_threshold',
                'dance_skill',
                'hunting_room_id',
                'safe_room_id',
                'training_list',
                'waggle_sets',
              ],
            },
            {
              path: `C:/lich5/scripts/dr-scripts/profiles/${who}-setup.yaml`,
              name: `${who}-setup.yaml`,
              bytes: 8_940,
              kind: 'yours',
              ok: true,
              count: 4,
              keys: ['bag', 'hunting_room_id', 'safe_room_id', 'training_list'],
            },
            {
              path: `C:/lich5/scripts/dr-scripts/profiles/${who}-combat.yaml`,
              name: `${who}-combat.yaml`,
              bytes: 3_120,
              kind: 'yours',
              ok: false,
              error: 'mapping values are not allowed in this context',
              line: 41,
              column: 12,
            },
          ],
        })
        this.emit({
          type: 'log',
          line: 'Settings: one file will not parse, so dr-scripts is running on defaults for it.',
          level: 'error',
        })
        break
      }
      case 'go_healer': {
        this.character = { ...this.character, activity: 'Evaluating healers…' }
        this.emitStatus()
        const preferredCity =
          (_args?.preferredCity as HealCityId | null | undefined) ?? null

        // Mobility from Athletics and burden rather than a hardcoded 55, now
        // that the bridge reports per-skill ranks.
        const athletics = this.character.skills
          ? ranksOf(this.character.skills, 'Athletics')
          : 0
        const mobilityScore = effectiveAthletics({
          athleticsRanks: athletics,
          encumbrance: this.character.encumbrance,
          guild: this.character.guild,
        })

        const ctx = {
          instance: this.character.instance,
          accountTier: this.character.accountTier,
          mobilityScore,
          preferFree: true,
          preferredCity,
        }

        // The player's own choice wins; scoring is the fallback and says so.
        const choice = chooseHealer(ctx)
        choice.reasons.forEach((r) => this.emit({ type: 'log', line: r }))
        this.emit({
          type: 'log',
          line: `Athletics ${athletics} (effective ${mobilityScore} after burden).`,
        })

        const ranked = scoreHealers(ctx)
        const best = choice.option
          ? (ranked.find((r) => r.option.id === choice.option!.id) ??
            pickBestHealer(ctx))
          : pickBestHealer(ctx)
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

  /**
   * Emit a trace row, so the console can be exercised in demo mode.
   *
   * The real diagnostic value is against a live game, but a tester should be
   * able to see what the console does before they get there.
   */
  private trace(kind: string, detail: string) {
    this.emit({
      type: 'trace',
      row: { at: new Date().toLocaleTimeString(), kind, detail },
    })
  }

  private emit(msg: BridgeServerMessage) {
    this.listeners.forEach((fn) => fn(msg))
  }
}

export const mockBridge = new MockBridge()
