import { describe, expect, it } from 'vitest';
import {
  actionForFKeyPanel,
  F_KEY_PANEL_ENTRIES,
  fKeyEntryFor,
} from '../src/f-key-panels.js';

describe('fKeyEntryFor', () => {
  it('returns null when no key is pressed', () => {
    expect(fKeyEntryFor(undefined, false, '')).toBeNull();
  });

  it('returns null for fn=0 (invalid)', () => {
    expect(fKeyEntryFor(0, false, '')).toBeNull();
  });

  it('returns null for fn=13 (out of range)', () => {
    expect(fKeyEntryFor(13, false, '')).toBeNull();
  });

  // ── Plain F-key matching ──────────────────────────────────
  it('matches F1 → project switcher', () => {
    const entry = fKeyEntryFor(1, false, '');
    expect(entry?.key).toBe(1);
    expect(entry?.action).toBe('projectPickerOpen');
  });

  it('matches F5 → plan panel', () => {
    const entry = fKeyEntryFor(5, false, '');
    expect(entry?.key).toBe(5);
    expect(entry?.action).toBe('togglePlanPanel');
  });

  it('matches F12 → statusline picker', () => {
    const entry = fKeyEntryFor(12, false, '');
    expect(entry?.key).toBe(12);
    expect(entry?.action).toBe('statuslineOpen');
  });

  // ── Ctrl chord alias matching ─────────────────────────────
  it('matches Ctrl+F → F2 fleet monitor', () => {
    const entry = fKeyEntryFor(undefined, true, 'f');
    expect(entry?.key).toBe(2);
    expect(entry?.action).toBe('toggleMonitor');
  });

  it('matches Ctrl+G → F3 agents monitor', () => {
    const entry = fKeyEntryFor(undefined, true, 'g');
    expect(entry?.key).toBe(3);
    expect(entry?.action).toBe('toggleAgentsMonitor');
  });

  it('matches Ctrl+T → F4 worktree monitor', () => {
    const entry = fKeyEntryFor(undefined, true, 't');
    expect(entry?.key).toBe(4);
    expect(entry?.action).toBe('toggleWorktreeMonitor');
  });

  it('returns null for Ctrl+B (not in the table)', () => {
    expect(fKeyEntryFor(undefined, true, 'b')).toBeNull();
  });

  it('returns null for Ctrl+S (not in the table)', () => {
    expect(fKeyEntryFor(undefined, true, 's')).toBeNull();
  });

  // ── F-key takes priority over Ctrl alias ──────────────────
  it('F-key takes priority over Ctrl alias when both are set', () => {
    // Some terminals may deliver fn=2 AND ctrl=true + input='f' simultaneously.
    // The F-key should win.
    const entry = fKeyEntryFor(2, true, 'f');
    expect(entry?.key).toBe(2);
  });

  // ── hostAction field ──────────────────────────────────────
  it('F1 entry has hostAction openProjectPicker', () => {
    const entry = fKeyEntryFor(1, false, '');
    expect(entry?.hostAction).toBe('openProjectPicker');
  });

  it('F10 entry has hostAction loadLiveSessions', () => {
    const entry = fKeyEntryFor(10, false, '');
    expect(entry?.hostAction).toBe('loadLiveSessions');
  });

  it('F12 entry has hostAction openStatuslinePicker', () => {
    const entry = fKeyEntryFor(12, false, '');
    expect(entry?.hostAction).toBe('openStatuslinePicker');
  });

  it('entries without hostAction have undefined', () => {
    const entry = fKeyEntryFor(5, false, '');
    expect(entry?.hostAction).toBeUndefined();
  });

  // ── ctrlAlias field ───────────────────────────────────────
  it('F2 entry has ctrlAlias f', () => {
    expect(fKeyEntryFor(2, false, '')?.ctrlAlias).toBe('f');
  });

  it('F5 entry has no ctrlAlias', () => {
    expect(fKeyEntryFor(5, false, '')?.ctrlAlias).toBeUndefined();
  });
});

describe('actionForFKeyPanel (integration with fKeyEntryFor)', () => {
  it('returns null for F1 (hostAction, no direct action)', () => {
    const entry = fKeyEntryFor(1, false, '');
    expect(actionForFKeyPanel(entry!)).toBeNull();
  });

  it('returns toggleMonitor for F2', () => {
    const entry = fKeyEntryFor(2, false, '');
    expect(actionForFKeyPanel(entry!)).toEqual({ type: 'toggleMonitor' });
  });

  it('returns statuslineOpen action for F12', () => {
    const entry = fKeyEntryFor(12, false, '');
    expect(actionForFKeyPanel(entry!)).toEqual({ type: 'statuslineOpen', hiddenItems: [] });
  });
});

describe('F_KEY_PANEL_ENTRIES table integrity', () => {
  it('has exactly 12 entries', () => {
    expect(F_KEY_PANEL_ENTRIES).toHaveLength(12);
  });

  it('keys are 1 through 12 in order', () => {
    F_KEY_PANEL_ENTRIES.forEach((entry, i) => {
      expect(entry.key).toBe(i + 1);
    });
  });

  it('every entry has a unique action', () => {
    const actions = F_KEY_PANEL_ENTRIES.map((e) => e.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('every entry has a non-empty label and helpKeys', () => {
    for (const entry of F_KEY_PANEL_ENTRIES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.helpKeys.length).toBeGreaterThan(0);
    }
  });

  it('ctrlAlias entries are unique', () => {
    const aliases = F_KEY_PANEL_ENTRIES
      .map((e) => e.ctrlAlias)
      .filter((a): a is string => a !== undefined);
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});
