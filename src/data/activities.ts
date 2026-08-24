/**
 * Companion-owned activity model.
 *
 * Built from public game knowledge (Elanthipedia, general DR play patterns).
 * Does NOT incorporate, redistribute, or launch third-party paid scripts.
 * Implementation will be Lich scripts + our bridge — or user-owned Genie
 * scripts they choose to wire themselves.
 */

export type ActivityId =
  | 'train'
  | 'combat'
  | 'heal'
  | 'town'
  | 'travel'
  | 'burgle'
  | 'stop'

export interface ActivityDef {
  id: ActivityId
  title: string
  summary: string
  /** What the Companion will implement itself */
  ourPlan: string
  attendedNote: string
}

export const ACTIVITIES: ActivityDef[] = [
  {
    id: 'train',
    title: 'Train',
    summary: 'Hunt / skill training at a suitable ground for your ranks and guild.',
    ourPlan:
      'Rank-band grounds + guild risk + favorites/manual pick (our hunting module).',
    attendedNote: 'You watch combat. Stop is always available.',
  },
  {
    id: 'combat',
    title: 'Combat loop',
    summary: 'Stay in a training area: fight, loot selectively, retreat when hurt.',
    ourPlan:
      'Our own combat state machine via Lich — not a third-party combat product.',
    attendedNote: 'Attended use where TOS requires presence.',
  },
  {
    id: 'heal',
    title: 'Go heal',
    summary: 'Leave danger and reach an appropriate healer for this instance/tier.',
    ourPlan: 'Multi-factor healer scoring (already in companion).',
    attendedNote: 'Confirms path; you can Stop mid-travel.',
  },
  {
    id: 'town',
    title: 'Town chores',
    summary: 'Sell, bank, vault (if any), repair — gated by account tier.',
    ourPlan: 'Town-run planner with F2P vault/bank rules (already started).',
    attendedNote: 'Step list is visible before/while running.',
  },
  {
    id: 'travel',
    title: 'Travel',
    summary: 'Move to a city or landmark using maps and safe pathing.',
    ourPlan: 'Map/room graph via Lich maps — athletics checks when we add them.',
    attendedNote: 'Long trips still attended on restricted instances.',
  },
  {
    id: 'burgle',
    title: 'House entry training',
    summary:
      'Practice entry methods and room search on a timer — high justice risk.',
    ourPlan:
      'Our module: method (rope/lockpick), guard awareness, leave on footsteps, guild prep buffs as data — implemented by us, not by copying another script.',
    attendedNote: 'High attention. Justice and fines are real.',
  },
]

export function activityToIntent(id: ActivityId): string {
  switch (id) {
    case 'train':
      return 'start_training'
    case 'combat':
      return 'start_combat'
    case 'heal':
      return 'go_healer'
    case 'town':
      return 'town_run'
    case 'travel':
      return 'travel'
    case 'burgle':
      return 'burgle'
    case 'stop':
      return 'stop_all'
  }
}
