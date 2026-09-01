import type { MapStamp } from '../../lib/mapStamps'

type StampPresentation = {
  href: string
  aspect: number
  scale: number
  opacity: number
}

/**
 * Generated engravings, deployed as transparent raster art rather than
 * browser-drawn symbols. `aspect` describes the trimmed production asset;
 * keeping it here makes every impression retain the illustrator's shape.
 */
const STAMP_ART: Record<MapStamp['kind'], StampPresentation> = {
  water: { href: '/map-stamps/water.png', aspect: 512 / 104, scale: 1.35, opacity: 0.6 },
  woodland: { href: '/map-stamps/woodland.png', aspect: 512 / 452, scale: 1.08, opacity: 0.57 },
  highland: { href: '/map-stamps/highland.png', aspect: 512 / 218, scale: 1.18, opacity: 0.55 },
  underground: { href: '/map-stamps/underground.png', aspect: 300 / 170, scale: 0.94, opacity: 0.65 },
  settlement: { href: '/map-stamps/settlement.png', aspect: 512 / 145, scale: 1.2, opacity: 0.62 },
  ruins: { href: '/map-stamps/ruins.png', aspect: 512 / 398, scale: 0.9, opacity: 0.66 },
  wetland: { href: '/map-stamps/wetland.png', aspect: 512 / 197, scale: 1.2, opacity: 0.58 },
  coast: { href: '/map-stamps/coast.png', aspect: 506 / 512, scale: 1.05, opacity: 0.57 },
  arid: { href: '/map-stamps/arid.png', aspect: 512 / 242, scale: 1.12, opacity: 0.56 },
  cultivated: { href: '/map-stamps/cultivated.png', aspect: 512 / 486, scale: 1.08, opacity: 0.51 },
  frozen: { href: '/map-stamps/frozen.png', aspect: 512 / 100, scale: 1.22, opacity: 0.58 },
  burial: { href: '/map-stamps/burial.png', aspect: 512 / 453, scale: 0.86, opacity: 0.63 },
  worship: { href: '/map-stamps/worship.png', aspect: 512 / 401, scale: 0.86, opacity: 0.67 },
  fortification: { href: '/map-stamps/fortification.png', aspect: 512 / 467, scale: 0.88, opacity: 0.67 },
  bridge: { href: '/map-stamps/bridge.png', aspect: 411 / 512, scale: 0.86, opacity: 0.67 },
  harbor: { href: '/map-stamps/harbor.png', aspect: 483 / 512, scale: 0.88, opacity: 0.66 },
  market: { href: '/map-stamps/market.png', aspect: 512 / 486, scale: 0.86, opacity: 0.65 },
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
        const maxDimension = 38 * unit * stamp.weight * art.scale
        const width = art.aspect >= 1 ? maxDimension : maxDimension * art.aspect
        const height = art.aspect >= 1 ? maxDimension / art.aspect : maxDimension

        return (
          <image
            key={`${stamp.kind}-${stamp.x}-${stamp.y}`}
            data-map-stamp="true"
            data-map-stamp-kind={stamp.kind}
            href={art.href}
            x={-width / 2}
            y={-height / 2}
            width={width}
            height={height}
            opacity={art.opacity}
            preserveAspectRatio="xMidYMid meet"
            style={{ mixBlendMode: 'multiply' }}
            transform={`translate(${xFor(stamp.x)} ${yFor(stamp.y)}) rotate(${stamp.rotation})`}
          />
        )
      })}
    </g>
  )
}
