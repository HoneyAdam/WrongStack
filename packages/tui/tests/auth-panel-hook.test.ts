import { render } from 'ink-testing-library';
import React, { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Action, reducer, type State } from '../src/app-reducer.js';
import { AUTH_PANEL_INITIAL } from '../src/components/auth-panel-model.js';
import { type AuthPanelController, useAuthPanel } from '../src/hooks/use-auth-panel.js';
import { Text } from '../src/ink.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function initialState(): State {
  return {
    authPanel: { ...AUTH_PANEL_INITIAL },
    monitorOpen: false,
    agentsMonitorOpen: false,
    helpOpen: false,
    todosMonitorOpen: false,
    queuePanelOpen: false,
    processListOpen: false,
    auditPanelOpen: false,
    planPanelOpen: false,
    goalPanelOpen: false,
    sessionsPanelOpen: false,
    settingsPicker: { open: false },
    statuslinePicker: { open: false, field: 0, hiddenItems: [], visibleChips: [] },
    pluginPicker: { open: false, items: [], selected: 0, busy: false },
    projectPicker: { open: false, allItems: [], items: [], selected: 0, filter: '' },
    fKeyPicker: { open: false, selected: 0 },
    autoPhase: undefined,
    sddBoard: undefined,
    worktreeMonitorOpen: false,
    coordinator: { monitorOpen: false },
  } as unknown as State;
}

interface Harness {
  controller: AuthPanelController;
  state: State;
  actions: Action[];
  dispatch(action: Action): void;
  rerender(): void;
  unmount(): void;
}

function createHarness(): Harness {
  const stateRef = { current: initialState() };
  const actions: Action[] = [];
  let controller: AuthPanelController | undefined;
  const dispatch = (action: Action) => {
    actions.push(action);
    stateRef.current = reducer(stateRef.current, action);
  };

  function HookHarness(): React.ReactElement {
    const next = useAuthPanel({
      authHost: undefined,
      stateRef,
      dispatch,
      open: stateRef.current.authPanel.open,
    });
    useEffect(() => {
      controller = next;
    }, [next]);
    return React.createElement(Text, null, stateRef.current.authPanel.input?.label ?? 'idle');
  }

  const view = render(React.createElement(HookHarness));
  return {
    get controller() {
      if (!controller) throw new Error('Auth panel controller did not mount');
      return controller;
    },
    get state() {
      return stateRef.current;
    },
    actions,
    dispatch,
    rerender: () => view.rerender(React.createElement(HookHarness)),
    unmount: () => view.unmount(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAuthPanel standalone secret prompts', () => {
  it('opens a masked prompt, resolves the draft, and closes the standalone panel', async () => {
    let harness!: Harness;
    act(() => {
      harness = createHarness();
    });

    let secret!: Promise<string>;
    act(() => {
      secret = harness.controller.readSecret('Telegram bot token');
      harness.rerender();
    });
    expect(harness.state.authPanel.open).toBe(true);
    expect(harness.state.authPanel.input).toEqual({
      label: 'Telegram bot token',
      masked: true,
      draft: '',
    });

    act(() => harness.dispatch({ type: 'authPromptChange', draft: '123:secret' }));
    act(() => harness.controller.onAuthPromptSubmit());
    await expect(secret).resolves.toBe('123:secret');
    expect(harness.state.authPanel.input).toBeUndefined();
    expect(harness.state.authPanel.open).toBe(false);

    act(() => harness.unmount());
  });

  it('rejects cancellation with AbortError and closes the standalone panel', async () => {
    let harness!: Harness;
    act(() => {
      harness = createHarness();
    });
    let secret!: Promise<string>;
    act(() => {
      secret = harness.controller.readSecret('API key');
    });

    act(() => harness.controller.onAuthPromptCancel());
    await expect(secret).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelled' });
    expect(harness.state.authPanel.input).toBeUndefined();
    expect(harness.state.authPanel.open).toBe(false);

    act(() => harness.unmount());
  });

  it('ends and rejects a displaced prompt before opening its replacement', async () => {
    let harness!: Harness;
    act(() => {
      harness = createHarness();
    });
    let first!: Promise<string>;
    let second!: Promise<string>;
    act(() => {
      first = harness.controller.readSecret('First secret');
      second = harness.controller.readSecret('Second secret');
    });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.actions.map((action) => action.type).slice(-4)).toEqual([
      'authPromptStart',
      'authPromptEnd',
      'authOpen',
      'authPromptStart',
    ]);
    expect(harness.state.authPanel.input).toMatchObject({ label: 'Second secret', masked: true });

    act(() => harness.controller.onAuthPromptCancel());
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    act(() => harness.unmount());
  });
});
