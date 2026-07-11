import type { SlashCommand } from '../index.js';
import type { HealthRegistry, MetricsRuntimeStatus, MetricsSink } from '../types/observability.js';
import type { Plugin } from '../types/plugin.js';
import { color } from '../utils/color.js';

interface ObservabilityPluginOptions {
  metricsSink?: MetricsSink | undefined;
  metricsStatus?: MetricsRuntimeStatus | undefined;
  healthRegistry?: HealthRegistry | undefined;
}

/**
 * ObservabilityPlugin — runtime metrics + health checks.
 *
 * Registers `/metrics` and `/health`. First-party ("official") plugin, so the
 * commands keep their bare names. Both require the host to have started the
 * metrics subsystem (`--metrics`); without it they report that and no-op.
 */
export function createObservabilityPlugin(opts?: ObservabilityPluginOptions): Plugin {
  return {
    name: 'wstack-observability',
    version: '1.0.0',
    description: 'Runtime metrics and health checks: /metrics, /health',
    apiVersion: '^0.1',
    capabilities: { slashCommands: true },
    defaultConfig: {},

    setup(api) {
      const rawConfig = api.config as never as Record<string, unknown>;
      const metricsSink = opts?.metricsSink ?? (rawConfig.metricsSink as MetricsSink | undefined);
      const metricsStatus =
        opts?.metricsStatus ?? (rawConfig.metricsStatus as MetricsRuntimeStatus | undefined);
      const healthRegistry =
        opts?.healthRegistry ?? (rawConfig.healthRegistry as HealthRegistry | undefined);

      api.slashCommands.register(buildMetricsCommand(metricsSink, metricsStatus));
      api.slashCommands.register(buildHealthCommand(healthRegistry));
      api.log.info('[observability] loaded — /metrics, /health available');
    },

    teardown(api) {
      api.slashCommands.unregister('metrics');
      api.slashCommands.unregister('health');
      api.log.info('[observability] unloaded');
    },

    async health() {
      return { ok: true, message: 'observability ready' };
    },
  };
}

function statusIcon(status: string): string {
  if (status === 'healthy') return color.green('●');
  if (status === 'degraded') return color.yellow('●');
  return color.red('●');
}

export function buildMetricsCommand(
  metricsSink?: MetricsSink,
  runtimeStatus: MetricsRuntimeStatus = {
    collectionEnabled: metricsSink !== undefined,
    httpExporter: 'unknown',
  },
): SlashCommand {
  const help = [
    'Usage: /metrics [--json]',
    '',
    'Shows the current in-memory metrics snapshot and safe exporter status.',
    'Use --json for stable machine-readable output and slash-command metadata.',
    'Metric collection requires --metrics or --metrics-port.',
  ].join('\n');
  return {
    name: 'metrics',
    category: 'Inspect',
    argsHint: '[--json]',
    description: 'Show metrics snapshot (requires --metrics flag).',
    help,
    async run(args: string) {
      const json = args.trim().split(/\s+/).includes('--json');
      if (!metricsSink) {
        if (json) {
          const unavailable = { enabled: false, exporter: runtimeStatus, snapshot: null };
          return {
            message: JSON.stringify(unavailable, null, 2),
            metadata: { metrics: unavailable },
          };
        }
        return { message: 'Metrics not enabled. Restart with --metrics to collect.' };
      }
      const snap = metricsSink.snapshot();
      const payload = { enabled: true, exporter: runtimeStatus, snapshot: snap };
      if (json) {
        return { message: JSON.stringify(payload, null, 2), metadata: { metrics: payload } };
      }

      const statusLine = `collection=${runtimeStatus.collectionEnabled ? 'enabled' : 'disabled'} http_exporter=${runtimeStatus.httpExporter}`;
      if (snap.series.length === 0) {
        return { message: `${color.dim(statusLine)}\nNo metrics recorded yet.` };
      }

      const lines: string[] = [color.dim(statusLine)];
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
          if (s.type === 'histogram') {
            lines.push(
              `  count=${s.values.count} sum=${s.values.sum} min=${s.values.min} max=${s.values.max} p50=${s.values.p50} p95=${s.values.p95} p99=${s.values.p99}${labelStr}`,
            );
          } else {
            lines.push(`  ${s.values.value}${labelStr}`);
          }
        }
      }
      return { message: lines.join('\n') };
    },
  };
}

export function buildHealthCommand(healthRegistry?: HealthRegistry): SlashCommand {
  const help = [
    'Usage: /health [--json]',
    '',
    'Runs the host health registry and reports the worst aggregate status.',
    'Use --json for stable machine-readable output and slash-command metadata.',
    'Health collection requires --metrics or --metrics-port.',
  ].join('\n');
  return {
    name: 'health',
    category: 'Inspect',
    argsHint: '[--json]',
    description: 'Run health checks (requires --metrics flag).',
    help,
    async run(args: string) {
      const json = args.trim().split(/\s+/).includes('--json');
      if (!healthRegistry) {
        if (json) {
          const unavailable = { enabled: false, status: 'unavailable', checks: [] };
          return {
            message: JSON.stringify(unavailable, null, 2),
            metadata: { health: unavailable },
          };
        }
        return { message: 'Health checks not enabled. Restart with --metrics.' };
      }
      const result = await healthRegistry.run();
      if (json) {
        return { message: JSON.stringify(result, null, 2), metadata: { health: result } };
      }
      const lines = [
        `${statusIcon(result.status)} overall: ${result.status}`,
        ...result.checks.map((c) => {
          const detail = c.detail ? color.dim(` — ${c.detail}`) : '';
          return `  ${statusIcon(c.status)} ${c.name}: ${c.status}${detail}`;
        }),
      ];
      return { message: lines.join('\n') };
    },
  };
}
