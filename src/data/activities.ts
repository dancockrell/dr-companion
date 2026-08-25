/**
 * Companion-owned activity model.
 *
 * Built from public game knowledge (Elanthipedia, general DR play patterns).
 * No third-party script is bundled, redistributed or launched.
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
  /**
   * The line under the button, and it is shown to a player.
   *
   * So it says what pressing this does — what it will use, what it will ask,
   * where it will stop. It used to be called `ourPlan` and held development
   * notes ("already started", "not a third-party combat product"), which is
   * roadmap talk rendered as an interface. There was an `attendedNote` beside
   * it too, reminding people of their own game's rules; nothing rendered it,
   * and nothing should have.
   */
  detail: string
}

export const ACTIVITIES: ActivityDef[] = [
  {
    id: 'train',
    title: 'Train',
    summary: 'Hunt / skill training at a suitable ground for your ranks and guild.',
    detail: 'Picks a ground for your ranks and guild. You can override it.',
  },
  {
    id: 'combat',
    title: 'Combat loop',
    summary: 'Stay in a training area: fight, loot selectively, retreat when hurt.',
    detail: "Fights, loots what you allow, and withdraws when your health drops.",
  },
  {
    id: 'heal',
    title: 'Go heal',
    summary: 'Leave danger and reach an appropriate healer for this instance/tier.',
    detail: "Picks a healer for your instance and tier, and shows the route first.",
  },
  {
    id: 'town',
    title: 'Town chores',
    summary: 'Sell, bank, vault (if any), repair — gated by account tier.',
    detail: "Plans the stops, gated by what your account can actually use.",
  },
  {
    id: 'travel',
    title: 'Travel',
    summary: 'Move to a city or landmark using maps and safe pathing.',
    detail: "Routes over Lich's maps and shows the path before moving.",
  },
  {
    id: 'burgle',
    title: 'House entry training',
    summary:
      'Practice entry methods and room search on a timer — high justice risk.',
    detail: "Entry method, guard checks, and leaves on footsteps. Justice risk is real.",
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
