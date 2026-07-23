// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  selectAutoProceedCandidate,
  useNextStepsAutoSubmit,
} from '../src/hooks/use-next-steps-auto-submit.js';
import { createTestState } from './helpers/create-test-state.js';

describe('selectAutoProceedCandidate', () => {
  it('makes the live todo authoritative over stale suggestions', () => {
    const candidate = selectAutoProceedCandidate({
      todos: [{ id: 'fix', content: 'Finish the todo lifecycle fix', status: 'in_progress' }],
      suggestions: ['Repeat an obsolete next step'],
      autoSuggestions: ['Repeat an obsolete automatic step'],
      yolo: true,
      autonomyNextPrompt: 'AUTO: {{suggestion}}',
    });

    expect(candidate?.source).toBe('todo');
    expect(candidate?.prompt).toContain('Finish the todo lifecycle fix');
    expect(candidate?.prompt).not.toContain('obsolete');
  });

  it('uses a suggestion only after every todo is completed', () => {
    const candidate = selectAutoProceedCandidate({
      todos: [{ id: 'done', content: 'Finished work', status: 'completed' }],
      suggestions: ['Run the release check'],
    });

    expect(candidate).toMatchObject({
      source: 'suggestion',
      prompt: 'Run the release check',
    });
  });
});

describe('useNextStepsAutoSubmit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not persist a todo continuation as a reusable suggestion', async () => {
    const todos = [{ id: 'fix', content: 'Close the finished todo', status: 'in_progress' as const }];
    const suggestionStore = ['stale next step'];
    const setSuggestions = vi.fn((next: string[]) => {
      suggestionStore.splice(0, suggestionStore.length, ...next);
    });
    const runBlocks = vi.fn(async () => undefined);

    renderHook(() =>
      useNextStepsAutoSubmit({
        state: createTestState({ status: 'idle' }),
        autonomyLive: 'auto',
        agent: { ctx: { todos } } as never,
        getAutonomy: () => 'auto',
        getSettings: () => ({ delayMs: 0, autoProceedMaxIterations: 50 }) as never,
        getSuggestions: () => [...suggestionStore],
        getAutoSuggestions: () => [],
        getYolo: () => false,
        setSuggestions,
        autonomyNextPrompt: undefined,
        dispatch: vi.fn(),
        clearDraft: vi.fn(),
        runBlocksRef: { current: runBlocks },
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(setSuggestions).toHaveBeenCalledWith([]);
    expect(setSuggestions).not.toHaveBeenCalledWith([
      expect.stringContaining('Close the finished todo'),
    ]);
    const blocks = (runBlocks.mock.calls as unknown as Array<Array<Array<{ text?: string }>>>)[0]?.[0] as
      | Array<{ text?: string }>
      | undefined;
    expect(blocks?.[0]?.text).toContain('Close the finished todo');
    expect(blocks?.[0]?.text).not.toContain('stale next step');
  });
});
