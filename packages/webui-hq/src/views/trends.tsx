/**
 * Trends view — time-bucketed cost + activity from /api/trends/cost, rendered
 * as a KPI row plus one single-series column chart per measure (cost, tokens,
 * tool calls). One chart = one measure = one hue; never a dual axis.
 */
import type { HqTimeseriesSample } from '@wrongstack/core';
import type React from 'react';
import { useEffect, useState } from 'react';
import { TimeseriesChart } from '../lib/timeseries-chart.js';
import { fetchJson } from '../store.js';

interface TrendsResponse {
  samples: HqTimeseriesSample[];
}

const RANGES: { label: string; ms: number }[] = [
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
];

function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

export function TrendsView(): React.ReactElement {
  const [samples, setSamples] = useState<HqTimeseriesSample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rangeMs, setRangeMs] = useState(RANGES[2]!.ms);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      fetchJson<TrendsResponse>('/api/trends/cost')
        .then((data) => {
          if (!cancelled) {
            setSamples(data.samples);
            setError(null);
          }
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error !== null) return <div className="hq-empty">Error loading trends: {error}</div>;
  if (samples.length === 0) {
    return (
      <div className="hq-empty">No trend data yet. Trends accumulate as cost signals arrive.</div>
    );
  }

  const cutoff = Date.now() - rangeMs;
  const inRange = samples.filter((s) => s.ts >= cutoff);
  const shown = inRange.length > 0 ? inRange : samples.slice(-24);

  const totalCost = shown.reduce((s, b) => s + b.costUsd, 0);
  const totalTokens = shown.reduce((s, b) => s + b.inputTokens + b.outputTokens, 0);
  const totalTools = shown.reduce((s, b) => s + b.toolCalls, 0);

  return (
    <div>
      <div className="hq-filter-row">
        {RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            className={`hq-pill hq-filter-chip${rangeMs === r.ms ? ' selected' : ''}`}
            onClick={() => setRangeMs(r.ms)}
          >
            {r.label}
          </button>
        ))}
        <span className="hq-mono hq-row-subtle" style={{ marginLeft: 'auto' }}>
          {shown.length} × 5-min buckets
        </span>
      </div>

      <div className="hq-kpi-row">
        <div className="hq-kpi">
          <span className="hq-kpi-value accent-cost">${totalCost.toFixed(4)}</span>
          <span className="hq-kpi-label">cost</span>
        </div>
        <div className="hq-kpi">
          <span className="hq-kpi-value">{fmtTokens(totalTokens)}</span>
          <span className="hq-kpi-label">tokens</span>
        </div>
        <div className="hq-kpi">
          <span className="hq-kpi-value">{totalTools.toLocaleString()}</span>
          <span className="hq-kpi-label">tool calls</span>
        </div>
      </div>

      <div className="hq-card">
        <div className="hq-card-title">Cost (USD)</div>
        <TimeseriesChart
          points={shown.map((s) => ({ ts: s.ts, value: s.costUsd }))}
          color="var(--chart-1)"
          format={(v) => `$${v >= 1 ? v.toFixed(2) : v.toFixed(4)}`}
        />
      </div>
      <div className="hq-card">
        <div className="hq-card-title">Tokens (in + out)</div>
        <TimeseriesChart
          points={shown.map((s) => ({ ts: s.ts, value: s.inputTokens + s.outputTokens }))}
          color="var(--chart-2)"
          format={fmtTokens}
        />
      </div>
      <div className="hq-card">
        <div className="hq-card-title">Tool calls</div>
        <TimeseriesChart
          points={shown.map((s) => ({ ts: s.ts, value: s.toolCalls }))}
          color="var(--chart-3)"
          format={(v) => String(Math.round(v))}
        />
      </div>
    </div>
  );
}
