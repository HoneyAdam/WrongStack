import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/registry/tool-registry.js';
import type { Tool } from '../../src/types/tool.js';

const t = (name: string, category?: string): Tool => ({
  name,
  description: name,
  inputSchema: { type: 'object' },
  permission: 'auto',
  mutating: false,
  async execute() {
    return '';
  },
  ...(category ? { category } : {}),
});

describe('ToolRegistry', () => {
  it('register / get / list', () => {
    const r = new ToolRegistry();
    r.register(t('a'));
    r.register(t('b'));
    expect(
      r
        .list()
        .map((x) => x.name)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(r.get('a')?.name).toBe('a');
  });

  it('rejects duplicate register', () => {
    const r = new ToolRegistry();
    r.register(t('a'));
    expect(() => r.register(t('a'))).toThrow(/already/);
  });

  it('override requires existing', () => {
    const r = new ToolRegistry();
    expect(() => r.override('a', t('a'))).toThrow(/not registered/);
  });

  it('override works and tracks owner', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    r.override('a', t('a'), 'plug');
    expect(r.ownerOf('a')).toBe('plug');
  });

  it('registerDefault skips if already registered', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    r.registerDefault(t('a'), 'plug');
    expect(r.ownerOf('a')).toBe('core');
  });

  it('registerDefault registers when empty', () => {
    const r = new ToolRegistry();
    r.registerDefault(t('a'), 'core');
    expect(r.list().map((x) => x.name)).toEqual(['a']);
  });

  it('unregister', () => {
    const r = new ToolRegistry();
    r.register(t('a'));
    expect(r.unregister('a')).toBe(true);
    expect(r.unregister('a')).toBe(false);
  });

  // ─── Additional coverage tests ─────────────────────────────────────

  it('tryRegister returns false when tool already exists', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    const result = r.tryRegister(t('a'), 'plug');
    expect(result).toBe(false);
    expect(r.ownerOf('a')).toBe('core');
  });

  it('tryRegister returns true when slot is free', () => {
    const r = new ToolRegistry();
    const result = r.tryRegister(t('a'), 'core');
    expect(result).toBe(true);
    expect(r.ownerOf('a')).toBe('core');
  });

  it('registerAll silently skips duplicates', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    r.registerAll([t('a'), t('b'), t('a')], 'plug');
    expect(r.list().map((x) => x.name).sort()).toEqual(['a', 'b']);
  });

  it('registerAllOrThrow throws on first conflict', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    expect(() => r.registerAllOrThrow([t('a'), t('b')], 'plug')).toThrow(/already/);
  });

  it('registerAllOrThrow registers all when no conflicts', () => {
    const r = new ToolRegistry();
    r.registerAllOrThrow([t('a'), t('b')], 'core');
    expect(r.list().map((x) => x.name).sort()).toEqual(['a', 'b']);
  });

  it('wrap throws when tool not registered', () => {
    const r = new ToolRegistry();
    expect(() => r.wrap('nonexistent', (tool) => tool)).toThrow(/not registered/);
  });

  it('wrap modifies tool and tracks combined owner', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    r.wrap('a', (tool) => ({ ...tool, description: 'wrapped' }), 'plug');
    expect(r.get('a')?.description).toBe('wrapped');
    expect(r.ownerOf('a')).toBe('core+plug');
  });

  it('wrap stacks multiple wrappers', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    r.wrap('a', (tool) => ({ ...tool, description: 'first' }), 'p1');
    r.wrap('a', (tool) => ({ ...tool, description: tool.description + ' second' }), 'p2');
    expect(r.get('a')?.description).toBe('first second');
    expect(r.ownerOf('a')).toBe('core+p1+p2');
  });

  it('listByCategory groups tools by category', () => {
    const r = new ToolRegistry();
    r.register(t('read', 'Filesystem'));
    r.register(t('write', 'Filesystem'));
    r.register(t('grep', 'Search'));
    r.register(t('custom'));

    const byCat = r.listByCategory();
    expect(byCat.get('Filesystem')?.map((x) => x.name)).toEqual(['read', 'write']);
    expect(byCat.get('Search')?.map((x) => x.name)).toEqual(['grep']);
    expect(byCat.get('')?.map((x) => x.name)).toEqual(['custom']);
  });

  it('listByCategory maintains registration order', () => {
    const r = new ToolRegistry();
    r.register(t('c', 'Filesystem'));
    r.register(t('a', 'Filesystem'));
    r.register(t('b', 'Filesystem'));

    const byCat = r.listByCategory();
    const names = byCat.get('Filesystem')!.map((x) => x.name);
    expect(names).toEqual(['c', 'a', 'b']);
  });

  it('listWithOwner returns tool+owner pairs', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'core');
    r.register(t('b'), 'plug');

    const list = r.listWithOwner();
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.tool.name === 'a')?.owner).toBe('core');
    expect(list.find((x) => x.tool.name === 'b')?.owner).toBe('plug');
  });

  it('clear removes all tools', () => {
    const r = new ToolRegistry();
    r.register(t('a'));
    r.register(t('b'));
    r.clear();
    expect(r.list()).toEqual([]);
    expect(r.get('a')).toBeUndefined();
    expect(r.get('b')).toBeUndefined();
  });

  it('get returns undefined for unregistered tool', () => {
    const r = new ToolRegistry();
    expect(r.get('nonexistent')).toBeUndefined();
  });

  it('ownerOf returns undefined for unregistered tool', () => {
    const r = new ToolRegistry();
    expect(r.ownerOf('nonexistent')).toBeUndefined();
  });

  it('register tracks owner', () => {
    const r = new ToolRegistry();
    r.register(t('a'), 'my-owner');
    expect(r.ownerOf('a')).toBe('my-owner');
  });

  it('registerDefault tracks owner', () => {
    const r = new ToolRegistry();
    r.registerDefault(t('a'), 'default-owner');
    expect(r.ownerOf('a')).toBe('default-owner');
  });
});
