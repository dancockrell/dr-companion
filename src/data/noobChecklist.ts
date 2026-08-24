/**
 * Total-noob prerequisites from common public DR new-player guidance.
 * Companion SetupWizard / Standard mode can surface these.
 */

export interface ChecklistItem {
  id: string
  category: 'gear' | 'stats' | 'magic' | 'money' | 'config' | 'plugins'
  label: string
  detail: string
  priority: 'required' | 'recommended'
}

export const NOOB_CHECKLIST: ChecklistItem[] = [
  {
    id: 'weapons',
    category: 'gear',
    label: 'Weapons sorted',
    detail:
      'Train multiple weapons from the start. Prefer multi-skill weapons (riste, throwing club, bastard sword) to save weight.',
    priority: 'required',
  },
  {
    id: 'containers',
    category: 'gear',
    label: '3–4 large containers',
    detail:
      'Automation needs distinct main bags. Separate gem-pouch / repair-kit containers that stay closed.',
    priority: 'required',
  },
  {
    id: 'armor',
    category: 'gear',
    label: 'Armor set (clown suit optional)',
    detail:
      'All armor types for TDPs is efficient but high hindrance early. NOOB.ARMOR can swap to light for stealth routines.',
    priority: 'required',
  },
  {
    id: 'skinning',
    category: 'gear',
    label: 'Worn skinning knife',
    detail: 'Wrist / ankle / belt worn preferred over held knife.',
    priority: 'recommended',
  },
  {
    id: 'str_stam',
    category: 'stats',
    label: 'Strength + Stamina first',
    detail:
      'Dump early TDPs into STR and STAM until burden is light/none. Heavy encumbrance is the noob killer.',
    priority: 'required',
  },
  {
    id: 'stances',
    category: 'config',
    label: 'Custom stances',
    detail: 'Default stances are weak — set them up before serious combat.',
    priority: 'required',
  },
  {
    id: 'cambrinth',
    category: 'magic',
    label: 'Cambrinth (magic users)',
    detail: 'Cambrinth in variables if you use magic. Ritual focus needed for ritual spells.',
    priority: 'recommended',
  },
  {
    id: 'guild_spells',
    category: 'magic',
    label: 'Guild leader visit',
    detail: 'Script does not auto-circle or buy spells. Visit guild for new abilities.',
    priority: 'recommended',
  },
  {
    id: 'bank_plats',
    category: 'money',
    label: 'Plats in major banks',
    detail:
      'Crossing / Leth / Haven hubs — ~3–5 plat each for ferries. Script does not move money between banks.',
    priority: 'required',
  },
  {
    id: 'uber_vars',
    category: 'config',
    label: 'Combat/training variables filled',
    detail: 'Weapons, containers, spells, training targets, heal/town toggles.',
    priority: 'required',
  },
  {
    id: 'plugins',
    category: 'plugins',
    label: 'Genie plugins',
    detail: 'Spell timer, exp tracker, circle calculator; time tracker for Moon Mages.',
    priority: 'required',
  },
  {
    id: 'burgle_vars',
    category: 'config',
    label: 'House-entry preferences per character',
    detail: 'Entry method, pack, search count, hide, rooms to skip, sell location.',
    priority: 'recommended',
  },
]
