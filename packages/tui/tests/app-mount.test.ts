// PR 0 of the tui/src/app.tsx split refactor (Issue #23).
//
// Baseline integration test: mount the TUI's top-level <App /> component
// and assert it renders without throwing. Future hook extractions
// (PRs 1-6 of the issue plan) MUST keep this test green.

import { describe, expect, it } from 'vitest';
import { createAppJourney } from './helpers/app-journey-harness.js';

describe('<App /> baseline mount (PR 0 of Issue #23)', () => {
  it('mounts without throwing', () => {
    const { lastFrame, unmount } = createAppJourney().mount();

    expect(lastFrame()).toBeTruthy();
    unmount();
  });
});
