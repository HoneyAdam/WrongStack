import { ToolRegistry } from '@wrongstack/core/registry';
import type { MemoryStore, Tool } from '@wrongstack/core/types';
import { LegacyMemoryPortAdapter } from '@wrongstack/super-memory';
import { describe, expect, it } from 'vitest';
import { registerCanonicalHostTools } from '../src/tool-registration.js';

const coordinationTool: Tool = {
  name: 'coordination-test',
  description: 'Test coordination tool.',
  inputSchema: { type: 'object', properties: {} },
  permission: 'auto',
  mutating: false,
  async execute() {
    return 'ok';
  },
};

function legacyMemoryStore(): MemoryStore {
  const store: MemoryStore = {
    async readAll() {
      return '';
    },
    async read() {
      return '';
    },
    async remember() {},
    async forget() {
      return 0;
    },
    async consolidate() {},
    async clear() {},
    async list() {
      return [];
    },
    async search() {
      return [];
    },
    withTraceId() {
      return store;
    },
  };
  return store;
}

describe('canonical host tool registration', () => {
  it('applies tier selection, legacy memory, coordination, and disabled policy', () => {
    const registry = new ToolRegistry();

    const result = registerCanonicalHostTools({
      registry,
      tier: 'minimal',
      memory: { enabled: true, store: new LegacyMemoryPortAdapter(legacyMemoryStore()) },
      coordinationTools: [coordinationTool],
      disabledTools: ['grep'],
    });

    expect(result.memoryBackend).toBe('legacy');
    expect(result.builtinTools.map((tool) => tool.name)).toContain('read');
    expect(result.builtinTools.map((tool) => tool.name)).not.toContain('exec');
    expect(registry.get('remember')).toBeDefined();
    expect(registry.get('coordination-test')).toBe(coordinationTool);
    expect(registry.get('grep')).toBeUndefined();
  });

  it('does not register memory tools when memory is disabled', () => {
    const registry = new ToolRegistry();

    const result = registerCanonicalHostTools({
      registry,
      tier: 'minimal',
      memory: { enabled: false, store: new LegacyMemoryPortAdapter(legacyMemoryStore()) },
    });

    expect(result.memoryBackend).toBe('disabled');
    expect(registry.get('remember')).toBeUndefined();
  });
});
