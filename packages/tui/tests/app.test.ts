import { describe, expect, it } from 'vitest';
import { createAppJourney, waitForJourney } from './helpers/app-journey-harness.js';

describe('App integration baseline', () => {
  it('survives passive hook setup, accepts stdin, and unmounts cleanly', async () => {
    const journey = createAppJourney();
    const view = journey.mount();

    await waitForJourney(() => view.frames.length >= 2);
    expect(view.frames.join('\n')).not.toContain('ERROR');
    expect(() => view.stdin.write('a')).not.toThrow();
    await waitForJourney(() => (view.lastFrame() ?? '').includes('a'));
    expect(() => {
      view.unmount();
      view.cleanup();
    }).not.toThrow();
  });
});
