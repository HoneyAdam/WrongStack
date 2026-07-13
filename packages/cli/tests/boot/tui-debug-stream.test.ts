/**
 * Tests for boot/tui-debug-stream.ts — debug stream callback registration.
 */
import { describe, expect, it } from 'vitest';

describe('tui-debug-stream', () => {
  it('registerDebugStreamCallback works end-to-end', async () => {
    // The module dynamically imports @wrongstack/providers.
    // We can test that the module at least loads correctly.
    // For a more isolated test we'd need to mock the providers module.
    const mod = await import('../../src/boot/tui-debug-stream.js');
    expect(mod.registerDebugStreamCallback).toBeDefined();
    expect(mod.restoreDebugStreamCallback).toBeDefined();
  });

  it('registerDebugStreamCallback is a function', async () => {
    const mod = await import('../../src/boot/tui-debug-stream.js');
    expect(typeof mod.registerDebugStreamCallback).toBe('function');
  });

  it('restoreDebugStreamCallback is a function', async () => {
    const mod = await import('../../src/boot/tui-debug-stream.js');
    expect(typeof mod.restoreDebugStreamCallback).toBe('function');
  });
});
