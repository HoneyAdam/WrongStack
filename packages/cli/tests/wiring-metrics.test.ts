import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { setupMetrics } from '../src/wiring/metrics.js';

// We control startMetricsServer to assert wiring without binding a real socket.
const startMetricsServerMock = vi.fn();
vi.mock('@wrongstack/core', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    startMetricsServer: (...args: unknown[]) => startMetricsServerMock(...args),
  };
});

function makeWpaths(tmp: string) {
  return {
    projectSessions: tmp,
    configDir: tmp,
    globalConfig: path.join(tmp, 'config.json'),
    projectDir: tmp,
    globalRoot: tmp,
  } as never;
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

beforeEach(() => {
  startMetricsServerMock.mockReset();
  startMetricsServerMock.mockReturnValue({
    url: 'http://127.0.0.1:9999',
    close: vi.fn().mockResolvedValue(undefined),
  });
});

describe('setupMetrics', () => {
  it('returns empty result when metrics flag is absent', () => {
    const out = setupMetrics({
      flags: {},
      wpaths: makeWpaths('/tmp'),
      events: {} as never,
      logger: makeLogger(),
      config: { provider: 'a', model: 'm' },
    });
    expect(out).toEqual({
      metricsSink: undefined,
      healthRegistry: undefined,
      metricsServerHandle: undefined,
    });
    expect(startMetricsServerMock).not.toHaveBeenCalled();
  });

  it('enables metrics implicitly when metrics-port is provided', async () => {
    const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'wmtest-'));
    try {
      const out = setupMetrics({
        flags: { 'metrics-port': '9876' },
        wpaths: makeWpaths(tmp),
        events: { on: vi.fn() } as never,
        logger: makeLogger(),
        config: { provider: 'a', model: 'm' },
      });
      expect(out.metricsSink).toBeDefined();
      expect(out.healthRegistry).toBeDefined();
      expect(startMetricsServerMock).toHaveBeenCalledWith(
        expect.objectContaining({ port: 9876, host: '127.0.0.1' }),
      );
      expect(out.metricsServerHandle).toBeDefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('starts in-memory sink only when metrics=true without port', async () => {
    const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'wmtest-'));
    try {
      const out = setupMetrics({
        flags: { metrics: true },
        wpaths: makeWpaths(tmp),
        events: { on: vi.fn() } as never,
        logger: makeLogger(),
        config: { provider: 'a', model: 'm' },
      });
      expect(out.metricsSink).toBeDefined();
      expect(out.healthRegistry).toBeDefined();
      expect(out.metricsServerHandle).toBeUndefined();
      expect(startMetricsServerMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('warns and continues when startMetricsServer throws', async () => {
    startMetricsServerMock.mockImplementation(() => {
      throw new Error('EADDRINUSE');
    });
    const logger = makeLogger();
    const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'wmtest-'));
    try {
      const out = setupMetrics({
        flags: { metrics: true, 'metrics-port': '9876' },
        wpaths: makeWpaths(tmp),
        events: { on: vi.fn() } as never,
        logger,
        config: { provider: 'a', model: 'm' },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('metrics endpoint failed to start'),
      );
      expect(out.metricsSink).toBeDefined();
      expect(out.metricsServerHandle).toBeUndefined();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('registers session-store health check that reports unhealthy on missing dir', async () => {
    const missing = path.join(require('node:os').tmpdir(), 'definitely-not-there-' + Date.now());
    const out = setupMetrics({
      flags: { metrics: true },
      wpaths: makeWpaths(missing),
      events: { on: vi.fn() } as never,
      logger: makeLogger(),
      config: { provider: 'a', model: 'm' },
    });
    const checks = (await out.healthRegistry!.run()).checks;
    const session = checks.find((c: { name: string }) => c.name === 'session-store');
    expect(session?.status).toBe('unhealthy');
    const provider = checks.find((c: { name: string }) => c.name === 'provider');
    expect(provider?.status).toBe('healthy');
    expect((provider as { data: { id: string; model: string } }).data).toEqual({
      id: 'a',
      model: 'm',
    });
  });

  it('registers session-store health check that reports healthy when dir exists', async () => {
    const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'wmtest-'));
    try {
      const out = setupMetrics({
        flags: { metrics: true },
        wpaths: makeWpaths(tmp),
        events: { on: vi.fn() } as never,
        logger: makeLogger(),
        config: { provider: 'a', model: 'm' },
      });
      const checks = (await out.healthRegistry!.run()).checks;
      const session = checks.find((c: { name: string }) => c.name === 'session-store');
      expect(session?.status).toBe('healthy');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('ignores non-finite metrics-port without starting server', async () => {
    const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'wmtest-'));
    try {
      setupMetrics({
        flags: { 'metrics-port': 'not-a-number' },
        wpaths: makeWpaths(tmp),
        events: { on: vi.fn() } as never,
        logger: makeLogger(),
        config: { provider: 'a', model: 'm' },
      });
      expect(startMetricsServerMock).not.toHaveBeenCalled();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
