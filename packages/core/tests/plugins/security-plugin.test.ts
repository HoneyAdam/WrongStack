import { describe, expect, it, vi } from 'vitest';
import { createSecurityPlugin } from '../../src/plugins/security-plugin.js';

describe('createSecurityPlugin', () => {
  it('returns a plugin with correct metadata', () => {
    const plugin = createSecurityPlugin();
    expect(plugin.name).toBe('wstack-security');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.description).toBe('Security scanning back-end (orchestrator only).');
    expect(plugin.apiVersion).toBe('^0.1');
    expect(plugin.capabilities).toEqual({});
    expect(plugin.defaultConfig).toEqual({});
  });

  it('setup logs that the plugin loaded', () => {
    const plugin = createSecurityPlugin();
    const infoFn = vi.fn();
    const api = { log: { info: infoFn } } as never;
    plugin.setup!(api);
    expect(infoFn).toHaveBeenCalledWith(
      '[security] loaded — orchestrator available programmatically',
    );
  });

  it('teardown logs that the plugin unloaded', () => {
    const plugin = createSecurityPlugin();
    const infoFn = vi.fn();
    const api = { log: { info: infoFn } } as never;
    plugin.teardown!(api);
    expect(infoFn).toHaveBeenCalledWith('[security] unloaded');
  });

  it('health returns ok and ready message', async () => {
    const plugin = createSecurityPlugin();
    const result = await plugin.health!();
    expect(result.ok).toBe(true);
    expect(result.message).toBe('security scanner ready');
  });
});
