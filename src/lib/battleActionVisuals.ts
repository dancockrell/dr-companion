import * as Icons from 'lucide-react'
import { MACROS } from '../data/macros'
import { PIN_COLORS, type PinColor } from './mapPins'

/** One deliberate symbol for every basic game command variation. */
const ACTION_ICONS: Record<string, Icons.LucideIcon> = {
  'attack:attack': Icons.Sword,
  'attack:advance': Icons.MoveUpRight,
  'attack:aim': Icons.Crosshair,
  'attack:ambush': Icons.ScanLine,
  'retreat:retreat': Icons.ChevronLeft,
  'retreat:retreat-twice': Icons.ChevronsLeft,
  'retreat:flee': Icons.DoorOpen,
  'stance:defensive': Icons.ShieldCheck,
  'stance:guarded': Icons.ShieldHalf,
  'stance:offensive': Icons.Swords,
  'heal:tend': Icons.HandHeart,
  'heal:empath': Icons.UserRoundSearch,
  'heal:healer': Icons.Hospital,
  'heal:sleep': Icons.BedSingle,
  'wounds:health': Icons.HeartPulse,
  'wounds:diagnose': Icons.Stethoscope,
  'wounds:perceive': Icons.ScanHeart,
  'search:search': Icons.ScanSearch,
  'stalk:stalk': Icons.Footprints,
  'stalk:stalk-off': Icons.CircleStop,
  'stealth:hide': Icons.EyeOff,
  'stealth:sneak': Icons.VenetianMask,
  'loot:all': Icons.PackagePlus,
  'loot:skin': Icons.Scissors,
  'loot:coins': Icons.HandCoins,
  'loot:stow': Icons.ArchiveRestore,
  'wealth:wealth': Icons.WalletCards,
  'wealth:bank': Icons.Landmark,
  'wealth:appraise': Icons.Scale,
  'prep:prep': Icons.Sparkles,
  'prep:harness': Icons.Orbit,
  'prep:perceive': Icons.RadioTower,
  'prep:release': Icons.Unplug,
  'buffs:spells': Icons.ListChecks,
  'buffs:refresh': Icons.RefreshCw,
  'travel:town': Icons.Building2,
  'travel:safe': Icons.House,
  'travel:guild': Icons.GraduationCap,
  'travel:exits': Icons.SignpostBig,
  'exp:exp': Icons.TrendingUp,
  'exp:mod': Icons.BrainCircuit,
  'exp:skills': Icons.ChartNoAxesColumnIncreasing,
  'exp:info': Icons.BadgePlus,
  'look:look': Icons.Eye,
  'look:inventory': Icons.Backpack,
  'look:self': Icons.UserRound,
  'look:who': Icons.UsersRound,
}

export const ACTION_KEYS = MACROS.flatMap((macro) =>
  macro.variations.map((variation) => `${macro.id}:${variation.id}`)
)
const ACTION_INDEX = new Map(ACTION_KEYS.map((key, index) => [key, index]))

/**
 * The map and the command library use one color language. Shape identifies
 * the exact action; color answers the faster question, "what family will this
 * do?" These anchors are the HSL equivalents of the six map-pin colors, with
 * tiny per-action shifts so neighboring controls remain individually legible.
 */
const TONE_HSL: Record<PinColor, readonly [number, number, number]> = {
  blue: [215, 70, 60],
  gold: [43, 63, 53],
  green: [139, 39, 49],
  red: [3, 70, 59],
  purple: [266, 55, 66],
  slate: [220, 14, 60],
}

const ACTION_TONE: Record<string, PinColor> = {
  attack: 'red',
  retreat: 'red',
  stance: 'red',
  heal: 'green',
  wounds: 'green',
  search: 'gold',
  stalk: 'gold',
  stealth: 'gold',
  loot: 'gold',
  wealth: 'gold',
  prep: 'purple',
  buffs: 'purple',
  travel: 'blue',
  exp: 'slate',
  look: 'slate',
}

const missingVisuals = ACTION_KEYS.filter((key) => !ACTION_ICONS[key])
const extraVisuals = Object.keys(ACTION_ICONS).filter((key) => !ACTION_INDEX.has(key))
const duplicateIcons = ACTION_KEYS.length - new Set(ACTION_KEYS.map((key) => ACTION_ICONS[key])).size
if (missingVisuals.length || extraVisuals.length || duplicateIcons) {
  throw new Error(
    `Battle action visual contract failed: missing=${missingVisuals.join(',')} extra=${extraVisuals.join(',')} duplicateIcons=${duplicateIcons}`
  )
}

export function actionIcon(key: string): Icons.LucideIcon {
  return ACTION_ICONS[key]
}

function paletteAccent(tone: PinColor, variant: number) {
  const [anchorHue, saturation, lightness] = TONE_HSL[tone]
  const hue = anchorHue + ((variant * 3) % 11) - 5
  const lit = lightness + (variant % 3) * 2
  return {
    color: `hsl(${hue} ${saturation}% ${lit}%)`,
    borderColor: `hsl(${hue} ${saturation}% 46% / 0.78)`,
    backgroundColor: 'var(--color-surface-raised)',
    backgroundImage: `radial-gradient(circle at 50% 18%, hsl(${hue} ${saturation}% 58% / 0.34), transparent 48%), linear-gradient(145deg, hsl(${hue} ${saturation}% 34% / 0.28), hsl(${hue} 36% 9% / 0.42) 72%)`,
    boxShadow: `inset 0 1px 0 hsl(${hue} ${saturation}% 88% / 0.2), inset 0 -3px 0 rgba(0,0,0,0.34), 0 2px 3px rgba(0,0,0,0.38)`,
  }
}

/** Non-command scripts still draw from the exact same six-family vocabulary. */
export function accentForIndex(index: number) {
  return paletteAccent(PIN_COLORS[index % PIN_COLORS.length], Math.floor(index / PIN_COLORS.length))
}

export function actionAccent(key: string) {
  const prefix = key.split(':', 1)[0]
  const tone = ACTION_TONE[prefix] ?? 'slate'
  const familyKeys = ACTION_KEYS.filter((candidate) => ACTION_TONE[candidate.split(':', 1)[0]] === tone)
  return paletteAccent(tone, Math.max(0, familyKeys.indexOf(key)))
}
