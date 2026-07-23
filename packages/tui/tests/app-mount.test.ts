// PR 0 of the tui/src/app.tsx split refactor (Issue #23).
//
// Baseline integration test: mount the TUI's top-level <App /> component
// and assert it renders without throwing. Future hook extractions
// (PRs 1-6 of the issue plan) MUST keep this test green.

import type { Agent, RunResult } from '@wrongstack/core/agent';
import { describe, expect, it, vi } from 'vitest';
import {
  createAppJourney,
  createJourneyAgent,
  waitForJourney,
} from './helpers/app-journey-harness.js';

describe('<App /> baseline mount (PR 0 of Issue #23)', () => {
  it('mounts without throwing', () => {
    const { lastFrame, unmount } = createAppJourney().mount();

    expect(lastFrame()).toBeTruthy();
    unmount();
  });

  it('aborts an initial prompt run when the App unmounts', async () => {
    let runSignal: AbortSignal | undefined;
    const agent = createJourneyAgent() as Agent;
    agent.run = vi.fn(
      async (_blocks, options) =>
        await new Promise<RunResult>((resolve) => {
          runSignal = options?.signal;
          options?.signal?.addEventListener(
            'abort',
            () => resolve({ status: 'aborted', iterations: 0, abortReason: 'TUI unmounted' }),
            { once: true },
          );
        }),
    );
    const view = createAppJourney(agent).mount({ initialAsk: 'start on mount' });
    await waitForJourney(() => runSignal !== undefined);

    view.unmount();

    expect(runSignal?.aborted).toBe(true);
    expect(runSignal?.reason).toBe('TUI unmounted');
  });
});
