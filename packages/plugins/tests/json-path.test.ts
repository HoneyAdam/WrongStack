import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsonPathPlugin from '../src/json-path';

const mockApi = {
  tools: {
    register: vi.fn()
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  config: { extensions: {} },
};

describe('json-path plugin (retired)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export a Plugin object', () => {
    expect(jsonPathPlugin).toBeDefined();
    expect(jsonPathPlugin.name).toBe('json-path');
    expect(jsonPathPlugin.apiVersion).toBe('^0.1.10');
  });

  it('should register zero tools in setup (retired)', () => {
    jsonPathPlugin.setup(mockApi as any);
    expect(mockApi.tools.register).not.toHaveBeenCalled();
  });

  it('should log a deprecation notice on load', () => {
    jsonPathPlugin.setup(mockApi as any);
    expect(mockApi.log.info).toHaveBeenCalledWith(
      expect.stringContaining('retired'),
    );
  });
});
