import { describe, expect, it, vi } from 'vitest';
import { buildHealthCommand } from '../src/slash-commands/health.js';

describe('/health', () => {
  it('reports "health checks not enabled" without registry', async () => {
    const cmd = buildHealthCommand({});
    const res = await cmd.run('');
    expect(res.message).toContain('Health checks not enabled');
  });

  it('exposes deep help and structured unavailable output', async () => {
    const cmd = buildHealthCommand({});
    expect(cmd.category).toBe('Inspect');
    expect(cmd.argsHint).toBe('[--json]');
    expect(cmd.help).toContain('Usage: /health [--json]');

    const res = await cmd.run('--json');
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
    const cmd = buildHealthCommand({ healthRegistry: registry as never });
    const res = await cmd.run('');
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
    const cmd = buildHealthCommand({ healthRegistry: { run: vi.fn().mockResolvedValue(aggregate) } as never });
    const res = await cmd.run('--json');
    expect(JSON.parse(res!.message!)).toEqual(aggregate);
    expect(res!.metadata?.['health']).toEqual(aggregate);
  });
});
