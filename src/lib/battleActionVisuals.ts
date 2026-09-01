import * as Icons from 'lucide-react'
import { MACROS } from '../data/macros'

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

/** Golden-angle spacing keeps every neighbouring action accent distinct. */
export function accentForIndex(index: number) {
  const hue = (index * 137.508 + 8) % 360
  return {
    color: `hsl(${hue.toFixed(2)} 84% 66%)`,
    borderColor: `hsl(${hue.toFixed(2)} 70% 44% / 0.62)`,
    background: `linear-gradient(145deg, hsl(${hue.toFixed(2)} 80% 45% / 0.22), hsl(${hue.toFixed(2)} 55% 18% / 0.06) 58%, transparent)`,
    boxShadow: `inset 0 1px 0 hsl(${hue.toFixed(2)} 90% 84% / 0.12), inset 0 -2px 6px rgba(0,0,0,0.28)`,
  }
}

export function actionAccent(key: string) {
  return accentForIndex(ACTION_INDEX.get(key) ?? 0)
}
