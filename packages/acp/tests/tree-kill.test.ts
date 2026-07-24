import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { treeKill } from '../src/tree-kill.js';

const REAL_PLATFORM = process.platform;

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

/** A fake taskkill process whose 'error' event can be emitted on demand. */
function fakeKiller(): EventEmitter & { unref: () => void } {
  const ee = new EventEmitter() as EventEmitter & { unref: () => void };
  ee.unref = vi.fn();
  return ee;
}

afterEach(() => {
  setPlatform(REAL_PLATFORM);
  spawnMock.mockReset();
  vi.useRealTimers();
});

describe('treeKill', () => {
  it('falls back to child.kill() when pid is undefined', () => {
    const kill = vi.fn();
    treeKill({ pid: undefined, kill });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('on Windows spawns taskkill /T /F for the whole tree', () => {
    setPlatform('win32');
    spawnMock.mockReturnValue(fakeKiller());
    const kill = vi.fn();
    treeKill({ pid: 4321, kill });
    expect(spawnMock).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4321', '/T', '/F'],
      expect.objectContaining({ windowsHide: true }),
    );
    // taskkill owns the teardown; the direct kill is only a fallback.
    expect(kill).not.toHaveBeenCalled();
  });

  it('on Windows falls back to child.kill() if taskkill fails to spawn', () => {
    setPlatform('win32');
    const killer = fakeKiller();
    spawnMock.mockReturnValue(killer);
    const kill = vi.fn();
    treeKill({ pid: 42, kill });
    killer.emit('error', new Error('ENOENT'));
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('on POSIX sends SIGTERM then a SIGKILL backstop', () => {
    setPlatform('linux');
    vi.useFakeTimers();
    const kill = vi.fn();
    treeKill({ pid: 99, kill });
    expect(kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(spawnMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });
});
