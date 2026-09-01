import type { MapStamp } from '../../lib/mapStamps'

/**
 * Pictorial cartography beneath the functional map.
 *
 * These are drawings on the paper, not badges laid over it: no enclosing
 * circles and no generic category captions. Repeated room evidence chooses a
 * landscape, then a small family of imitative marks gives the sheet the same
 * visual language as an old route map. The layer never receives a pointer
 * event or accessibility announcement; rooms and gateways above it remain the
 * authoritative information.
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
    <g
      aria-hidden="true"
      className="pointer-events-none select-none"
      fill="none"
      stroke="var(--map-ink)"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {stamps.map((stamp) => {
        const landmark = ['worship', 'fortification', 'bridge', 'harbor', 'market'].includes(stamp.kind)
        const baseSize = stamp.kind === 'seal' ? 25 : stamp.kind === 'settlement' ? 25 : landmark ? 28 : 31
        const size = baseSize * unit * stamp.weight
        return (
          <g
            key={`${stamp.kind}-${stamp.x}-${stamp.y}`}
            data-map-stamp="true"
            data-map-stamp-kind={stamp.kind}
            transform={`translate(${xFor(stamp.x)} ${yFor(stamp.y)}) rotate(${stamp.rotation})`}
            opacity={stamp.kind === 'seal' ? 0.3 : landmark ? 0.62 : stamp.kind === 'settlement' ? 0.54 : 0.43}
          >
            <MapDrawing
              kind={stamp.kind}
              size={size}
              strokeWidth={Math.max(0.58, 0.82 * unit)}
              variant={stamp.variant}
            />
          </g>
        )
      })}
    </g>
  )
}

function Tree({ x, y, s, line }: { x: number; y: number; s: number; line: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M 0 ${-s * 0.55} L ${-s * 0.28} ${s * 0.06} H ${s * 0.28} Z M 0 ${-s * 0.25} L ${-s * 0.38} ${s * 0.35} H ${s * 0.38} Z M 0 ${s * 0.28} V ${s * 0.56}`} strokeWidth={line} />
    </g>
  )
}

function Peak({ x, y, s, line, snow = false }: { x: number; y: number; s: number; line: number; snow?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M ${-s * 0.58} ${s * 0.45} L 0 ${-s * 0.55} L ${s * 0.58} ${s * 0.45}`} strokeWidth={line} />
      <path d={`M ${-s * 0.44} ${s * 0.36} L 0 ${-s * 0.34} L ${s * 0.18} ${-s * 0.03}`} strokeWidth={line * 0.62} opacity={0.8} />
      {snow && <path d={`M ${-s * 0.16} ${-s * 0.28} L 0 ${-s * 0.55} L ${s * 0.17} ${-s * 0.25} L ${s * 0.05} ${-s * 0.31} L 0 ${-s * 0.22} L ${-s * 0.07} ${-s * 0.32} Z`} fill="var(--map-ink)" fillOpacity={0.08} strokeWidth={line * 0.55} />}
    </g>
  )
}

function MapDrawing({
  kind,
  size: s,
  strokeWidth: line,
  variant,
}: {
  kind: MapStamp['kind']
  size: number
  strokeWidth: number
  variant: number
}) {
  if (kind === 'water') {
    return <>{[-0.34, -0.1, 0.14, 0.38].map((row, i) => <path key={row} d={`M ${-s * (i % 2 ? 0.5 : 0.64)} ${s * row} q ${s * 0.16} ${-s * 0.12} ${s * 0.32} 0 t ${s * 0.32} 0 t ${s * 0.32} 0`} strokeWidth={line} />)}</>
  }
  if (kind === 'coast') {
    return <>
      <path d={`M ${-s * 0.64} ${-s * 0.5} Q ${-s * 0.42} ${-s * 0.12} ${-s * 0.08} ${-s * 0.04} Q ${s * 0.24} ${s * 0.04} ${s * 0.58} ${s * 0.5}`} strokeWidth={line * 1.15} />
      {[-0.22, 0.06, 0.34].map((row) => <path key={row} d={`M ${-s * 0.54} ${s * row} q ${s * 0.15} ${-s * 0.1} ${s * 0.3} 0 t ${s * 0.3} 0`} strokeWidth={line * 0.8} />)}
    </>
  }
  if (kind === 'wetland') {
    return <>
      {[-0.48, -0.16, 0.18, 0.5].map((col, i) => <path key={col} d={`M ${s * col} ${s * 0.44} V ${-s * (i % 2 ? 0.36 : 0.52)} M ${s * col} ${-s * 0.2} l ${i % 2 ? -1 : 1} ${-s * 0.18}`} strokeWidth={line} />)}
      <path d={`M ${-s * 0.64} ${s * 0.48} q ${s * 0.16} ${-s * 0.1} ${s * 0.32} 0 t ${s * 0.32} 0 t ${s * 0.32} 0`} strokeWidth={line * 0.76} />
    </>
  }
  if (kind === 'woodland') {
    return <>
      <Tree x={-s * 0.36} y={s * 0.04} s={s * 0.62} line={line} />
      <Tree x={s * 0.02} y={-s * 0.16} s={s * 0.74} line={line} />
      <Tree x={s * 0.4} y={s * 0.08} s={s * 0.58} line={line} />
    </>
  }
  if (kind === 'highland') {
    return <>
      <Peak x={-s * 0.34} y={s * 0.1} s={s * 0.82} line={line} />
      <Peak x={s * 0.24} y={-s * 0.05} s={s} line={line} />
      <Peak x={s * 0.56} y={s * 0.18} s={s * 0.58} line={line * 0.9} />
    </>
  }
  if (kind === 'frozen') {
    return <>
      <Peak x={-s * 0.24} y={s * 0.08} s={s * 0.92} line={line} snow />
      <Peak x={s * 0.34} y={s * 0.16} s={s * 0.7} line={line * 0.9} snow />
      <path d={`M ${s * 0.5} ${-s * 0.52} V ${-s * 0.18} M ${s * 0.35} ${-s * 0.44} L ${s * 0.65} ${-s * 0.26} M ${s * 0.65} ${-s * 0.44} L ${s * 0.35} ${-s * 0.26}`} strokeWidth={line * 0.62} />
    </>
  }
  if (kind === 'arid') {
    return <>
      <path d={`M ${-s * 0.7} ${s * 0.12} Q ${-s * 0.3} ${-s * 0.42} ${s * 0.18} ${s * 0.1} Q ${s * 0.42} ${s * 0.34} ${s * 0.7} ${s * 0.02}`} strokeWidth={line} />
      <path d={`M ${-s * 0.62} ${s * 0.42} Q ${-s * 0.12} ${s * 0.02} ${s * 0.6} ${s * 0.42}`} strokeWidth={line * 0.82} />
      <path d={`M ${s * 0.42} ${-s * 0.5} V ${-s * 0.22} M ${s * 0.28} ${-s * 0.36} H ${s * 0.56} M ${s * 0.32} ${-s * 0.46} L ${s * 0.24} ${-s * 0.54} M ${s * 0.52} ${-s * 0.46} L ${s * 0.6} ${-s * 0.54}`} strokeWidth={line * 0.62} />
    </>
  }
  if (kind === 'cultivated') {
    return <>
      {[-0.48, -0.16, 0.16, 0.48].map((col) => <path key={col} d={`M ${s * col} ${s * 0.54} Q ${s * col * 0.66} 0 ${s * col * 0.45} ${-s * 0.54}`} strokeWidth={line * 0.8} />)}
      <path d={`M ${-s * 0.64} ${s * 0.2} Q 0 ${s * 0.02} ${s * 0.64} ${s * 0.2}`} strokeWidth={line * 0.62} />
    </>
  }
  if (kind === 'underground') {
    return <>
      <path d={`M ${-s * 0.68} ${s * 0.46} Q ${-s * 0.58} ${-s * 0.5} 0 ${-s * 0.56} Q ${s * 0.58} ${-s * 0.5} ${s * 0.68} ${s * 0.46} Z`} fill="var(--map-ink)" fillOpacity={0.045} strokeWidth={line} />
      <path d={`M ${-s * 0.24} ${s * 0.44} Q ${-s * 0.18} ${-s * 0.04} 0 ${-s * 0.1} Q ${s * 0.18} ${-s * 0.04} ${s * 0.24} ${s * 0.44}`} strokeWidth={line * 0.78} />
    </>
  }
  if (kind === 'settlement') {
    return <>
      {/* Survey-map fabric: roof footprints seen from above. The tiny offsets
          vary by sheet, keeping repeated impressions from looking tiled. */}
      <path d={`M ${-s * 0.72} ${-s * 0.28} h ${s * 0.42} v ${s * 0.3} h ${-s * 0.42} Z`} fill="var(--map-ink)" fillOpacity={0.14} strokeWidth={line} />
      <path d={`M ${-s * (0.18 + variant * 0.015)} ${-s * 0.48} h ${s * 0.5} v ${s * 0.34} h ${-s * 0.5} Z`} fill="var(--map-ink)" fillOpacity={0.11} strokeWidth={line} />
      <path d={`M ${s * 0.18} ${s * 0.12} h ${s * 0.54} v ${s * 0.3} h ${-s * 0.54} Z`} fill="var(--map-ink)" fillOpacity={0.14} strokeWidth={line} />
      <path d={`M ${-s * 0.62} ${s * 0.2} h ${s * 0.34} v ${s * (0.25 + variant * 0.02)} h ${-s * 0.34} Z`} fill="var(--map-ink)" fillOpacity={0.09} strokeWidth={line * 0.86} />
    </>
  }
  if (kind === 'worship') {
    return <>
      <path d={`M ${-s * 0.48} ${s * 0.42} V ${-s * 0.12} H ${-s * 0.18} V ${-s * 0.5} H ${s * 0.18} V ${-s * 0.12} H ${s * 0.48} V ${s * 0.42} Z`} fill="var(--map-ink)" fillOpacity={0.14} strokeWidth={line * 1.08} />
      <path d={`M 0 ${-s * 0.5} V ${-s * 0.72} M ${-s * 0.13} ${-s * 0.62} H ${s * 0.13}`} strokeWidth={line} />
    </>
  }
  if (kind === 'fortification') {
    return <>
      <path d={`M ${-s * 0.58} ${-s * 0.48} H ${s * 0.58} V ${s * 0.48} H ${-s * 0.58} Z M ${-s * 0.36} ${-s * 0.26} H ${s * 0.36} V ${s * 0.26} H ${-s * 0.36} Z`} fill="var(--map-ink)" fillOpacity={0.045} fillRule="evenodd" strokeWidth={line} />
      <path d={`M ${-s * 0.7} ${-s * 0.6} h ${s * 0.26} v ${s * 0.26} h ${-s * 0.26} Z M ${s * 0.44} ${-s * 0.6} h ${s * 0.26} v ${s * 0.26} h ${-s * 0.26} Z M ${-s * 0.7} ${s * 0.34} h ${s * 0.26} v ${s * 0.26} h ${-s * 0.26} Z M ${s * 0.44} ${s * 0.34} h ${s * 0.26} v ${s * 0.26} h ${-s * 0.26} Z`} fill="var(--map-ink)" fillOpacity={0.1} strokeWidth={line * 0.9} />
    </>
  }
  if (kind === 'bridge') {
    return <>
      <path d={`M ${-s * 0.7} ${-s * 0.24} Q 0 ${-s * 0.44} ${s * 0.7} ${-s * 0.24} M ${-s * 0.7} ${s * 0.16} Q 0 ${-s * 0.04} ${s * 0.7} ${s * 0.16}`} strokeWidth={line * 1.12} />
      {[-0.48, -0.16, 0.16, 0.48].map((x) => <path key={x} d={`M ${s * x} ${-s * 0.3} V ${s * 0.12}`} strokeWidth={line * 0.62} />)}
      <path d={`M ${-s * 0.6} ${s * 0.42} q ${s * 0.15} ${-s * 0.09} ${s * 0.3} 0 t ${s * 0.3} 0 t ${s * 0.3} 0`} strokeWidth={line * 0.55} />
    </>
  }
  if (kind === 'harbor') {
    return <>
      <path d={`M ${-s * 0.62} ${-s * 0.5} V ${s * 0.34} M ${-s * 0.62} ${-s * 0.02} H ${s * 0.12} M ${s * 0.12} ${-s * 0.02} V ${s * 0.24} M ${-s * 0.3} ${s * 0.1} V ${s * 0.42}`} strokeWidth={line * 1.06} />
      {[-0.42, -0.14, 0.14, 0.42].map((row) => <path key={row} d={`M ${s * 0.02} ${s * row} q ${s * 0.14} ${-s * 0.08} ${s * 0.28} 0 t ${s * 0.28} 0`} strokeWidth={line * 0.56} />)}
    </>
  }
  if (kind === 'market') {
    return <>
      {[-0.46, 0, 0.46].map((x, index) => <path key={x} d={`M ${s * (x - 0.18)} ${s * 0.38} V ${-s * 0.2} L ${s * x} ${-s * (0.46 + (index === variant % 3 ? 0.08 : 0))} L ${s * (x + 0.18)} ${-s * 0.2} V ${s * 0.38} Z`} fill="var(--map-ink)" fillOpacity={0.06} strokeWidth={line * 0.9} />)}
      <path d={`M ${-s * 0.7} ${s * 0.4} H ${s * 0.7}`} strokeWidth={line * 0.7} />
    </>
  }
  if (kind === 'burial') {
    return <>
      <path d={`M ${-s * 0.58} ${s * 0.48} V ${-s * 0.06} Q ${-s * 0.58} ${-s * 0.42} ${-s * 0.3} ${-s * 0.42} Q ${-s * 0.02} ${-s * 0.42} ${-s * 0.02} ${-s * 0.06} V ${s * 0.48} M ${s * 0.14} ${s * 0.48} V ${s * 0.08} Q ${s * 0.14} ${-s * 0.2} ${s * 0.38} ${-s * 0.2} Q ${s * 0.62} ${-s * 0.2} ${s * 0.62} ${s * 0.08} V ${s * 0.48} M ${-s * 0.72} ${s * 0.48} H ${s * 0.74}`} strokeWidth={line} />
      <path d={`M ${-s * 0.3} ${-s * 0.3} V ${s * 0.04} M ${-s * 0.44} ${-s * 0.14} H ${-s * 0.16}`} strokeWidth={line * 0.72} />
    </>
  }
  if (kind === 'ruins') {
    return <>
      <path d={`M ${-s * 0.66} ${s * 0.5} V ${-s * 0.36} H ${-s * 0.36} V ${-s * 0.12} H ${-s * 0.1} V ${-s * 0.5} H ${s * 0.18} L ${s * 0.28} ${-s * 0.32} H ${s * 0.58} V ${s * 0.5} M ${-s * 0.76} ${s * 0.5} H ${s * 0.72}`} strokeWidth={line} />
      <path d={`M ${-s * 0.44} ${s * 0.48} L ${-s * 0.24} ${s * 0.16} L ${-s * 0.04} ${s * 0.48}`} strokeWidth={line * 0.7} />
    </>
  }

  // An unbadged compass rose in the quietest part of the paper.
  return <>
    <path d={`M 0 ${-s * 0.72} L ${s * 0.13} ${-s * 0.12} L 0 ${-s * 0.24} L ${-s * 0.13} ${-s * 0.12} Z M 0 ${s * 0.72} L ${s * 0.1} ${s * 0.12} L 0 ${s * 0.24} L ${-s * 0.1} ${s * 0.12} Z`} fill="var(--map-ink)" fillOpacity={0.08} strokeWidth={line} />
    <path d={`M ${-s * 0.72} 0 L ${-s * 0.12} ${s * 0.1} L ${-s * 0.24} 0 L ${-s * 0.12} ${-s * 0.1} Z M ${s * 0.72} 0 L ${s * 0.12} ${s * 0.1} L ${s * 0.24} 0 L ${s * 0.12} ${-s * 0.1} Z`} strokeWidth={line} />
    <path d={`M ${-s * 0.38} ${-s * 0.38} L ${s * 0.38} ${s * 0.38} M ${s * 0.38} ${-s * 0.38} L ${-s * 0.38} ${s * 0.38}`} strokeWidth={line * 0.58} />
  </>
}
