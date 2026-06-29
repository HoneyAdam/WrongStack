import { describe, expect, it, vi, beforeEach } from 'vitest';
import webSearchPlugin from '../src/web-search';

const mockApi = {
  tools: { register: vi.fn() },
  config: { extensions: {} },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { counter: vi.fn(), histogram: vi.fn(), gauge: vi.fn() },
};

describe('web-search plugin (retired)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a default Plugin object', () => {
    expect(webSearchPlugin).toBeDefined();
    expect(typeof webSearchPlugin).toBe('object');
  });

  it('plugin has correct name', () => {
    expect(webSearchPlugin.name).toBe('web-search');
  });

  it('plugin has correct apiVersion', () => {
    expect(webSearchPlugin.apiVersion).toMatch(/^\^?0\.1/);
  });

  it('registers zero tools in setup (retired)', () => {
    webSearchPlugin.setup(mockApi as any);
    expect(mockApi.tools.register).not.toHaveBeenCalled();
  });

  it('logs a deprecation notice on load', () => {
    webSearchPlugin.setup(mockApi as any);
    expect(mockApi.log.info).toHaveBeenCalledWith(
      expect.stringContaining('retired'),
    );
  });
});
