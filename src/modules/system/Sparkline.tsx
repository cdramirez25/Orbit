import type { PointerEvent } from 'react';

import { sparkIndexAt, sparkPaths, sparkPoint, type SparkGeometry } from '@/lib/system';

/** `accent` es la serie protagonista; `muted` la de contexto. */
export type SparkTone = 'accent' | 'muted';

export interface SparkSeries {
  /** Las lecturas, la más nueva al final. */
  values: readonly number[];
  tone: SparkTone;
  /** Con un velo debajo del trazo (solo la serie principal). */
  area?: boolean;
}

export interface SparklineProps {
  series: readonly SparkSeries[];
  /** Valor que queda arriba del todo. */
  max: number;
  width: number;
  height: number;
  /** Qué muestra y cuánto vale (para lectores de pantalla). */
  label: string;
  /** La lectura marcada con el puntero; `null` si no hay. */
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

const PAD = 6;
const STROKE: Record<SparkTone, string> = { accent: 'var(--accent)', muted: 'var(--ink-dim)' };

/** Mini gráfica de la última lectura hacia atrás: trazo fino, punto al final y guía al pasar el puntero. */
export function Sparkline({
  series,
  max,
  width,
  height,
  label,
  hoverIndex,
  onHover,
}: SparklineProps) {
  const geometry: SparkGeometry = { width, height, pad: PAD, max };
  const length = series[0]?.values.length ?? 0;

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const x = ((event.clientX - box.left) / box.width) * width;
    onHover(sparkIndexAt(x, length, geometry));
  };

  const marked = hoverIndex !== null && hoverIndex < length ? hoverIndex : null;
  const guide = marked === null ? null : sparkPoint(marked, length, 0, geometry).x;

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 touch-none"
      onPointerMove={move}
      onPointerLeave={() => onHover(null)}
    >
      <line
        x1={PAD}
        x2={width - PAD}
        y1={height - PAD}
        y2={height - PAD}
        stroke="var(--island-border)"
        strokeWidth={1}
      />
      {series.map((item, index) => {
        const paths = sparkPaths(item.values, geometry);
        return (
          <g key={index}>
            {item.area && paths.area && (
              <path d={paths.area} fill={STROKE[item.tone]} fillOpacity={0.1} />
            )}
            {paths.line && (
              <path
                d={paths.line}
                fill="none"
                stroke={STROKE[item.tone]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
      {guide !== null && (
        <line
          x1={guide}
          x2={guide}
          y1={PAD}
          y2={height - PAD}
          stroke="var(--ink-faint)"
          strokeWidth={1}
        />
      )}
      {series.map((item, index) => {
        const at = marked ?? item.values.length - 1;
        const value = item.values[at];
        if (value === undefined) return null;
        const point = sparkPoint(at, item.values.length, value, geometry);
        return (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={4}
            fill={STROKE[item.tone]}
            stroke="var(--tile)"
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}
