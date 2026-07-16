import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractActivitiesFromMessage,
  useCodemapActivityStore,
  type FileActivity,
} from '../../src/stores/codemap-activity-store';
import type { WSServerMessage } from '../../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeActivity(filePath: string, type: FileActivity['type'], ts = Date.now()): FileActivity {
  return {
    filePath,
    type,
    toolName: 'test-tool',
    summary: 'test summary',
    timestamp: ts,
  };
}

function makeMsg(type: string, payload: Record<string, unknown>): WSServerMessage {
  return {
    type: type as WSServerMessage['type'],
    payload,
  } as WSServerMessage;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('codemap-activity-store', () => {
  beforeEach(() => {
    useCodemapActivityStore.getState().clear();
  });

  // ── recordActivity ──────────────────────────────────────────────────────────

  describe('recordActivity', () => {
    it('records a single activity in history with newest-first ordering', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('src/foo.ts', 'read', 1000));
      store.recordActivity(makeActivity('src/foo.ts', 'write', 2000));

      const history = store.getActivityForFile('src/foo.ts');
      expect(history).toHaveLength(2);
      expect(history[0]!.timestamp).toBe(2000);
      expect(history[1]!.timestamp).toBe(1000);
    });

    it('increments totalCount on each record', () => {
      const store = useCodemapActivityStore.getState();
      expect(store.totalCount).toBe(0);
      store.recordActivity(makeActivity('a.ts', 'read'));
      store.recordActivity(makeActivity('b.ts', 'write'));
      expect(useCodemapActivityStore.getState().totalCount).toBe(2);
    });

    it('sets a pulse for the active file', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('src/bar.ts', 'edit'));
      const pulsing = store.getPulsingFiles();
      expect(pulsing.has('src/bar.ts')).toBe(true);
    });

    it('caps per-file history at MAX_HISTORY_PER_FILE (200)', () => {
      const store = useCodemapActivityStore.getState();
      for (let i = 0; i < 250; i++) {
        store.recordActivity(makeActivity('cap.ts', 'read', i));
      }
      const history = store.getActivityForFile('cap.ts');
      expect(history).toHaveLength(200);
      // Newest 200 should be kept (timestamps 50..249)
      expect(history[0]!.timestamp).toBe(249);
      expect(history[199]!.timestamp).toBe(50);
    });

    it('isolates per-file history — recording file A does not affect file B', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('a.ts', 'read'));
      store.recordActivity(makeActivity('a.ts', 'write'));
      store.recordActivity(makeActivity('b.ts', 'edit'));

      expect(store.getActivityForFile('a.ts')).toHaveLength(2);
      expect(store.getActivityForFile('b.ts')).toHaveLength(1);
    });

    it('does not mutate the previous state Map (immutability)', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('immutable.ts', 'read'));
      const stateBefore = useCodemapActivityStore.getState();
      const historyBefore = stateBefore.history;
      store.recordActivity(makeActivity('immutable.ts', 'write'));
      const stateAfter = useCodemapActivityStore.getState();

      // The old Map must be unchanged — the store should have created a new Map
      expect(stateAfter.history).not.toBe(historyBefore);
      expect(historyBefore.get('immutable.ts')).toHaveLength(1);
      expect(stateAfter.history.get('immutable.ts')).toHaveLength(2);
    });
  });

  // ── _sweep immutability ─────────────────────────────────────────────────────

  describe('_sweep (pulse expiry immutability)', () => {
    it('does not mutate the live pulses Map in place', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('sweep.ts', 'read'));
      const pulsesBefore = useCodemapActivityStore.getState().pulses;

      // Force expiry by backdating all pulses
      vi.useFakeTimers();
      vi.advanceTimersByTime(10_000);

      store._sweep();

      const pulsesAfter = useCodemapActivityStore.getState().pulses;

      // The old Map should still contain the entry (was not mutated)
      expect(pulsesBefore.has('sweep.ts')).toBe(true);
      // The new Map should have removed it
      expect(pulsesAfter.has('sweep.ts')).toBe(false);
      expect(pulsesAfter).not.toBe(pulsesBefore);

      vi.useRealTimers();
    });

    it('clears expired pulses and keeps active ones', () => {
      const store = useCodemapActivityStore.getState();
      vi.useFakeTimers();
      const t0 = Date.now();

      store.recordActivity(makeActivity('old.ts', 'read', t0));
      vi.advanceTimersByTime(10_000); // 10s later — old.ts pulse expired

      store.recordActivity(makeActivity('new.ts', 'read')); // fresh pulse
      store._sweep();

      const pulsing = store.getPulsingFiles();
      expect(pulsing.has('old.ts')).toBe(false);
      expect(pulsing.has('new.ts')).toBe(true);

      vi.useRealTimers();
    });

    it('is a no-op when no pulses are expired', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('alive.ts', 'read'));
      const stateBefore = useCodemapActivityStore.getState();
      store._sweep();
      const stateAfter = useCodemapActivityStore.getState();

      // No change — should not even call set()
      expect(stateAfter.pulses).toBe(stateBefore.pulses);
    });
  });

  // ── extractActivitiesFromMessage ────────────────────────────────────────────

  describe('extractActivitiesFromMessage', () => {
    it('extracts file paths from provider.response tool_use blocks', () => {
      const msg = makeMsg('provider.response', {
        blocks: [
          {
            type: 'tool_use',
            name: 'read',
            input: { path: 'packages/core/src/index.ts' },
          },
          {
            type: 'tool_use',
            name: 'edit',
            input: { path: 'packages/webui/src/App.tsx' },
          },
        ],
      });
      const activities = extractActivitiesFromMessage(msg);
      expect(activities).toHaveLength(2);
      expect(activities[0]!.filePath).toBe('packages/core/src/index.ts');
      expect(activities[0]!.type).toBe('read');
      expect(activities[1]!.filePath).toBe('packages/webui/src/App.tsx');
      expect(activities[1]!.type).toBe('edit');
    });

    it('skips non-tool_use blocks and unmapped tool names', () => {
      const msg = makeMsg('provider.response', {
        blocks: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', name: 'unknown_tool', input: { path: 'x.ts' } },
          { type: 'tool_use', name: 'grep', input: { pattern: 'foo' } },
        ],
      });
      const activities = extractActivitiesFromMessage(msg);
      // Only grep (mapped to 'search') should produce an activity — but it has
      // no file path and type 'search', so it goes to '(global)'
      expect(activities).toHaveLength(1);
      expect(activities[0]!.filePath).toBe('(global)');
      expect(activities[0]!.type).toBe('search');
    });

    it('returns empty array for non-array blocks', () => {
      const msg = makeMsg('provider.response', { blocks: 'not-an-array' });
      expect(extractActivitiesFromMessage(msg)).toEqual([]);
    });

    it('returns empty array when blocks is missing', () => {
      const msg = makeMsg('provider.response', {});
      expect(extractActivitiesFromMessage(msg)).toEqual([]);
    });

    it('extracts from file.saved messages', () => {
      const msg = makeMsg('file.saved', { filePath: 'src/saved.ts' });
      const activities = extractActivitiesFromMessage(msg);
      expect(activities).toHaveLength(1);
      expect(activities[0]!.filePath).toBe('src/saved.ts');
      expect(activities[0]!.type).toBe('write');
    });

    it('returns empty for file.saved without filePath', () => {
      const msg = makeMsg('file.saved', {});
      expect(extractActivitiesFromMessage(msg)).toEqual([]);
    });

    it('extracts from memory.event messages', () => {
      const msg = makeMsg('memory.event', { event: 'memory.staled', memoryId: 'mem-123' });
      const activities = extractActivitiesFromMessage(msg);
      expect(activities).toHaveLength(1);
      expect(activities[0]!.filePath).toBe('(memory)');
      expect(activities[0]!.type).toBe('memory');
      expect(activities[0]!.toolName).toBe('memory.memory.staled');
    });

    it('returns empty for memory.event without event field', () => {
      const msg = makeMsg('memory.event', {});
      expect(extractActivitiesFromMessage(msg)).toEqual([]);
    });

    it('returns empty array for unhandled message types', () => {
      const msg = makeMsg('session.start', { foo: 'bar' });
      expect(extractActivitiesFromMessage(msg)).toEqual([]);
    });

    it('maps multiple paths from a single tool_use (files field)', () => {
      const msg = makeMsg('provider.response', {
        blocks: [
          {
            type: 'tool_use',
            name: 'read',
            input: { path: 'a.ts', file: 'b.ts', files: 'c.ts' },
          },
        ],
      });
      const activities = extractActivitiesFromMessage(msg);
      expect(activities).toHaveLength(3);
      expect(activities.map((a) => a.filePath).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });
  });

  // ── clear ───────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('resets all state to empty', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('clear.ts', 'read'));
      store.recordActivity(makeActivity('other.ts', 'write'));
      expect(useCodemapActivityStore.getState().totalCount).toBe(2);

      store.clear();

      const after = useCodemapActivityStore.getState();
      expect(after.history.size).toBe(0);
      expect(after.pulses.size).toBe(0);
      expect(after.totalCount).toBe(0);
    });
  });

  // ── getPulseType ────────────────────────────────────────────────────────────

  describe('getPulseType', () => {
    it('returns the most recent activity type for a pulsing file', () => {
      const store = useCodemapActivityStore.getState();
      store.recordActivity(makeActivity('pulse.ts', 'read', 1000));
      store.recordActivity(makeActivity('pulse.ts', 'write', 2000));

      expect(store.getPulseType('pulse.ts')).toBe('write');
    });

    it('returns undefined for a non-pulsing file', () => {
      const store = useCodemapActivityStore.getState();
      expect(store.getPulseType('nonexistent.ts')).toBeUndefined();
    });
  });
});
