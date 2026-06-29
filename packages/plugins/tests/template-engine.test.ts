import { describe, it, expect, vi, beforeEach } from 'vitest';
import templateEnginePlugin from '../src/template-engine';

const mockApi = {
  tools: {
    register: vi.fn()
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  config: { extensions: {} },
  metrics: { counter: vi.fn(), histogram: vi.fn(), gauge: vi.fn() },
  registerSystemPromptContributor: vi.fn(() => () => {}),
};

describe('template-engine plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export a Plugin object', () => {
    expect(templateEnginePlugin).toBeDefined();
    expect(templateEnginePlugin.name).toBe('template-engine');
    expect(templateEnginePlugin.apiVersion).toBe('^0.1.10');
  });

  it('should register four tools in setup', () => {
    templateEnginePlugin.setup(mockApi as any);
    expect(mockApi.tools.register).toHaveBeenCalledTimes(4);
  });

  it('should have template_expand tool registered', () => {
    templateEnginePlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('template_expand');
  });

  it('should have template_render tool registered', () => {
    templateEnginePlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('template_render');
  });

  it('should have template_create tool registered', () => {
    templateEnginePlugin.setup(mockApi as any);
    const registeredTools = mockApi.tools.register.mock.calls.map(([tool]: any[]) => tool.name);
    expect(registeredTools).toContain('template_create');
  });

  it('template_expand should have correct properties', () => {
    templateEnginePlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'template_expand'
    )?.[0];

    expect(tool.description).toBe('Expand a template string with variable substitution. Supports {{variable}}, {{#if var}}...{{/if}} conditionals, and {{#each items}}...{{/each}} loops.');
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(true);
  });

  it('template_render should have correct properties', () => {
    templateEnginePlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'template_render'
    )?.[0];

    expect(tool.description).toBe('Read a template file from disk and expand it with the given variables.');
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(true);
  });

  it('template_create should have correct properties', () => {
    templateEnginePlugin.setup(mockApi as any);
    const tool = mockApi.tools.register.mock.calls.find(
      ([tool]: any[]) => tool.name === 'template_create'
    )?.[0];

    expect(tool.description).toBe("Save a named template to the plugin's template store for later use.");
    expect(tool.permission).toBe('auto');
    expect(tool.mutating).toBe(false);
  });

  describe('template_expand output_path validation', () => {
    it('rejects absolute output_path', async () => {
      templateEnginePlugin.setup(mockApi as any);
      const tool = mockApi.tools.register.mock.calls.find(
        ([t]: any[]) => t.name === 'template_expand'
      )?.[0];
      const result = await tool.execute({
        template: 'hello {{name}}',
        variables: { name: 'world' },
        output_path: '/etc/passwd',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('relative path');
    });

    it('rejects output_path with .. traversal', async () => {
      templateEnginePlugin.setup(mockApi as any);
      const tool = mockApi.tools.register.mock.calls.find(
        ([t]: any[]) => t.name === 'template_expand'
      )?.[0];
      const result = await tool.execute({
        template: 'hello {{name}}',
        variables: { name: 'world' },
        output_path: '../../../etc/passwd',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('relative path');
    });

    it('accepts relative output_path (no path validation error)', async () => {
      templateEnginePlugin.setup(mockApi as any);
      const tool = mockApi.tools.register.mock.calls.find(
        ([t]: any[]) => t.name === 'template_expand'
      )?.[0];
      // Use a temp file in cwd. The important thing is that the path
      // validation does NOT reject it (no "relative path" error).
      const tmpFile = `.test-output-${Date.now()}.txt`;
      try {
        const result = await tool.execute({
          template: 'hello {{name}}',
          variables: { name: 'world' },
          output_path: tmpFile,
        });
        expect(result.ok).toBe(true);
        expect(result.message).toContain('Wrote');
      } finally {
        const fs = await import('node:fs/promises');
        await fs.unlink(tmpFile).catch(() => {});
      }
    });
  });
});