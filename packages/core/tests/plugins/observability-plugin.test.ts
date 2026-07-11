import { describe, expect, it, vi } from 'vitest';
import type { SlashCommand } from '../../src/index.js';
import {
  buildHealthCommand,
  buildMetricsCommand,
  createObservabilityPlugin,
} from '../../src/plugins/observability-plugin.js';

describe('createObservabilityPlugin', () => {
  it('passes host metrics status to the registered command', async () => {
    const registered: SlashCommand[] = [];
    const unregister = vi.fn();
    const metricsSink = { snapshot: () => ({ timestamp: 1, series: [] }) };
    const plugin = createObservabilityPlugin();
    const api = {
      config: {
        metricsSink,
        metricsStatus: { collectionEnabled: true, httpExporter: 'listening' },
      },
      slashCommands: {
        register: (command: SlashCommand) => registered.push(command),
        unregister,
      },
      log: { info: vi.fn() },
    } as never;

    plugin.setup!(api);
    const metrics = registered.find((command) => command.name === 'metrics')!;
    const payload = JSON.parse((await metrics.run('--json', {} as never))!.message!);
    expect(payload.exporter).toEqual({
      collectionEnabled: true,
      httpExporter: 'listening',
    });

    plugin.teardown!(api);
    expect(unregister).toHaveBeenCalledWith('metrics');
    expect(unregister).toHaveBeenCalledWith('health');
  });

  it('health() returns ok and ready message', async () => {
    const plugin = createObservabilityPlugin();
    const result = await plugin.health!();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('ready');
  });
});

// ── /metrics ────────────────────────────────────────────────────────────────

describe('buildMetricsCommand', () => {
  it('reports "metrics not enabled" when no sink', async () => {
    const cmd = buildMetricsCommand(undefined);
    const res = await cmd.run('', {} as never);
    expect(res!.message).toContain('Metrics not enabled');
  });

  it('exposes deep help and structured unavailable output', async () => {
    const cmd = buildMetricsCommand(undefined, {
      collectionEnabled: false,
      httpExporter: 'disabled',
    });
    expect(cmd.category).toBe('Inspect');
    expect(cmd.argsHint).toBe('[--json]');
    expect(cmd.help).toContain('Usage: /metrics [--json]');

    const res = await cmd.run('--json', {} as never);
    expect(JSON.parse(res!.message!)).toEqual({
      enabled: false,
      exporter: { collectionEnabled: false, httpExporter: 'disabled' },
      snapshot: null,
    });
    expect(res!.metadata?.['metrics']).toMatchObject({ enabled: false });
  });

  it('reports "no metrics recorded" when series is empty', async () => {
    const sink = { snapshot: () => ({ series: [] }) };
    const cmd = buildMetricsCommand(sink as never);
    const res = await cmd.run('', {} as never);
    expect(res!.message).toContain('No metrics recorded');
    expect(res!.message).toContain('http_exporter=unknown');
  });

  it('returns snapshot and exporter state as JSON and metadata', async () => {
    const snapshot = {
      timestamp: 123,
      series: [{ name: 'tool.calls', type: 'counter', labels: {}, values: { value: 2 } }],
    };
    const cmd = buildMetricsCommand({ snapshot: () => snapshot } as never, {
      collectionEnabled: true,
      httpExporter: 'listening',
    });
    const res = await cmd.run('--json', {} as never);
    expect(JSON.parse(res!.message!)).toEqual({
      enabled: true,
      exporter: { collectionEnabled: true, httpExporter: 'listening' },
      snapshot,
    });
    expect(res!.metadata?.['metrics']).toMatchObject({ enabled: true, snapshot });
    expect(res!.message).not.toContain('http://');
  });

  it('renders counter and histogram series with labels', async () => {
    const sink = {
      snapshot: () => ({
        series: [
          {
            name: 'tokens_used',
            type: 'counter',
            labels: { provider: 'anthropic' },
            values: { value: 12345 },
          },
          {
            name: 'latency_ms',
            type: 'histogram',
            labels: { model: 'opus' },
            values: { count: 10, sum: 500, min: 30, max: 80, p50: 50, p95: 75, p99: 79 },
          },
          {
            name: 'no_labels',
            type: 'counter',
            labels: {},
            values: { value: 1 },
          },
        ],
      }),
    };
    const cmd = buildMetricsCommand(sink as never);
    const res = await cmd.run('', {} as never);
    const out = res!.message ?? '';
    expect(out).toContain('# latency_ms');
    expect(out).toContain('count=10');
    expect(out).toContain('p95=75');
    expect(out).toContain('model=opus');
    expect(out).toContain('# tokens_used');
    expect(out).toContain('12345');
    expect(out).toContain('provider=anthropic');
    expect(out).toContain('# no_labels');
    // Series sorted alphabetically — latency comes before tokens
    expect(out.indexOf('latency_ms')).toBeLessThan(out.indexOf('tokens_used'));
  });
});

// ── /health ─────────────────────────────────────────────────────────────────

describe('buildHealthCommand', () => {
  it('reports "health checks not enabled" without registry', async () => {
    const cmd = buildHealthCommand(undefined);
    const res = await cmd.run('', {} as never);
    expect(res.message).toContain('Health checks not enabled');
  });

  it('exposes deep help and structured unavailable output', async () => {
    const cmd = buildHealthCommand(undefined);
    expect(cmd.category).toBe('Inspect');
    expect(cmd.argsHint).toBe('[--json]');
    expect(cmd.help).toContain('Usage: /health [--json]');

    const res = await cmd.run('--json', {} as never);
    expect(JSON.parse(res!.message!)).toEqual({
      enabled: false,
      status: 'unavailable',
      checks: [],
    });
    expect(res!.metadata?.['health']).toMatchObject({ status: 'unavailable' });
  });

  it('runs the registry and renders each check status with details', async () => {
    const registry = {
      run: vi.fn().mockResolvedValue({
        status: 'unhealthy',
        timestamp: 0,
        checks: [
          { name: 'session-store', status: 'healthy' },
          { name: 'provider', status: 'unhealthy', detail: 'rate limited' },
          { name: 'cache', status: 'degraded', detail: 'stale' },
        ],
      }),
    };
    const cmd = buildHealthCommand(registry as never);
    const res = await cmd.run('', {} as never);
    const out = res!.message ?? '';
    expect(out).toContain('overall: unhealthy');
    expect(out).toContain('session-store: healthy');
    expect(out).toContain('provider: unhealthy');
    expect(out).toContain('rate limited');
    expect(out).toContain('cache: degraded');
  });

  it('returns the aggregate result as JSON and metadata', async () => {
    const aggregate = {
      status: 'degraded',
      timestamp: 123,
      checks: [{ name: 'mcp', status: 'degraded', detail: '1 reconnecting' }],
    };
    const cmd = buildHealthCommand({ run: vi.fn().mockResolvedValue(aggregate) } as never);
    const res = await cmd.run('--json', {} as never);
    expect(JSON.parse(res!.message!)).toEqual(aggregate);
    expect(res!.metadata?.['health']).toEqual(aggregate);
  });
});
