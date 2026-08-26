/**
 * Common macros, with variations.
 *
 * These are the commands a player types dozens of times an hour. Every one is
 * a real DragonRealms command, and each carries variations because there is
 * rarely one right answer: how you heal depends on whether you are an Empath,
 * whether anyone is around to help, and how badly you are hurt.
 *
 * The variations are the point. A single Healer button has to guess, and a
 * guess that walks you across town when you wanted to tend a scratch is worse
 * than no button at all. Choosing a variation sets the default for that slot,
 * so the bar becomes the player's own rather than ours.
 */

export interface MacroVariation {
  id: string
  label: string
  /** Sent to the game verbatim, one line each. */
  commands: string[]
  /** Why you would pick this one over its siblings. */
  note?: string
}

export interface Macro {
  id: string
  label: string
  /** Lucide icon name, resolved by the bar. */
  icon: string
  group: 'combat' | 'health' | 'goods' | 'magic' | 'travel' | 'info'
  variations: MacroVariation[]
}

export const MACROS: Macro[] = [
  {
    id: 'attack',
    label: 'Attack',
    icon: 'Swords',
    group: 'combat',
    variations: [
      { id: 'attack', label: 'Attack', commands: ['attack'], note: 'Whatever is in front of you.' },
      { id: 'advance', label: 'Advance', commands: ['advance'], note: 'Close the gap first.' },
      { id: 'aim', label: 'Aimed', commands: ['aim head', 'attack'], note: 'Slower, lands where you chose.' },
      { id: 'ambush', label: 'Ambush', commands: ['ambush'], note: 'From hiding.' },
    ],
  },
  {
    id: 'retreat',
    label: 'Retreat',
    icon: 'ShieldOff',
    group: 'combat',
    variations: [
      { id: 'retreat', label: 'Retreat', commands: ['retreat'], note: 'Back out of melee.' },
      { id: 'retreat-twice', label: 'Retreat twice', commands: ['retreat', 'retreat'], note: 'Out of pole range too.' },
      { id: 'flee', label: 'Flee', commands: ['retreat', 'flee'], note: 'Leave the room entirely.' },
    ],
  },
  {
    id: 'stance',
    label: 'Stance',
    icon: 'Shield',
    group: 'combat',
    variations: [
      { id: 'defensive', label: 'Defensive', commands: ['stance defensive'], note: 'Survive first.' },
      { id: 'guarded', label: 'Guarded', commands: ['stance guarded'], note: 'The usual compromise.' },
      { id: 'offensive', label: 'Offensive', commands: ['stance offensive'], note: 'Kill faster, get hit more.' },
    ],
  },
  {
    id: 'heal',
    label: 'Heal',
    icon: 'Heart',
    group: 'health',
    variations: [
      { id: 'tend', label: 'Tend', commands: ['tend my worst'], note: 'Stop the bleeding yourself.' },
      { id: 'empath', label: 'Find an empath', commands: ['who'], note: 'See who could heal you.' },
      { id: 'healer', label: 'Go to healer', commands: ['go healer'], note: 'Walk to the healerie.' },
      { id: 'sleep', label: 'Sleep it off', commands: ['sleep'], note: 'Slow, free, safe indoors.' },
    ],
  },
  {
    id: 'wounds',
    label: 'Wounds',
    icon: 'Activity',
    group: 'health',
    variations: [
      { id: 'health', label: 'Health', commands: ['health'], note: 'What is hurt and how badly.' },
      { id: 'diagnose', label: 'Diagnose', commands: ['diagnose'], note: 'A fuller reading.' },
      { id: 'perceive', label: 'Perceive health', commands: ['perceive health'], note: 'Empaths only.' },
    ],
  },
  {
    id: 'loot',
    label: 'Loot',
    icon: 'Package',
    group: 'goods',
    variations: [
      { id: 'all', label: 'Take all', commands: ['get all'], note: 'Everything on the floor.' },
      { id: 'skin', label: 'Skin', commands: ['skin'], note: 'The corpse you are standing over.' },
      { id: 'coins', label: 'Coins only', commands: ['get coins'], note: 'Leave the rest.' },
      { id: 'stow', label: 'Stow all', commands: ['stow all'], note: 'Empty your hands.' },
    ],
  },
  {
    id: 'wealth',
    label: 'Wealth',
    icon: 'Coins',
    group: 'goods',
    variations: [
      { id: 'wealth', label: 'Wealth', commands: ['wealth'], note: 'What you are carrying.' },
      { id: 'bank', label: 'Bank', commands: ['go bank'], note: 'Walk to the teller.' },
      { id: 'appraise', label: 'Appraise', commands: ['appraise my'], note: 'What is it worth.' },
    ],
  },
  {
    id: 'prep',
    label: 'Prepare',
    icon: 'Sparkles',
    group: 'magic',
    variations: [
      { id: 'prep', label: 'Prepare', commands: ['prepare'], note: 'Your last spell again.' },
      { id: 'harness', label: 'Harness', commands: ['harness 20'], note: 'Pull mana first.' },
      { id: 'perceive', label: 'Perceive', commands: ['perceive'], note: 'Read the mana streams.' },
      { id: 'release', label: 'Release', commands: ['release'], note: 'Drop what you were holding.' },
    ],
  },
  {
    id: 'buffs',
    label: 'Buffs',
    icon: 'Star',
    group: 'magic',
    variations: [
      { id: 'spells', label: 'Active spells', commands: ['spells'], note: 'What is still running.' },
      { id: 'refresh', label: 'Refresh', commands: ['spell refresh'], note: 'Re-cast what lapsed.' },
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: 'Navigation',
    group: 'travel',
    variations: [
      { id: 'town', label: 'Town run', commands: ['town'], note: 'Repair, sell, bank, restock.' },
      { id: 'safe', label: 'Safe room', commands: ['go safe'], note: 'Somewhere nothing attacks.' },
      { id: 'guild', label: 'Guild', commands: ['go guild'], note: 'Your own guildhall.' },
      { id: 'exits', label: 'Exits', commands: ['exits'], note: 'Where can I go from here.' },
    ],
  },
  {
    id: 'exp',
    label: 'Experience',
    icon: 'Brain',
    group: 'info',
    variations: [
      { id: 'exp', label: 'Experience', commands: ['exp'], note: 'Every pool at once.' },
      { id: 'mod', label: 'Learning', commands: ['exp mod'], note: 'Only what is moving.' },
      { id: 'skills', label: 'Skills', commands: ['skills'], note: 'Ranks rather than pools.' },
      { id: 'info', label: 'TDPs', commands: ['info'], note: 'What you have to spend.' },
    ],
  },
  {
    id: 'look',
    label: 'Look',
    icon: 'Eye',
    group: 'info',
    variations: [
      { id: 'look', label: 'Look', commands: ['look'], note: 'The room again.' },
      { id: 'inventory', label: 'Inventory', commands: ['inventory'], note: 'What you are carrying.' },
      { id: 'self', label: 'Yourself', commands: ['look at me'], note: 'How you appear to others.' },
      { id: 'who', label: 'Who', commands: ['who'], note: 'Everyone online.' },
    ],
  },
]

/** The variation a slot uses until the player picks another. */
export const DEFAULT_CHOICE: Record<string, string> = Object.fromEntries(
  MACROS.map((m) => [m.id, m.variations[0].id])
)
