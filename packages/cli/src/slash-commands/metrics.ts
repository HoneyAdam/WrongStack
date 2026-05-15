import { color } from '@wrongstack/core';
import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

export function buildMetricsCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'metrics',
    description: 'Show metrics snapshot (requires --metrics flag).',
    async run() {
      if (!opts.metricsSink)
        return { message: 'Metrics not enabled. Restart with --metrics to collect.' };
      const snap = opts.metricsSink.snapshot();
      if (snap.series.length === 0) return { message: 'No metrics recorded yet.' };
      const lines: string[] = [];
      const byName = new Map<string, typeof snap.series>();
      for (const s of snap.series) {
        const bucket = byName.get(s.name) ?? [];
        bucket.push(s);
        byName.set(s.name, bucket);
      }
      for (const [name, series] of [...byName.entries()].sort()) {
        lines.push(color.dim(`# ${name}`));
        for (const s of series) {
          const labels = Object.entries(s.labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ');
          const labelStr = labels ? color.dim(` {${labels}}`) : '';
          if (s.type === 'histogram')
            lines.push(
              `  count=${s.values.count} sum=${s.values.sum} min=${s.values.min} max=${s.values.max} p50=${s.values.p50} p95=${s.values.p95} p99=${s.values.p99}${labelStr}`,
            );
          else lines.push(`  ${s.values.value}${labelStr}`);
        }
      }
      return { message: lines.join('\n') };
    },
  };
}
