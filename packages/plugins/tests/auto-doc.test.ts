import { describe, expect, it, vi, beforeEach } from 'vitest';
import autoDocPlugin from '../src/auto-doc';

const mockApi = {
  tools: {
    register: vi.fn()
  },
  config: { extensions: {} },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { counter: vi.fn(), histogram: vi.fn(), gauge: vi.fn() },
};

describe('auto-doc plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tool registration succeeds', () => {
    autoDocPlugin.setup(mockApi as any);
    const tools = mockApi.tools.register.mock.calls.map(([t]: any[]) => t.name);
    expect(tools).toContain('auto_doc');
  });

  it('auto_doc tool has correct schema', () => {
    autoDocPlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([t]: any[]) => t.name === 'auto_doc'
    )?.[0];

    expect(tool).toBeDefined();
    expect(tool?.name).toBe('auto_doc');
    expect(tool?.permission).toBe('auto');
    expect(tool?.mutating).toBe(true);
    expect(tool?.inputSchema.type).toBe('object');
    expect(tool?.inputSchema.required).toContain('files');
    expect(tool?.inputSchema.properties?.files?.type).toBe('array');
    expect(tool?.inputSchema.properties?.style?.enum).toEqual(['jsdoc', 'tsdoc']);
  });
});