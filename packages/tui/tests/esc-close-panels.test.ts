import { describe, expect, it } from 'vitest';
import { escCloseAction, ESC_CLOSE_PANELS } from '../src/esc-close-panels.js';
import { createInitialState } from '../src/app-initial-state.js';
import type { State } from '../src/app-reducer.js';

function patch(state: State, p: Partial<State>): State {
  return { ...state, ...p };
}

const baseState = createInitialState({
  banner: false,
  restoredEntries: [],
  enhanceEnabled: true,
});

describe('escCloseAction', () => {
  it('returns null when no panel is open', () => {
    expect(escCloseAction(baseState)).toBeNull();
  });

  it('closes agentsMonitor when open', () => {
    const s = patch(baseState, { agentsMonitorOpen: true });
    const action = escCloseAction(s);
    expect(action).toEqual({ type: 'toggleAgentsMonitor' });
  });

  it('closes fleetMonitor when open', () => {
    const s = patch(baseState, { monitorOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleMonitor' });
  });

  it('closes todosMonitor when open', () => {
    const s = patch(baseState, { todosMonitorOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleTodosMonitor' });
  });

  it('closes queuePanel when open', () => {
    const s = patch(baseState, { queuePanelOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleQueuePanel' });
  });

  it('closes processList when open', () => {
    const s = patch(baseState, { processListOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleProcessList' });
  });

  it('closes goalPanel when open', () => {
    const s = patch(baseState, { goalPanelOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleGoalPanel' });
  });

  it('closes contextPanel when open', () => {
    const s = patch(baseState, { contextPanelOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleContextPanel' });
  });

  it('closes planPanel when open', () => {
    const s = patch(baseState, { planPanelOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'togglePlanPanel' });
  });

  it('closes cronMonitor when open', () => {
    const s = patch(baseState, { cronMonitorOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleCronMonitor' });
  });

  it('closes sddBoard monitor when open', () => {
    const s = patch(baseState, {
      sddBoard: { ...baseState.sddBoard!, monitorOpen: true },
    });
    expect(escCloseAction(s)).toEqual({ type: 'toggleSddBoardMonitor' });
  });

  it('closes coordinator monitor when open', () => {
    const s = patch(baseState, {
      coordinator: { ...baseState.coordinator, monitorOpen: true },
    });
    expect(escCloseAction(s)).toEqual({ type: 'toggleCoordinatorMonitor' });
  });

  it('closes sessionsPanel when open', () => {
    const s = patch(baseState, { sessionsPanelOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleSessionsPanel' });
  });

  it('closes settingsPicker when open', () => {
    const s = patch(baseState, {
      settingsPicker: { ...baseState.settingsPicker, open: true },
    });
    expect(escCloseAction(s)).toEqual({ type: 'settingsClose' });
  });

  it('closes projectPicker when open', () => {
    const s = patch(baseState, {
      projectPicker: { ...baseState.projectPicker, open: true },
    });
    expect(escCloseAction(s)).toEqual({ type: 'projectPickerClose' });
  });

  it('closes helpOverlay when open', () => {
    const s = patch(baseState, { helpOpen: true });
    expect(escCloseAction(s)).toEqual({ type: 'toggleHelp' });
  });

  it('every entry name is unique', () => {
    const names = ESC_CLOSE_PANELS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
