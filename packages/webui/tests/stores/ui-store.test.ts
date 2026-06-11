import { describe, expect, it } from 'vitest';
import {
  coerceActivity,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useUIStore,
} from '../../src/stores/ui-store';

// ── coerceActivity — legacy persisted values ───────────────────────────

describe('coerceActivity', () => {
  it('passes current activities through unchanged', () => {
    for (const a of ['chat', 'agents', 'history', 'files', 'projects', 'mailbox'] as const) {
      expect(coerceActivity(a)).toBe(a);
    }
  });

  it('maps removed legacy activities onto their new homes', () => {
    expect(coerceActivity('context')).toBe('chat');
    expect(coerceActivity('sessions')).toBe('history');
  });

  it('falls back to chat for garbage values', () => {
    expect(coerceActivity(undefined)).toBe('chat');
    expect(coerceActivity(null)).toBe('chat');
    expect(coerceActivity(42)).toBe('chat');
    expect(coerceActivity('not-a-panel')).toBe('chat');
  });
});

// ── sidebar width — single clamp in the store ──────────────────────────

describe('setSidebarWidth clamp', () => {
  it('clamps below the minimum', () => {
    useUIStore.getState().setSidebarWidth(10);
    expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('clamps above the maximum', () => {
    useUIStore.getState().setSidebarWidth(5000);
    expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('rounds and accepts in-range values', () => {
    useUIStore.getState().setSidebarWidth(333.4);
    expect(useUIStore.getState().sidebarWidth).toBe(333);
  });

  it('keeps the default within bounds', () => {
    expect(SIDEBAR_DEFAULT_WIDTH).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
    expect(SIDEBAR_DEFAULT_WIDTH).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH);
  });
});

// ── selectActivity ─────────────────────────────────────────────────────

describe('selectActivity', () => {
  it('switches the active activity', () => {
    useUIStore.getState().selectActivity('mailbox');
    expect(useUIStore.getState().activeActivity).toBe('mailbox');
    useUIStore.getState().selectActivity('chat');
    expect(useUIStore.getState().activeActivity).toBe('chat');
  });
});
