/**
 * Single-series time-bucketed column chart (SVG, dependency-free).
 *
 * Follows the dataviz mark rules: thin columns with a 2px surface gap and
 * rounded data-ends, recessive gridlines, sparse time ticks, a hover layer
 * with a per-column tooltip (value + bucket time), and text in ink tokens —
 * the series color lives only on the marks.
 *
 * One chart = one measure = one hue. Two measures never share an axis; render
 * two charts instead.
 *
 * @module lib/timeseries-chart
 */
import type React from 'react';
import { useId, useMemo, useState } from 'react';

export interface TimeseriesPoint {
  ts: number;
  value: number;
}

export function TimeseriesChart({
  points,
  color,
  height = 140,
  format,
  emptyLabel = 'no data',
}: {
  points: readonly TimeseriesPoint[];
  /** CSS color for the columns (a chart token, e.g. `var(--chart-1)`). */
  color: string;
  height?: number;
  /** Value formatter for tooltip + y ticks. */
  format: (v: number) => string;
  emptyLabel?: string;
}): React.ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  const W = 720;
  const H = height;
  const PAD_L = 46;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const max = useMemo(() => Math.max(...points.map((p) => p.value), 0), [points]);

  if (points.length === 0 || max <= 0) {
    return <div className="hq-chart-empty">{emptyLabel}</div>;
  }

  const n = points.length;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(18, slot - 2)); // 2px surface gap between fills
  const yFor = (v: number) => PAD_T + plotH * (1 - v / max);

  // 3 recessive gridlines (¼, ½, ¾ … skipping baseline duplication).
  const gridVals = [max * 0.25, max * 0.5, max * 0.75, max];

  // Sparse x ticks: ~5 labels.
  const tickEvery = Math.max(1, Math.round(n / 5));

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const hovered = hover !== null ? points[hover] : undefined;

  return (
    <div className="hq-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="hq-chart-svg"
        role="img"
        onMouseLeave={() => setHover(null)}
      >
        <clipPath id={clipId}>
          <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} />
        </clipPath>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yFor(v)} y2={yFor(v)} className="hq-chart-grid" />
            <text x={PAD_L - 6} y={yFor(v) + 3} className="hq-chart-ytick" textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}
        {/* baseline */}
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={PAD_T + plotH}
          y2={PAD_T + plotH}
          className="hq-chart-axis"
        />
        <g clipPath={`url(#${clipId})`}>
          {points.map((p, i) => {
            const x = PAD_L + i * slot + (slot - barW) / 2;
            const y = yFor(p.value);
            const h = PAD_T + plotH - y;
            if (h <= 0) return null;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={Math.min(3, barW / 2)}
                fill={color}
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
            );
          })}
        </g>
        {/* x ticks */}
        {points.map((p, i) =>
          i % tickEvery === 0 ? (
            <text
              key={i}
              x={PAD_L + i * slot + slot / 2}
              y={H - 6}
              className="hq-chart-xtick"
              textAnchor="middle"
            >
              {fmtTime(p.ts)}
            </text>
          ) : null,
        )}
        {/* hover hit targets (wider than the mark) */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={PAD_L + i * slot}
            y={PAD_T}
            width={slot}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hovered !== undefined && (
        <div className="hq-chart-tooltip">
          <span className="hq-chart-tooltip-swatch" style={{ background: color }} />
          <span className="hq-chart-tooltip-value">{format(hovered.value)}</span>
          <span className="hq-chart-tooltip-time">{fmtTime(hovered.ts)}</span>
        </div>
      )}
    </div>
  );
}
