import type { MapStamp } from '../../lib/mapStamps'

/**
 * Faint cartographer's ink beneath every functional map layer. These marks
 * carry landscape context but never receive a pointer event, focus, or an
 * accessibility announcement; the rooms and landmarks above them remain the
 * authoritative interactive information.
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
    <g aria-hidden="true" className="pointer-events-none select-none" fill="none" stroke="var(--map-ink)">
      {stamps.map((stamp) => {
        const x = xFor(stamp.x)
        const y = yFor(stamp.y)
        const radius = (stamp.kind === 'seal' ? 22 : 20) * unit * stamp.weight
        const line = Math.max(0.55, 0.82 * unit)
        return (
          <g
            key={`${stamp.kind}-${stamp.x}-${stamp.y}`}
            transform={`translate(${x} ${y}) rotate(${stamp.rotation})`}
            opacity={stamp.kind === 'seal' ? 0.28 : 0.29}
          >
            <circle
              r={radius}
              strokeWidth={line}
              strokeDasharray={`${2.2 * unit} ${1.4 * unit}`}
              fill="var(--map-ink)"
              fillOpacity={0.05}
            />
            <circle r={radius * 0.78} strokeWidth={line * 0.65} />
            <StampGlyph kind={stamp.kind} size={radius * 0.92} strokeWidth={line} />
            <text
              y={radius + 7 * unit}
              textAnchor="middle"
              fill="var(--map-ink)"
              stroke="none"
              fontSize={Math.max(3, 7 * unit)}
              fontWeight={700}
              letterSpacing={1.05 * unit}
            >
              {stamp.kind === 'seal' ? shortLabel(stamp.label) : stamp.label.toLocaleUpperCase()}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function shortLabel(label: string): string {
  return label.length <= 22 ? label.toLocaleUpperCase() : `${label.slice(0, 20).trimEnd().toLocaleUpperCase()}…`
}

function StampGlyph({
  kind,
  size,
  strokeWidth,
}: {
  kind: MapStamp['kind']
  size: number
  strokeWidth: number
}) {
  const s = size
  const common = { strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  if (kind === 'water') {
    return <>{[-0.28, 0, 0.28].map((row) => <path key={row} d={`M ${-s * 0.52} ${s * row} q ${s * 0.18} ${-s * 0.15} ${s * 0.36} 0 t ${s * 0.36} 0`} {...common} />)}</>
  }
  if (kind === 'wetland') {
    return <>
      <path d={`M ${-s * 0.62} ${s * 0.38} q ${s * 0.18} ${-s * 0.12} ${s * 0.36} 0 t ${s * 0.36} 0`} {...common} />
      <path d={`M ${-s * 0.42} ${s * 0.24} V ${-s * 0.42} M 0 ${s * 0.24} V ${-s * 0.56} M ${s * 0.42} ${s * 0.24} V ${-s * 0.34}`} {...common} />
      <path d={`M ${-s * 0.42} ${-s * 0.2} L ${-s * 0.58} ${-s * 0.36} M 0 ${-s * 0.34} L ${s * 0.16} ${-s * 0.5} M ${s * 0.42} ${-s * 0.12} L ${s * 0.58} ${-s * 0.28}`} {...common} />
    </>
  }
  if (kind === 'coast') {
    return <>
      <path d={`M ${-s * 0.62} ${s * 0.38} Q ${-s * 0.22} ${-s * 0.08} ${s * 0.02} ${s * 0.12} T ${s * 0.62} ${-s * 0.06}`} {...common} />
      <path d={`M ${-s * 0.62} ${s * 0.58} q ${s * 0.16} ${-s * 0.12} ${s * 0.32} 0 t ${s * 0.32} 0 t ${s * 0.32} 0`} {...common} />
      <circle cx={s * 0.28} cy={-s * 0.34} r={s * 0.16} {...common} />
    </>
  }
  if (kind === 'arid') {
    return <>
      <circle cx={s * 0.34} cy={-s * 0.3} r={s * 0.18} {...common} />
      <path d={`M ${-s * 0.64} ${s * 0.28} Q ${-s * 0.22} ${-s * 0.22} ${s * 0.18} ${s * 0.24} Q ${s * 0.4} ${s * 0.46} ${s * 0.64} ${s * 0.18}`} {...common} />
      <path d={`M ${-s * 0.58} ${s * 0.5} Q ${-s * 0.1} ${s * 0.14} ${s * 0.56} ${s * 0.5}`} {...common} />
    </>
  }
  if (kind === 'cultivated') {
    return <>
      <path d={`M ${-s * 0.58} ${s * 0.48} Q ${-s * 0.34} 0 ${-s * 0.12} ${-s * 0.48} M ${-s * 0.18} ${s * 0.52} Q 0 ${s * 0.02} ${s * 0.12} ${-s * 0.5} M ${s * 0.22} ${s * 0.5} Q ${s * 0.34} ${s * 0.04} ${s * 0.42} ${-s * 0.42}`} {...common} />
      <path d={`M ${-s * 0.62} ${s * 0.14} H ${s * 0.58} M ${-s * 0.5} ${s * 0.36} H ${s * 0.46}`} {...common} />
    </>
  }
  if (kind === 'frozen') {
    return <>
      <path d={`M 0 ${-s * 0.62} V ${s * 0.62} M ${-s * 0.54} ${-s * 0.31} L ${s * 0.54} ${s * 0.31} M ${s * 0.54} ${-s * 0.31} L ${-s * 0.54} ${s * 0.31}`} {...common} />
      <path d={`M ${-s * 0.14} ${-s * 0.46} L 0 ${-s * 0.32} L ${s * 0.14} ${-s * 0.46} M ${-s * 0.14} ${s * 0.46} L 0 ${s * 0.32} L ${s * 0.14} ${s * 0.46}`} {...common} />
    </>
  }
  if (kind === 'burial') {
    return <>
      <path d={`M ${-s * 0.54} ${s * 0.5} V ${-s * 0.12} Q ${-s * 0.54} ${-s * 0.48} ${-s * 0.22} ${-s * 0.48} Q ${s * 0.1} ${-s * 0.48} ${s * 0.1} ${-s * 0.12} V ${s * 0.5}`} {...common} />
      <path d={`M ${s * 0.18} ${s * 0.5} V ${s * 0.02} Q ${s * 0.18} ${-s * 0.28} ${s * 0.42} ${-s * 0.28} Q ${s * 0.64} ${-s * 0.28} ${s * 0.64} ${s * 0.02} V ${s * 0.5} M ${-s * 0.66} ${s * 0.5} H ${s * 0.7}`} {...common} />
    </>
  }
  if (kind === 'woodland') {
    return <>
      <path d={`M 0 ${-s * 0.58} L ${-s * 0.34} ${s * 0.18} H ${s * 0.34} Z`} {...common} />
      <path d={`M ${-s * 0.34} ${-s * 0.22} L ${-s * 0.58} ${s * 0.34} H ${-s * 0.1}`} {...common} />
      <path d={`M ${s * 0.34} ${-s * 0.22} L ${s * 0.58} ${s * 0.34} H ${s * 0.1}`} {...common} />
      <path d={`M 0 ${s * 0.18} V ${s * 0.58}`} {...common} />
    </>
  }
  if (kind === 'highland') {
    return <>
      <path d={`M ${-s * 0.62} ${s * 0.42} L ${-s * 0.12} ${-s * 0.48} L ${s * 0.15} 0 L ${s * 0.34} ${-s * 0.3} L ${s * 0.64} ${s * 0.42} Z`} {...common} />
      <path d={`M ${-s * 0.28} ${-s * 0.2} L ${-s * 0.12} ${-s * 0.48} L ${s * 0.02} ${-s * 0.23}`} {...common} />
    </>
  }
  if (kind === 'underground') {
    return <>
      <path d={`M ${-s * 0.56} ${s * 0.48} Q ${-s * 0.48} ${-s * 0.5} 0 ${-s * 0.54} Q ${s * 0.48} ${-s * 0.5} ${s * 0.56} ${s * 0.48} Z`} {...common} />
      <path d={`M ${-s * 0.22} ${s * 0.45} Q ${-s * 0.16} ${-s * 0.08} 0 ${-s * 0.12} Q ${s * 0.16} ${-s * 0.08} ${s * 0.22} ${s * 0.45}`} {...common} />
    </>
  }
  if (kind === 'settlement') {
    return <>
      <path d={`M ${-s * 0.58} ${s * 0.48} V ${-s * 0.18} L ${-s * 0.3} ${-s * 0.42} L ${-s * 0.02} ${-s * 0.18} V ${s * 0.48}`} {...common} />
      <path d={`M ${s * 0.08} ${s * 0.48} V ${-s * 0.02} L ${s * 0.32} ${-s * 0.26} L ${s * 0.58} ${-s * 0.02} V ${s * 0.48}`} {...common} />
      <path d={`M ${-s * 0.66} ${s * 0.48} H ${s * 0.66}`} {...common} />
    </>
  }
  if (kind === 'ruins') {
    return <>
      <path d={`M ${-s * 0.58} ${s * 0.48} H ${s * 0.58} M ${-s * 0.48} ${s * 0.34} V ${-s * 0.3} M 0 ${s * 0.34} V ${-s * 0.3} M ${s * 0.48} ${s * 0.34} V ${-s * 0.3}`} {...common} />
      <path d={`M ${-s * 0.64} ${-s * 0.32} H ${-s * 0.08} L ${s * 0.04} ${-s * 0.46} H ${s * 0.62}`} {...common} />
    </>
  }

  // The map seal: north arrow, crosshair, and the zone id/name below it.
  return <>
    <circle r={s * 0.23} {...common} />
    <path d={`M 0 ${-s * 0.62} L ${s * 0.16} ${-s * 0.04} L 0 ${-s * 0.16} L ${-s * 0.16} ${-s * 0.04} Z`} {...common} />
    <path d={`M 0 ${s * 0.23} V ${s * 0.58} M ${-s * 0.58} 0 H ${-s * 0.23} M ${s * 0.23} 0 H ${s * 0.58}`} {...common} />
  </>
}
