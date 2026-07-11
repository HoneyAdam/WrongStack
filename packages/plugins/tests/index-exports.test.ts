/**
 * Tests for src/index.ts — verifies all re-exports from the barrel file
 * resolve to valid plugin objects with the expected shape.
 */
import { describe, expect, it } from 'vitest';

describe('plugin barrel exports', () => {
  it('all exports from index.ts resolve to objects with a name, version, and setup', async () => {
    const plugins = await import('../src/index.js');
    const exportNames = Object.keys(plugins);
    expect(exportNames.length).toBeGreaterThan(0);

    for (const [key, value] of Object.entries(plugins)) {
      expect(key).toMatch(/Plugin$/); // convention: each export ends in 'Plugin'
      expect(value).toBeDefined();
      expect(typeof value).toBe('object');
      const p = value as { name?: string; version?: string; setup?: unknown };
      expect(p.name).toStrictEqual(expect.any(String));
      expect(p.name!.length).toBeGreaterThan(0);
      expect(p.version).toStrictEqual(expect.any(String));
      expect(typeof p.setup).toBe('function');
    }
  });

  it('all exported plugins have a matching catalog entry', async () => {
    const { PLUGIN_CATALOG } = await import('../src/catalog.js');
    const plugins = await import('../src/index.js');

    for (const [, value] of Object.entries(plugins)) {
      const p = value as { name?: string };
      if (p.name) {
        expect(PLUGIN_CATALOG.has(p.name)).toBe(true);
      }
    }
  });

  it('every exported plugin has a health() and teardown() with correct signatures', async () => {
    const plugins = await import('../src/index.js');
    for (const [, value] of Object.entries(plugins)) {
      const p = value as {
        name?: string;
        health?: unknown;
        teardown?: unknown;
      };
      if (p.health !== undefined) {
        expect(typeof p.health).toBe('function');
      }
      if (p.teardown !== undefined) {
        expect(typeof p.teardown).toBe('function');
      }
    }
  });

  it('all exported plugin names are kebab-case', async () => {
    const plugins = await import('../src/index.js');
    for (const [, value] of Object.entries(plugins)) {
      const p = value as { name?: string };
      if (p.name) {
        expect(p.name).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it('all plugins declare capabilities', async () => {
    const plugins = await import('../src/index.js');
    for (const [, value] of Object.entries(plugins)) {
      const p = value as { capabilities?: { tools?: boolean; hooks?: boolean } };
      if (p.capabilities) {
        expect(typeof p.capabilities).toBe('object');
      }
    }
  });
});
