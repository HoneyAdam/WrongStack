/**
 * Tests for version.ts — CLI version and API version exports.
 */
import { describe, expect, it } from 'vitest';

describe('CLI version', () => {
  it('exports CLI_VERSION as a non-empty string', async () => {
    const mod = await import('../src/version.js');
    expect(typeof mod.CLI_VERSION).toBe('string');
    expect(mod.CLI_VERSION.length).toBeGreaterThan(0);
  });

  it('exports API_VERSION as a non-empty string', async () => {
    const mod = await import('../src/version.js');
    expect(typeof mod.API_VERSION).toBe('string');
    expect(mod.API_VERSION.length).toBeGreaterThan(0);
  });
});
