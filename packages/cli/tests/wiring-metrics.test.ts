import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMcpHealthCheck, setupMetrics } from '../src/wiring/metrics.js';

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
      metricsStatus: { collectionEnabled: false, httpExporter: 'disabled' },
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
      expect(out.metricsStatus).toEqual({
        collectionEnabled: true,
        httpExporter: 'listening',
      });
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
      expect(out.metricsStatus).toEqual({
        collectionEnabled: true,
        httpExporter: 'disabled',
      });
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
      expect(out.metricsStatus.httpExporter).toBe('failed');
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
    expect(session?.detail).not.toContain(missing);
    const projectStorage = checks.find((c: { name: string }) => c.name === 'project-storage');
    expect(projectStorage?.status).toBe('unhealthy');
    expect(projectStorage?.detail).not.toContain(missing);
    const provider = checks.find((c: { name: string }) => c.name === 'provider');
    expect(provider?.status).toBe('healthy');
    expect(provider?.detail).toBe('configured');
    expect(provider).not.toHaveProperty('data');
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
      const projectStorage = checks.find((c: { name: string }) => c.name === 'project-storage');
      expect(projectStorage?.status).toBe('healthy');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('ignores non-finite metrics-port without starting server', async () => {
    const tmp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'wmtest-'));
    try {
      const out = setupMetrics({
        flags: { 'metrics-port': 'not-a-number' },
        wpaths: makeWpaths(tmp),
        events: { on: vi.fn() } as never,
        logger: makeLogger(),
        config: { provider: 'a', model: 'm' },
      });
      expect(startMetricsServerMock).not.toHaveBeenCalled();
      expect(out.metricsStatus.httpExporter).toBe('failed');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('registerMcpHealthCheck', () => {
  function captureCheck(servers: Array<{ name: string; state: string; enabled: boolean }>) {
    const register = vi.fn();
    registerMcpHealthCheck(
      { register } as never,
      {
        describe: () => servers.map((server) => ({ ...server, toolCount: 0, tools: [] })),
      } as never,
    );
    return register.mock.calls[0]![0] as { check(): Promise<{ status: string; detail: string }> };
  }

  it('does not register when health collection is disabled', () => {
    expect(() => registerMcpHealthCheck(undefined, { describe: vi.fn() } as never)).not.toThrow();
  });

  it('treats no configured servers and lazy dormant servers as healthy', async () => {
    expect(await captureCheck([]).check()).toMatchObject({
      status: 'healthy',
      detail: 'no servers configured',
    });
    expect(
      await captureCheck([
        { name: 'private-server-name', state: 'connected', enabled: true },
        { name: 'lazy-secret-server', state: 'dormant', enabled: true },
      ]).check(),
    ).toMatchObject({ status: 'healthy', detail: '1 connected, 1 dormant' });
  });

  it('reports transitional states as degraded without exposing server names', async () => {
    const result = await captureCheck([
      { name: 'sensitive-server-name', state: 'reconnecting', enabled: true },
      { name: 'ready', state: 'connected', enabled: true },
    ]).check();
    expect(result).toMatchObject({ status: 'degraded', detail: '1 connected, 1 reconnecting' });
    expect(result.detail).not.toContain('sensitive-server-name');
  });

  it('reports a failed enabled server as unhealthy and ignores disabled servers', async () => {
    const result = await captureCheck([
      { name: 'failed-private-server', state: 'failed', enabled: true },
      { name: 'disabled-private-server', state: 'failed', enabled: false },
    ]).check();
    expect(result).toMatchObject({ status: 'unhealthy', detail: '1 failed' });
    expect(result.detail).not.toContain('private-server');
  });

  it('reports unhealthy when registry describe throws', async () => {
    const register = vi.fn();
    registerMcpHealthCheck(
      { register } as never,
      { describe: () => { throw new Error('boom'); } } as never,
    );
    const result = await (register.mock.calls[0]![0] as { check(): Promise<unknown> }).check();
    expect(result).toMatchObject({ status: 'unhealthy', detail: 'registry status unavailable' });
  });
});
