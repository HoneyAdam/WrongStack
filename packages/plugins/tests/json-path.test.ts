import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsonPathPlugin from '../src/json-path';

const mockApi = {
  tools: {
    register: vi.fn()
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  config: { extensions: {} },
};

describe('json-path plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export a Plugin object', () => {
    expect(jsonPathPlugin).toBeDefined();
    expect(jsonPathPlugin.name).toBe('json-path');
    expect(jsonPathPlugin.apiVersion).toBe('^0.1.10');
  });

  it('should register four tools in setup', () => {
    jsonPathPlugin.setup(mockApi as any);
    expect(mockApi.tools.register).toHaveBeenCalledTimes(4);
  });

  it('should have jmespath_query tool registered', () => {
    jsonPathPlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('jmespath_query');
  });

  it('should have json_validate tool registered', () => {
    jsonPathPlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('json_validate');
  });

  it('should have json_merge tool registered', () => {
    jsonPathPlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('json_merge');
  });

  it('jmespath_query should have correct properties', async () => {
    jsonPathPlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'jmespath_query'
    )?.[0];

    expect(tool.description).toBe('Execute a JMESPath query on JSON or YAML data. Supports dot notation, array indexing, wildcards, filters, and functions.');
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(false);
  });

  it('json_validate should have correct properties', async () => {
    jsonPathPlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'json_validate'
    )?.[0];

    expect(tool.description).toBe('Validate JSON/YAML data against a JSON Schema. Reports all validation errors found.');
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(false);
  });

  it('json_merge should have correct properties', async () => {
    jsonPathPlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'json_merge'
    )?.[0];

    expect(tool.description).toBe('Deep merge two JSON objects. Use conflictResolution to decide which value wins on collision.');
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(false);
  });
});