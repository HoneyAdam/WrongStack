/**
 * Tests for src/reducers/helpers.ts — pure utility functions.
 * Covers clampContextLoad, closePanels, pruneToolInput, firstSelectable,
 * and skipDivider to 100% line and branch.
 */

import { describe, expect, it } from 'vitest';
import type { State } from '../src/app-state.js';
import {
  clampContextLoad,
  closePanels,
  firstSelectable,
  pruneToolInput,
  skipDivider,
} from '../src/reducers/helpers.js';

function stubState(over: Partial<State> = {}): State {
  return {
    entries: [],
    buffer: '',
    cursor: 0,
    streamingText: '',
    toolStream: null,
    status: 'idle',
    interrupts: 0,
    steeringPending: false,
    steerSnapshot: null,
    hint: '',
    brain: { state: 'idle' },
    brainPrompt: null,
    nextId: 1,
    historyGen: 0,
    picker: { open: false, query: '', matches: [], selected: 0 },
    slashPicker: { open: false, query: '', matches: [], selected: 0 },
    runningTools: new Map(),
    queue: [],
    nextQueueId: 1,
    inputHistory: [],
    historyIndex: 0,
    historyDraft: '',
    modelPicker: { open: false, step: 'provider' as const, providerOptions: [], modelOptions: [], filteredOptions: [], selected: 0, searchQuery: '' },
    autonomyPicker: { open: false, options: [], selected: 0 },
    modePicker: { open: false, modes: [], selected: 0 },
    designPicker: { open: false, kits: [], selected: 0, stack: 'web' as const },
    promptPicker: { open: false, all: [], categories: [], recentSlugs: [], catIndex: 0, selected: 0 },
    resumePicker: { open: false, sessions: [], selected: 0, busy: false, hint: undefined, error: undefined },
    settingsPicker: { open: false, field: 0, lastSettingsField: 0, filter: '', mode: 'off' as const, delayMs: 0, titleAnimation: true, yolo: false, fleetChat: 'off' as const, chime: false, confirmExit: true, nextPrediction: false, featureMcp: true, featurePlugins: true, featureMemory: true, featureSkills: true, featureModelsRegistry: true, tokenSavingTier: 'off' as const, allowOutsideProjectRoot: true, contextAutoCompact: true, contextStrategy: 'hybrid' as const, contextMode: 'balanced' as const, maxConcurrent: 10, logLevel: 'info' as const, auditLevel: 'standard' as const, indexOnStart: true, multiDiffSummaryThreshold: 5, maxIterations: 500, autoProceedMaxIterations: 50, enhanceDelayMs: 60000, enhanceEnabled: true, enhanceLanguage: 'original' as const, debugStream: false, statuslineMode: 'detailed' as const, reasoningMode: 'auto' as const, reasoningEffort: 'high' as const, reasoningPreserve: false, thinkingWord: 'thinking', thinkingWordEditing: false, thinkingWordDraft: '', cacheTtl: 'default' as const, configScope: 'global' as const, animationStyle: 'rainbow' as const },
    statuslinePicker: { open: false, field: 0, hiddenItems: [], visibleChips: [], hint: undefined },
    pluginPicker: { open: false, items: [], selected: 0, busy: false, hint: undefined },
    mcpPicker: { open: false, items: [], selected: 0, busy: false, hint: undefined },
    toolsPicker: { open: false, items: [], selected: 0, busy: false, hint: undefined, filter: undefined },
    brainPanel: { open: true, riskLevel: 'high' as const, log: [], selected: 0, hint: undefined },
    helpPanel: { open: true, entries: [], selected: 0, filter: '', hint: undefined },
    shadowPanel: { open: true, shadow: { activeId: null, running: false, model: '', intervalMs: 30000 }, hint: undefined },
    authPanel: { open: true, view: 'list' as const, busy: true, providers: [], presets: [], catalog: [], selected: 0, filter: '', flowTitle: '', log: [], flowDone: false },
    projectPicker: { open: true, allItems: [], items: [], selected: 0, filter: '', hint: undefined },
    fKeyPicker: { open: false, selected: 0 },
    confirmQueue: [],
    shellCommandWarning: null,
    enhance: null,
    enhanceEnabled: true,
    enhanceBusy: false,
    continueConfirm: null,
    escConfirm: null,
    sendModePicker: null,
    contextChipVersion: 0,
    fleet: {},
    leader: { iterations: 0, toolCalls: 0, recentTools: [], currentTool: undefined, startedAt: Date.now(), lastEventAt: Date.now(), iterating: false },
    fleetCost: 0,
    fleetTokens: { input: 0, output: 0 },
    fleetConcurrency: 4,
    fleetChat: 'off' as const,
    monitorOpen: true,
    agentsMonitorOpen: true,
    helpOpen: true,
    todosMonitorOpen: true,
    queuePanelOpen: true,
    processListOpen: true,
    auditPanelOpen: true,
    planPanelOpen: true,
    kanbanPanelOpen: true,
    goalPanelOpen: true,
    sessionsPanelOpen: true,
    sessionResumeConfirm: null,
    collabSession: null,
    checkpoints: [],
    rewindOverlay: null,
    eternalStage: null,
    goalSummary: null,
    goalRun: { monitorOpen: true } as never,
    sddBoard: { monitorOpen: true } as never,
    worktrees: {},
    worktreeMonitorOpen: true,
    coordinator: { goals: [], timeline: [], knowledgeCount: 0, monitorOpen: true, healthy: false },
    scrollOffset: 0,
    totalLines: 0,
    viewportRows: 0,
    pendingNewLines: 0,
    debugStreamStats: null,
    countdown: null,
    cronMonitorOpen: true,
    contextPanelOpen: true,
    goalKanbanPanelOpen: true,
    ...over,
  };
}

describe('clampContextLoad', () => {
  it('clamps values above 1 to 1', () => {
    expect(clampContextLoad(1.5)).toBe(1);
    // Infinity is not finite so clampContextLoad returns 0 (default for NaN/Infinity).
    expect(clampContextLoad(Infinity)).toBe(0);
  });

  it('clamps values below 0 to 0', () => {
    expect(clampContextLoad(-0.5)).toBe(0);
    expect(clampContextLoad(-Infinity)).toBe(0);
  });

  it('returns 0 for non-finite values', () => {
    expect(clampContextLoad(NaN)).toBe(0);
  });

  it('returns the value unchanged when within [0, 1]', () => {
    expect(clampContextLoad(0)).toBe(0);
    expect(clampContextLoad(0.5)).toBe(0.5);
    expect(clampContextLoad(1)).toBe(1);
  });
});

describe('closePanels', () => {
  it('closes every tracked panel and picker', () => {
    const state = stubState();
    const result = closePanels(state);

    expect(result.monitorOpen).toBe(false);
    expect(result.agentsMonitorOpen).toBe(false);
    expect(result.helpOpen).toBe(false);
    expect(result.todosMonitorOpen).toBe(false);
    expect(result.queuePanelOpen).toBe(false);
    expect(result.processListOpen).toBe(false);
    expect(result.auditPanelOpen).toBe(false);
    expect(result.planPanelOpen).toBe(false);
    expect(result.kanbanPanelOpen).toBe(false);
    expect(result.goalPanelOpen).toBe(false);
    expect(result.goalKanbanPanelOpen).toBe(false);
    expect(result.contextPanelOpen).toBe(false);
    expect(result.sessionsPanelOpen).toBe(false);
    expect(result.worktreeMonitorOpen).toBe(false);
    expect(result.cronMonitorOpen).toBe(false);
  });

  it('closes pickers with open:false', () => {
    const state = stubState();
    const result = closePanels(state);

    expect(result.settingsPicker.open).toBe(false);
    expect(result.statuslinePicker.open).toBe(false);
    expect(result.pluginPicker.open).toBe(false);
    expect(result.mcpPicker.open).toBe(false);
    expect(result.toolsPicker.open).toBe(false);
    expect(result.brainPanel.open).toBe(false);
    expect(result.helpPanel.open).toBe(false);
    expect(result.shadowPanel.open).toBe(false);
    expect(result.authPanel.open).toBe(false);
    expect(result.projectPicker.open).toBe(false);
    expect(result.fKeyPicker.open).toBe(false);
  });

  it('sets authPanel.busy to false when closing', () => {
    const state = stubState({ authPanel: { open: true, view: 'list', busy: true, providers: [], presets: [], catalog: [], selected: 0, filter: '', flowTitle: '', log: [], flowDone: false } });
    const result = closePanels(state);
    expect(result.authPanel.open).toBe(false);
    expect(result.authPanel.busy).toBe(false);
  });

  it('preserves goalRun and sddBoard when null', () => {
    const state = stubState({ goalRun: null, sddBoard: null });
    const result = closePanels(state);
    expect(result.goalRun).toBeNull();
    expect(result.sddBoard).toBeNull();
  });

  it('closes monitorOpen on goalRun and sddBoard when non-null', () => {
    const state = stubState({
      goalRun: { monitorOpen: true } as never,
      sddBoard: { monitorOpen: true } as never,
    });
    const result = closePanels(state);
    expect((result.goalRun as { monitorOpen: boolean } | null)?.monitorOpen).toBe(false);
    expect((result.sddBoard as { monitorOpen: boolean } | null)?.monitorOpen).toBe(false);
  });

  it('closes coordinator.monitorOpen', () => {
    const state = stubState();
    const result = closePanels(state);
    expect(result.coordinator.monitorOpen).toBe(false);
  });
});

describe('pruneToolInput', () => {
  it('truncates long strings', () => {
    const long = 'a'.repeat(10_000);
    const result = pruneToolInput(long) as string;
    expect(result.length).toBeLessThanOrEqual(2048 + 100); // truncated message appended
    expect(result).toContain('truncated');
    expect(result).toContain('10000');
  });

  it('returns short strings unchanged', () => {
    expect(pruneToolInput('hello')).toBe('hello');
    expect(pruneToolInput('')).toBe('');
  });

  it('returns null and primitives unchanged', () => {
    expect(pruneToolInput(null)).toBeNull();
    expect(pruneToolInput(42)).toBe(42);
    expect(pruneToolInput(true)).toBe(true);
    expect(pruneToolInput(undefined)).toBeUndefined();
  });

  it('truncates arrays with too many items', () => {
    const arr = Array.from({ length: 100 }, (_, i) => `item-${i}`);
    const result = pruneToolInput(arr) as unknown[];
    expect(result).toHaveLength(65); // 64 items + 1 pruned marker
    expect(result[result.length - 1]).toContain('36 more items');
  });

  it('truncates objects with too many keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 100; i++) obj[`k${i}`] = i;
    const result = pruneToolInput(obj) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys.length).toBeLessThanOrEqual(65); // 64 keys + 1 pruned marker
    expect(result['…']).toContain('pruned');
  });

  it('limits recursion depth', () => {
    // MAX_RETAINED_INPUT_DEPTH = 4. Starting at depth=0 for the root, depth=4
    // triggers the depth guard. { a: { b: { c: { d: { e: 'deep' } } } } }
    // has depth 4 at the 'd' level, so 'd' is replaced with the pruned sentinel.
    const deep: Record<string, unknown> = { a: { b: { c: { d: { e: 'deep' } } } } };
    const result = pruneToolInput(deep) as Record<string, unknown>;
    const c = (result.a as Record<string, unknown>).b as Record<string, unknown>;
    expect((c.c as Record<string, unknown>).d).toEqual('[pruned: too deep]');
  });

  it('recursively prunes nested arrays', () => {
    const input = [Array.from({ length: 100 }, (_, i) => `x${i}`), 'keep'];
    const result = pruneToolInput(input) as unknown[];
    expect((result[0] as unknown[]).length).toBe(65);
    expect(result[1]).toBe('keep');
  });
});

describe('firstSelectable', () => {
  it('returns index of first non-divider item', () => {
    const items = [
      { key: '__divider__' as const, label: '--' },
      { key: 'proj-a' as const, label: 'Project A', path: '/a' },
    ];
    expect(firstSelectable(items)).toBe(1);
  });

  it('returns 0 when list is empty', () => {
    expect(firstSelectable([])).toBe(0);
  });

  it('returns 0 when all items are dividers', () => {
    const items = [
      { key: '__divider__' as const, label: '--' },
    ];
    expect(firstSelectable(items)).toBe(0);
  });

  it('returns 0 when first item is selectable', () => {
    const items = [
      { key: 'proj-a' as const, label: 'A', path: '/a' },
    ];
    expect(firstSelectable(items)).toBe(0);
  });
});

describe('skipDivider', () => {
  const items = [
    { key: '__divider__' as const, label: '--' },
    { key: 'proj-a' as const, label: 'A', path: '/a' },
    { key: '__divider__' as const, label: '--' },
    { key: 'proj-b' as const, label: 'B', path: '/b' },
  ];

  it('skips forward over dividers', () => {
    expect(skipDivider(items, 0, 1)).toBe(1); // skips divider[0] to proj-a
    expect(skipDivider(items, 2, 1)).toBe(3); // skips divider[2] to proj-b
  });

  it('skips backward over dividers', () => {
    expect(skipDivider(items, 2, -1)).toBe(1); // from divider[2] backward to proj-a
  });

  it('wraps around forward (past end)', () => {
    // items = [divider(0), A(1), divider(2), B(3)]. From index 3 (B) forward,
    // B is already selectable so it stays at 3. Start from a divider to force
    // wrap-around: from index 2 (divider) forward -> 3 (B).
    expect(skipDivider(items, 2, 1)).toBe(3);
    // From index 3 (B) forward -> B is selectable -> stays at 3
    expect(skipDivider(items, 3, 1)).toBe(3);
  });

  it('wraps around backward (past start)', () => {
    // items = [divider(0), A(1), divider(2), B(3)]. From index 1 (A) backward,
    // A is already selectable so it stays at 1. Start from a divider to force
    // wrap: from index 0 (divider) backward -> wraps to 3 (B).
    expect(skipDivider(items, 0, -1)).toBe(3);
    expect(skipDivider(items, 1, -1)).toBe(1);
  });

  it('stays at index when all items are dividers', () => {
    const allDividers = [
      { key: '__divider__' as const, label: '--' },
      { key: '__divider__' as const, label: '--' },
    ];
    expect(skipDivider(allDividers, 1, 1)).toBe(1);
    expect(skipDivider(allDividers, 1, -1)).toBe(1);
  });

  it('returns the same index when already on a selectable', () => {
    expect(skipDivider(items, 1, 1)).toBe(1);
    expect(skipDivider(items, 1, -1)).toBe(1);
  });
});
