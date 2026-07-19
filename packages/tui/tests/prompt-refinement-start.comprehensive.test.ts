import { describe, expect, it, vi } from 'vitest';
import { startPromptRefinement } from '../src/prompt-refinement-start.js';

describe('startPromptRefinement', () => {
  it('opens the visible busy state before slow context preparation resolves', async () => {
    let releaseContext: ((value: string[]) => void) | undefined;
    const context = new Promise<string[]>((resolve) => {
      releaseContext = resolve;
    });
    const events: string[] = [];
    const originalSlot = { current: '' };
    const abortSlot = { current: null as AbortController | null };
    const controller = new AbortController();

    const pending = startPromptRefinement({
      original: 'Refactor auth middleware safely',
      controller,
      originalSlot,
      abortSlot,
      setStartedAt: (value) => events.push(`started:${value}`),
      setBusy: (on) => events.push(`busy:${on}`),
      clearDraft: () => events.push('draft:clear'),
      prepareContext: () => context,
      fallbackContext: [],
      now: () => 1234,
    });

    expect(events).toEqual(['started:1234', 'busy:true', 'draft:clear']);
    expect(originalSlot.current).toBe('Refactor auth middleware safely');
    expect(abortSlot.current).toBe(controller);

    releaseContext?.(['memory ready']);
    await expect(pending).resolves.toEqual(['memory ready']);
  });

  it('falls back when optional context preparation fails', async () => {
    const fallback = [{ title: 'session' }];

    await expect(
      startPromptRefinement({
        original: 'Fix input routing carefully',
        controller: new AbortController(),
        originalSlot: { current: '' },
        abortSlot: { current: null },
        setStartedAt: vi.fn(),
        setBusy: vi.fn(),
        clearDraft: vi.fn(),
        prepareContext: async () => {
          throw new Error('memory unavailable');
        },
        fallbackContext: fallback,
      }),
    ).resolves.toBe(fallback);
  });

  it('stops waiting for a stuck context provider when refinement is cancelled', async () => {
    const controller = new AbortController();
    const never = new Promise<string[]>(() => {});
    const fallback: string[] = [];
    const pending = startPromptRefinement({
      original: 'Fix input routing carefully',
      controller,
      originalSlot: { current: '' },
      abortSlot: { current: null },
      setStartedAt: vi.fn(),
      setBusy: vi.fn(),
      clearDraft: vi.fn(),
      prepareContext: () => never,
      fallbackContext: fallback,
    });

    controller.abort();

    await expect(pending).resolves.toBe(fallback);
  });

  it('returns fallback when already aborted before prepareContext', async () => {
    const controller = new AbortController();
    controller.abort(); // Already aborted before start
    const fallback: string[] = [];
    const contextSpy = vi.fn();

    await expect(
      startPromptRefinement({
        original: 'Already cancelled',
        controller,
        originalSlot: { current: '' },
        abortSlot: { current: null },
        setStartedAt: vi.fn(),
        setBusy: vi.fn(),
        clearDraft: vi.fn(),
        prepareContext: () => {
          contextSpy();
          return Promise.resolve(['should not reach']);
        },
        fallbackContext: fallback,
      }),
    ).resolves.toBe(fallback);

    // Context should NOT have been called since we aborted early
    expect(contextSpy).not.toHaveBeenCalled();
  });

  it('uses Date.now when now function is not provided', async () => {
    const controller = new AbortController();
    const originalSlot = { current: '' };
    const abortSlot = { current: null };

    const pending = startPromptRefinement({
      original: 'Test using Date.now',
      controller,
      originalSlot,
      abortSlot,
      setStartedAt: vi.fn(),
      setBusy: vi.fn(),
      clearDraft: vi.fn(),
      prepareContext: () => Promise.resolve(['data']),
      fallbackContext: [],
      // No now function provided
    });

    await expect(pending).resolves.toEqual(['data']);
  });
});
