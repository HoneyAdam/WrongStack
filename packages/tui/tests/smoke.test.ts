import { describe, expect, it } from 'vitest';

describe('@wrongstack/tui module', () => {
  // Importing src/index.js pulls in the full TUI graph (ink + react + app); under
  // full-suite parallel load the transform/import alone can exceed 15s on Windows.
  it('exports runTui as a function', async () => {
    const mod = await import('../src/index.js');
    expect(typeof mod.runTui).toBe('function');
  }, 60_000);
});
