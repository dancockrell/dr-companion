import type { CSSProperties } from 'react'
import { customPinIconHref, isCustomPinIcon, type PinIcon } from '../../lib/mapPins.ts'
import { PIN_ICON_COMPONENT } from '../../lib/pinIcons.ts'

/** Draw either a curated Lucide symbol or a generated fantasy glyph in HTML UI. */
export function PinIconGlyph({
  icon,
  className,
  style,
}: {
  icon: PinIcon
  className?: string
  style?: CSSProperties
}) {
  if (isCustomPinIcon(icon)) {
    return <img src={customPinIconHref(icon)} alt="" aria-hidden className={className} style={style} />
  }
  const Icon = PIN_ICON_COMPONENT[icon]
  return <Icon className={className} style={style} />
}
