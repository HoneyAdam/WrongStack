import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React, { useEffect } from 'react';
import { usePickerKeys, type PickerKeysHost } from '../src/hooks/use-picker-keys.js';
import type { KeyEvent } from '../src/components/input.js';
import type { State } from '../src/app-reducer.js';
import type { ProviderOption } from '../src/components/model-picker.js';
import type { ModeOption } from '../src/components/mode-picker.js';

function key(overrides: Partial<KeyEvent> = {}): KeyEvent {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    ctrl: false,
    meta: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    ...overrides,
  };
}

function baseState(overrides: Partial<State> = {}): State {
  return {
    authPanel: { open: false },
    modelPicker: {
      open: false,
      step: 'provider',
      providerOptions: [],
      modelOptions: [],
      filteredOptions: [],
      selected: 0,
      searchQuery: '',
    },
    modePicker: { open: false, modes: [], selected: 0 },
    autonomyPicker: { open: false, options: [], selected: 0 },
    designPicker: { open: false, kits: [], selected: 0, stack: 'web' },
    promptPicker: { open: false, all: [], categories: [], recentSlugs: [], catIndex: 0, selected: 0 },
    resumePicker: { open: false, sessions: [], selected: 0, busy: false },
    settingsPicker: { open: false, field: 0, mode: 'off', delayMs: 0 },
    pluginPicker: { open: false, items: [], selected: 0, busy: false },
    fKeyPicker: { open: false, selected: 0 },
    picker: { open: false, query: '', matches: [], selected: 0 },
    slashPicker: { open: false, query: '', matches: [], selected: 0 },
    projectPicker: { open: false, allItems: [], items: [], selected: 0, filter: '' },
    statuslinePicker: { open: false, field: 0, hiddenItems: [], visibleChips: [] },
    sendModePicker: null,
    processListOpen: false,
    helpOpen: false,
    monitorOpen: false,
    agentsMonitorOpen: false,
    worktreeMonitorOpen: false,
    todosMonitorOpen: false,
    queuePanelOpen: false,
    goalPanelOpen: false,
    sessionsPanelOpen: false,
    coordinator: { monitorOpen: false, goals: [], timeline: [], knowledgeCount: 0, healthy: false },
    goalRun: null,
    rewindOverlay: null,
    ...overrides,
  } as unknown as State;
}

function makeHost(state: State, overrides: Partial<PickerKeysHost> = {}): PickerKeysHost & {
  dispatch: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  switchProviderAndModel: ReturnType<typeof vi.fn>;
  setLiveProvider: ReturnType<typeof vi.fn>;
  setLiveModel: ReturnType<typeof vi.fn>;
  setActiveMaxContext: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const submit = vi.fn();
  const switchProviderAndModel = vi.fn().mockReturnValue(null);
  const setLiveProvider = vi.fn();
  const setLiveModel = vi.fn();
  const setActiveMaxContext = vi.fn();
  return {
    state,
    dispatch,
    lastEnterAtRef: { current: 0 },
    inputGateRef: { current: false },
    switchProviderAndModel,
    setLiveProvider,
    setLiveModel,
    setActiveMaxContext,
    getAgentCtxMaxContext: () => 200_000,
    activeMaxContext: 200_000,
    currentContextTokens: 0,
    switchAutonomy: vi.fn(),
    submit,
    onAuthEnter: vi.fn(),
    onAuthBack: vi.fn(),
    onAuthShortcut: vi.fn(),
    onAuthPromptSubmit: vi.fn(),
    onAuthPromptCancel: vi.fn(),
    onAuthConfirm: vi.fn(),
    onAuthFlowCancel: vi.fn(),
    onAuthCtrlC: vi.fn(),
    onPromptPickerEnter: vi.fn(),
    onResumePickerEnter: vi.fn(),
    onSessionsPanelEnter: vi.fn(),
    onProjectPickerEnter: vi.fn(),
    onSlashPickerEnter: vi.fn(),
    onSettingsPickerEnter: vi.fn(),
    onPluginPickerToggle: vi.fn(),
    onFKeyPickerEnter: vi.fn(),
    onPickerEnter: vi.fn(),
    onSlashPickerTab: vi.fn(),
    ...overrides,
  };
}

function runPickerKey(host: PickerKeysHost, input: string, event: KeyEvent, isEnter: boolean): void {
  function Probe(): React.ReactElement | null {
    const handler = usePickerKeys(host);
    useEffect(() => {
      handler(input, event, isEnter);
    }, [handler]);
    return null;
  }

  const { unmount } = render(React.createElement(Probe));
  unmount();
}

describe('usePickerKeys — model and mode flows', () => {
  it('picks a provider from the model picker on Enter', () => {
    const providers: ProviderOption[] = [
      { id: 'openai', family: 'openai', models: ['gpt-4.1', 'gpt-4o'] },
    ];
    const host = makeHost(
      baseState({
        modelPicker: {
          open: true,
          step: 'provider',
          providerOptions: providers,
          modelOptions: [],
          filteredOptions: [],
          selected: 0,
          searchQuery: '',
        },
      }),
    );

    runPickerKey(host, '', key(), true);

    expect(host.dispatch).toHaveBeenCalledWith({
      type: 'modelPickerPickProvider',
      providerId: 'openai',
      models: ['gpt-4.1', 'gpt-4o'],
    });
  });

  it('searches and selects a model, then closes the picker and emits the switch info entry', () => {
    const host = makeHost(
      baseState({
        modelPicker: {
          open: true,
          step: 'model',
          providerOptions: [],
          modelOptions: ['gpt-4.1', 'gpt-4o'],
          filteredOptions: ['gpt-4o'],
          selected: 0,
          searchQuery: 'o',
          pickedProviderId: 'openai',
        },
      }),
    );

    runPickerKey(host, '4', key(), false);
    expect(host.dispatch).toHaveBeenCalledWith({ type: 'modelPickerSearch', query: 'o4' });

    host.dispatch.mockClear();
    host.lastEnterAtRef.current = 0;

    runPickerKey(host, '', key(), true);
    expect(host.switchProviderAndModel).toHaveBeenCalledWith('openai', 'gpt-4o');
    expect(host.setLiveProvider).toHaveBeenCalledWith('openai');
    expect(host.setLiveModel).toHaveBeenCalledWith('gpt-4o');
    expect(host.setActiveMaxContext).toHaveBeenCalledWith(200_000);
    expect(host.dispatch).toHaveBeenCalledWith({
      type: 'addEntry',
      entry: { kind: 'info', text: 'Switched to openai / gpt-4o.' },
    });
    expect(host.dispatch).toHaveBeenCalledWith({ type: 'modelPickerClose' });
  });

  it('treats a CR/LF-normalized Enter as selection, not model-search text', () => {
    const host = makeHost(
      baseState({
        modelPicker: {
          open: true,
          step: 'model',
          providerOptions: [],
          modelOptions: ['gpt-4o'],
          filteredOptions: ['gpt-4o'],
          selected: 0,
          searchQuery: '',
          pickedProviderId: 'openai',
        },
      }),
    );

    runPickerKey(host, '\r', key(), true);

    expect(host.switchProviderAndModel).toHaveBeenCalledWith('openai', 'gpt-4o');
    expect(host.dispatch).not.toHaveBeenCalledWith({ type: 'modelPickerSearch', query: '\r' });
  });

  it('warns when manual model selection reduces the context window', () => {
    const host = makeHost(
      baseState({
        modelPicker: {
          open: true,
          step: 'model',
          providerOptions: [],
          modelOptions: ['small'],
          filteredOptions: ['small'],
          selected: 0,
          searchQuery: '',
          pickedProviderId: 'openai',
        },
      }),
      {
        getAgentCtxMaxContext: () => 32_000,
        activeMaxContext: 200_000,
        currentContextTokens: 24_000,
      },
    );

    runPickerKey(host, '', key(), true);

    expect(host.dispatch).toHaveBeenCalledWith({
      type: 'addEntry',
      entry: {
        kind: 'info',
        text: 'Switched to openai / small.\n⚠ smaller context window: 200,000 → 32,000 tokens; current request ≈ 24,000 tokens (75% of new window)',
      },
    });
  });

  it('closes the mode picker and submits /mode <id> on Enter', () => {
    const modes: ModeOption[] = [
      { id: 'default', name: 'Default', description: 'Balanced', isActive: false },
      { id: 'review', name: 'Review', description: 'Review-oriented', isActive: true },
    ];
    const host = makeHost(
      baseState({
        modePicker: {
          open: true,
          modes,
          selected: 1,
        },
      }),
    );

    runPickerKey(host, '', key(), true);

    expect(host.dispatch).toHaveBeenCalledWith({ type: 'modePickerClose' });
    expect(host.submit).toHaveBeenCalledWith('/mode review');
  });
});
