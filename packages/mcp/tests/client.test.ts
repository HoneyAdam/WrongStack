import { describe, it, expect } from 'vitest';
import { MCPClient } from '../src/client.js';

describe('MCPClient', () => {
  it('starts in idle state', () => {
    const c = new MCPClient({ name: 'test', transport: 'stdio', command: 'noop' });
    expect(c.getState()).toBe('idle');
    expect(c.listTools()).toEqual([]);
  });

  it('rejects non-stdio transports', async () => {
    const c = new MCPClient({ name: 'sse-only', transport: 'sse', url: 'https://x' });
    await expect(c.connect()).rejects.toThrow(/not supported/);
    expect(c.getState()).toBe('failed');
  });

  it('rejects streamable-http transport', async () => {
    const c = new MCPClient({ name: 'http-only', transport: 'streamable-http', url: 'https://x' });
    await expect(c.connect()).rejects.toThrow(/not supported/);
  });

  it('requires command for stdio transport', async () => {
    const c = new MCPClient({ name: 'no-cmd', transport: 'stdio' });
    await expect(c.connect()).rejects.toThrow(/requires "command"/);
    expect(c.getState()).toBe('failed');
  });

  it('callTool rejects when not connected', async () => {
    const c = new MCPClient({ name: 'idle', transport: 'stdio', command: 'noop' });
    await expect(c.callTool('any', {})).rejects.toThrow(/not connected/);
  });

  it('close on idle client is a no-op', async () => {
    const c = new MCPClient({ name: 'idle', transport: 'stdio', command: 'noop' });
    await expect(c.close()).resolves.toBeUndefined();
    expect(c.getState()).toBe('disconnected');
  });

  it('connect to nonexistent binary fails with timeout', async () => {
    const c = new MCPClient({
      name: 'broken',
      transport: 'stdio',
      command: '__definitely_not_a_binary__',
      startupTimeoutMs: 100,
    });
    await expect(c.connect()).rejects.toThrow();
  });
});
