import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/registry/tool-registry.js';
import type { Tool } from '../../src/types/tool.js';

const t = (name: string): Tool => ({
  name,
  description: name,
  inputSchema: { type: 'object' },
  permission: 'auto',
  mutating: false,
  async execute() {
    return '';
  },
});

describe('ToolRegistry', () => {
  it('register / get / list', () => {
    const r = new ToolRegistry();
    r.register(t('a'));
    r.register(t('b'));
    expect(r.list().map((x) => x.name).sort()).toEqual(['a', 'b']);
    expect(r.get('a')?.name).toBe('a');
  });

  it('rejects duplicate register', () => {
    const r = new ToolRegistry();
    r.register(t('a'));
    expect(() => r.register(t('a'))).toThrow(/already/);
  });

  it('replace requires existing', () => {
    const r = new ToolRegistry();
    expect(() => r.replace('a', t('a'))).toThrow(/not registered/);
  });

  it('replace works and tracks owner', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    r.replace('a', t('a'), 'plug');
    expect(r.ownerOf('a')).toBe('plug');
  });

  it('unregister', () => {
    const r = new ToolRegistry();
    r.register(t('a'));
    expect(r.unregister('a')).toBe(true);
    expect(r.unregister('a')).toBe(false);
  });
});
