import { describe, expect, it } from 'vitest';
import type { State } from '../src/app-state.js';
import { reduceActivity } from '../src/reducers/activity.js';
import { reduceSettingsValues } from '../src/reducers/settings-values.js';
import { reduceWorkspacePanels } from '../src/reducers/workspace-panels.js';

describe('composed TUI domain reducers', () => {
  it('reduces viewport activity without passing through the root reducer', () => {
    const state = {
      viewportRows: 30,
      historyScrolled: false,
    } as State;

    const next = reduceActivity(state, { type: 'setHistoryScrolled', scrolled: true });

    expect(next.historyScrolled).toBe(true);
    expect(reduceActivity(next, { type: 'setViewportRows', rows: 42 }).viewportRows).toBe(42);
  });

  it('applies typed settings patches inside the settings domain', () => {
    const state = {
      settingsPicker: { mode: 'off', delayMs: 0, hint: 'old' },
    } as State;

    const next = reduceSettingsValues(state, {
      type: 'settingsValueSet',
      patch: { delayMs: 5_000 },
    });

    expect(next.settingsPicker.delayMs).toBe(5_000);
    expect(next.settingsPicker.hint).toBeUndefined();
  });

  it('owns worktree lifecycle transitions in the workspace domain', () => {
    const state = { worktrees: {}, worktreeBase: undefined } as State;

    const added = reduceWorkspacePanels(state, {
      type: 'worktreeUpsert',
      handleId: 'wt-1',
      row: { branch: 'feature/domain-reducers', ownerLabel: 'worker' },
      baseBranch: 'main',
    });
    const removed = reduceWorkspacePanels(added, {
      type: 'worktreeRemove',
      handleId: 'wt-1',
    });

    expect(added.worktrees['wt-1']?.branch).toBe('feature/domain-reducers');
    expect(added.worktreeBase).toBe('main');
    expect(removed.worktrees).toEqual({});
  });
});
