import type { MapStamp } from '../../lib/mapStamps'

type StampPresentation = {
  images: Array<{ href: string; aspect: number }>
  scale: number
  opacity: number
}

/**
 * Generated engravings, deployed as transparent raster art rather than
 * browser-drawn symbols. `aspect` describes the trimmed production asset;
 * keeping it here makes every impression retain the illustrator's shape.
 */
const STAMP_ART: Record<MapStamp['kind'], StampPresentation> = {
  water: { images: [{ href: '/map-stamps/water.png', aspect: 512 / 104 }, { href: '/map-stamps/atlas/25.png', aspect: 136 / 120 }], scale: 1.35, opacity: 0.6 },
  woodland: { images: [{ href: '/map-stamps/woodland.png', aspect: 512 / 452 }, { href: '/map-stamps/atlas/22.png', aspect: 147 / 189 }], scale: 1.08, opacity: 0.57 },
  highland: { images: [{ href: '/map-stamps/highland.png', aspect: 512 / 218 }, { href: '/map-stamps/atlas/21.png', aspect: 149 / 189 }], scale: 1.18, opacity: 0.55 },
  underground: { images: [{ href: '/map-stamps/underground.png', aspect: 300 / 170 }, { href: '/map-stamps/atlas/20.png', aspect: 143 / 189 }], scale: 0.94, opacity: 0.65 },
  settlement: { images: [{ href: '/map-stamps/settlement.png', aspect: 512 / 145 }, { href: '/map-stamps/atlas/13.png', aspect: 135 / 188 }, { href: '/map-stamps/atlas/30.png', aspect: 126 / 114 }], scale: 1.2, opacity: 0.62 },
  ruins: { images: [{ href: '/map-stamps/ruins.png', aspect: 512 / 398 }, { href: '/map-stamps/atlas/18.png', aspect: 133 / 147 }], scale: 0.9, opacity: 0.66 },
  wetland: { images: [{ href: '/map-stamps/wetland.png', aspect: 512 / 197 }, { href: '/map-stamps/atlas/24.png', aspect: 132 / 189 }], scale: 1.2, opacity: 0.58 },
  coast: { images: [{ href: '/map-stamps/coast.png', aspect: 506 / 512 }, { href: '/map-stamps/atlas/26.png', aspect: 139 / 120 }], scale: 1.05, opacity: 0.57 },
  arid: { images: [{ href: '/map-stamps/arid.png', aspect: 512 / 242 }, { href: '/map-stamps/atlas/27.png', aspect: 142 / 120 }], scale: 1.12, opacity: 0.56 },
  cultivated: { images: [{ href: '/map-stamps/cultivated.png', aspect: 512 / 486 }, { href: '/map-stamps/atlas/23.png', aspect: 138 / 130 }], scale: 1.08, opacity: 0.51 },
  frozen: { images: [{ href: '/map-stamps/frozen.png', aspect: 512 / 100 }, { href: '/map-stamps/atlas/28.png', aspect: 138 / 119 }], scale: 1.22, opacity: 0.58 },
  burial: { images: [{ href: '/map-stamps/burial.png', aspect: 512 / 453 }, { href: '/map-stamps/atlas/19.png', aspect: 133 / 189 }], scale: 0.86, opacity: 0.63 },
  worship: { images: [{ href: '/map-stamps/worship.png', aspect: 512 / 401 }, { href: '/map-stamps/atlas/16.png', aspect: 122 / 188 }], scale: 0.86, opacity: 0.67 },
  fortification: { images: [{ href: '/map-stamps/fortification.png', aspect: 512 / 467 }, { href: '/map-stamps/atlas/17.png', aspect: 135 / 151 }, { href: '/map-stamps/atlas/29.png', aspect: 98 / 110 }], scale: 0.88, opacity: 0.67 },
  bridge: { images: [{ href: '/map-stamps/bridge.png', aspect: 411 / 512 }, { href: '/map-stamps/atlas/14.png', aspect: 140 / 97 }], scale: 0.86, opacity: 0.67 },
  harbor: { images: [{ href: '/map-stamps/harbor.png', aspect: 483 / 512 }, { href: '/map-stamps/atlas/15.png', aspect: 137 / 145 }], scale: 0.88, opacity: 0.66 },
  market: { images: [{ href: '/map-stamps/market.png', aspect: 512 / 486 }, { href: '/map-stamps/atlas/13.png', aspect: 135 / 188 }], scale: 0.86, opacity: 0.65 },
  'service-bank': { images: [{ href: '/map-stamps/service-bank.png', aspect: 714 / 625 }, { href: '/map-stamps/atlas/01.png', aspect: 133 / 137 }], scale: 1, opacity: 0.68 },
  'service-healer': { images: [{ href: '/map-stamps/service-healer.png', aspect: 595 / 660 }, { href: '/map-stamps/atlas/02.png', aspect: 120 / 151 }, { href: '/map-stamps/atlas/11.png', aspect: 120 / 140 }], scale: 1, opacity: 0.68 },
  'service-guild': { images: [{ href: '/map-stamps/service-guild.png', aspect: 762 / 508 }, { href: '/map-stamps/atlas/03.png', aspect: 121 / 159 }], scale: 1, opacity: 0.68 },
  'service-inn': { images: [{ href: '/map-stamps/service-inn.png', aspect: 750 / 692 }, { href: '/map-stamps/atlas/04.png', aspect: 143 / 142 }], scale: 1, opacity: 0.68 },
  'service-forge': { images: [{ href: '/map-stamps/service-forge.png', aspect: 741 / 504 }, { href: '/map-stamps/atlas/05.png', aspect: 134 / 147 }], scale: 1, opacity: 0.68 },
  'service-library': { images: [{ href: '/map-stamps/service-library.png', aspect: 677 / 507 }, { href: '/map-stamps/atlas/06.png', aspect: 129 / 152 }], scale: 1, opacity: 0.68 },
  'service-training': { images: [{ href: '/map-stamps/service-training.png', aspect: 761 / 512 }, { href: '/map-stamps/atlas/07.png', aspect: 128 / 144 }], scale: 1, opacity: 0.68 },
  'service-gate': { images: [{ href: '/map-stamps/service-gate.png', aspect: 768 / 512 }, { href: '/map-stamps/atlas/08.png', aspect: 133 / 125 }, { href: '/map-stamps/atlas/30.png', aspect: 126 / 114 }], scale: 1, opacity: 0.68 },
  'service-arcane': { images: [{ href: '/map-stamps/service-arcane.png', aspect: 763 / 509 }, { href: '/map-stamps/atlas/12.png', aspect: 124 / 142 }], scale: 1, opacity: 0.7 },
  'service-civic': { images: [{ href: '/map-stamps/service-civic.png', aspect: 735 / 512 }, { href: '/map-stamps/atlas/09.png', aspect: 123 / 161 }, { href: '/map-stamps/atlas/10.png', aspect: 125 / 155 }], scale: 1, opacity: 0.68 },
}

/**
 * Pictorial cartography beneath the functional map.
 *
 * Room evidence still owns kind and placement. This layer only prints the
 * corresponding engraving into the sheet; it cannot intercept a room, trail,
 * gateway, tooltip, or screen-reader announcement.
 */
export function MapStampLayer({
  stamps,
  xFor,
  yFor,
  unit,
}: {
  stamps: MapStamp[]
  xFor: (x: number) => number
  yFor: (y: number) => number
  unit: number
}) {
  return (
    <g aria-hidden="true" className="pointer-events-none select-none">
      {stamps.map((stamp) => {
        const art = STAMP_ART[stamp.kind]
        const backgroundVariants = art.images.slice(1)
        const image = stamp.role === 'background' && backgroundVariants.length
          ? backgroundVariants[stamp.variant % backgroundVariants.length]
          : art.images[0]
        // Faint repeating fabric sits behind readable illustrations. Major
        // services deliberately break scale like cathedrals on historical maps.
        const baseDimension = stamp.role === 'hero' ? 112 : stamp.role === 'background' ? 46 : 64
        const maxDimension = baseDimension * unit * stamp.weight * art.scale
        const width = image.aspect >= 1 ? maxDimension : maxDimension * image.aspect
        const height = image.aspect >= 1 ? maxDimension / image.aspect : maxDimension
        const roleOpacity = stamp.role === 'background' ? 0.5 : stamp.role === 'hero' ? 0.95 : 1

        return (
          <image
            key={`${stamp.kind}-${stamp.x}-${stamp.y}`}
            data-map-stamp="true"
            data-map-stamp-kind={stamp.kind}
            data-map-stamp-role={stamp.role}
            href={image.href}
            x={-width / 2}
            y={-height / 2}
            width={width}
            height={height}
            opacity={art.opacity * roleOpacity}
            preserveAspectRatio="xMidYMid meet"
            style={{ mixBlendMode: 'multiply' }}
            transform={`translate(${xFor(stamp.x)} ${yFor(stamp.y)}) rotate(${stamp.rotation})`}
          />
        )
      })}
    </g>
  )
}
