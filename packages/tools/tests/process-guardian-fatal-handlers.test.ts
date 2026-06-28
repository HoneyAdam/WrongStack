import { afterEach, describe, expect, it, vi } from 'vitest';

// Spy on process.exit so the test process doesn't actually die, and so we can
// assert the guardian asked for a fatal exit on uncaught / unhandled.
const exitSpy = vi.hoisted(() => vi.fn());
vi.spyOn(process, 'exit').mockImplementation(exitSpy as never);

// Mock the persistent registry so start() doesn't touch the filesystem or the
// process-registry-persistent module's heartbeat timers.
vi.mock('../src/process-registry-persistent.js', () => ({
  getPersistentProcessRegistry: () => ({
    getInstanceId: () => 'test-instance',
    registerChildProcess: vi.fn(),
    unregister: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }),
}));

const { ProcessGuardian } = await import('../src/process-guardian.js');

describe('ProcessGuardian fatal handlers', () => {
  afterEach(() => {
    exitSpy.mockClear();
    // Defensive: if a test added a real handler, peel it back off so we don't
    // leak across the rest of the suite.
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  it('exits with code 1 when uncaughtException fires', () => {
    const g = new ProcessGuardian({ heartbeatIntervalMs: 60_000 });
    g.start();

    const err = new Error('boom');
    process.emit('uncaughtException', err);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    g.stop();
  });

  it('exits with code 1 when unhandledRejection fires with an Error reason', () => {
    const g = new ProcessGuardian({ heartbeatIntervalMs: 60_000 });
    g.start();

    process.emit('unhandledRejection', new Error('rejected'));

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    g.stop();
  });

  it('exits with code 1 when unhandledRejection fires with a non-Error reason', () => {
    const g = new ProcessGuardian({ heartbeatIntervalMs: 60_000 });
    g.start();

    process.emit('unhandledRejection', 'string-reason');

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    g.stop();
  });
});