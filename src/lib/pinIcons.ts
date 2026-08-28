/**
 * The lucide component behind each PinIcon key.
 *
 * Split out of PinEditor.tsx: a component file that also exports a plain
 * constant breaks Fast Refresh (oxlint's react(only-export-components)),
 * and MapPinBar needs this same lookup to draw a pin's icon in the hotbar,
 * not just PinEditor's picker.
 */
import {
  Home,
  Landmark,
  Coins,
  HeartPulse,
  Shield,
  ShoppingBag,
  Backpack,
  Sword,
  Swords,
  Users,
  Tent,
  Flag,
  Skull,
  Ghost,
  Sprout,
  MapPin as MapPinIcon,
  type LucideIcon,
} from 'lucide-react'
import type { PinIcon } from './mapPins'

export const PIN_ICON_COMPONENT: Record<PinIcon, LucideIcon> = {
  home: Home,
  landmark: Landmark,
  coins: Coins,
  'heart-pulse': HeartPulse,
  shield: Shield,
  'shopping-bag': ShoppingBag,
  backpack: Backpack,
  sword: Sword,
  swords: Swords,
  users: Users,
  tent: Tent,
  flag: Flag,
  skull: Skull,
  ghost: Ghost,
  sprout: Sprout,
  'map-pin': MapPinIcon,
}
