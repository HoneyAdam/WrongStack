import { describe, expect, it, vi, afterEach } from 'vitest';
import { isPidAlive } from '../../src/utils/pid.js';

/**
 * The predicate these tests pin was duplicated across six subsystems with
 * four different semantics. The variant that mattered was `catch { return
 * false }`: on POSIX `process.kill(pid, 0)` throws EPERM when the process
 * EXISTS but is not ours to signal, so a bare catch reported a live process
 * as dead — pruning live sessions from the registry and letting a second
 * director steal a running director's lock.
 */
describe('isPidAlive', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports our own process as alive without signalling it', () => {
    const kill = vi.spyOn(process, 'kill');
    expect(isPidAlive(process.pid)).toBe(true);
    expect(kill).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the invalid pid %s', (pid) => {
    expect(isPidAlive(pid)).toBe(false);
  });

  it('treats EPERM as ALIVE (exists, not signalable)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    });
    expect(isPidAlive(999_999)).toBe(true);
  });

  it('treats ESRCH as dead', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    });
    expect(isPidAlive(999_999)).toBe(false);
  });

  it('fails closed on an unrecognized error code', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('boom'), { code: 'EWHAT' });
    });
    expect(isPidAlive(999_999)).toBe(false);
  });

  it('reports a live pid as alive when the signal probe succeeds', () => {
    vi.spyOn(process, 'kill').mockReturnValue(true as unknown as boolean);
    expect(isPidAlive(999_999)).toBe(true);
  });
});
