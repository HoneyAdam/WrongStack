import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSnapshotBroadcaster } from '../src/hq-server/snapshot.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('HQ snapshot broadcaster shutdown', () => {
  it('ignores late socket broadcasts after close', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const persistence = {
      snapshotStore: { save },
    } as unknown as NonNullable<Parameters<typeof createSnapshotBroadcaster>[2]>;
    const clients = new Map() as Parameters<typeof createSnapshotBroadcaster>[0];
    const browsers = new Set() as Parameters<typeof createSnapshotBroadcaster>[1];
    const broadcaster = createSnapshotBroadcaster(clients, browsers, persistence);

    broadcaster.currentSerialized();
    expect(save).toHaveBeenCalledTimes(1);

    broadcaster.close();
    broadcaster.broadcast();
    vi.runAllTimers();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancels an already queued snapshot flush on close', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const persistence = {
      snapshotStore: { save },
    } as unknown as NonNullable<Parameters<typeof createSnapshotBroadcaster>[2]>;
    const broadcaster = createSnapshotBroadcaster(
      new Map() as Parameters<typeof createSnapshotBroadcaster>[0],
      new Set() as Parameters<typeof createSnapshotBroadcaster>[1],
      persistence,
    );

    broadcaster.broadcast();
    broadcaster.close();
    vi.runAllTimers();

    expect(save).not.toHaveBeenCalled();
  });
});
