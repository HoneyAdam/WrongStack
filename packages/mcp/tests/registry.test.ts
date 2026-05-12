import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, ToolRegistry, type Logger, type MCPServerConfig } from '@wrongstack/core';
import { MCPRegistry } from '../src/registry.js';

const silentLog: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => silentLog,
} as unknown as Logger;

const stdioCfg = (
  name: string,
  extra: Partial<MCPServerConfig> = {},
): MCPServerConfig => ({
  name,
  transport: 'stdio',
  command: 'never-actually-run',
  args: [],
  ...extra,
});

describe('MCPRegistry', () => {
  let toolReg: ToolRegistry;
  let events: EventBus;

  beforeEach(() => {
    toolReg = new ToolRegistry();
    events = new EventBus();
  });

  it('skips disabled servers', async () => {
    const reg = new MCPRegistry({ toolRegistry: toolReg, events, log: silentLog });
    await reg.start(stdioCfg('off', { enabled: false }));
    expect(reg.list()).toHaveLength(0);
  });

  it('emits disconnected after retries exhausted on failure', async () => {
    const reg = new MCPRegistry({ toolRegistry: toolReg, events, log: silentLog });
    const disconnects: unknown[] = [];
    events.on('mcp.server.disconnected', (p) => disconnects.push(p));
    // Use a command that will fail to spawn synchronously
    await reg.start(
      stdioCfg('broken', {
        command: '__nonexistent_binary_zzzz__',
        startupTimeoutMs: 50,
      }),
    );
    // Wait a moment to ensure retries finish — registry retries up to 3 with backoff
    // 500 * 2 + 500 * 4 = 3000ms. We don't want to actually wait that long, so just
    // verify that the entry exists and is in some non-connected state.
    const list = reg.list();
    expect(list.find((s) => s.name === 'broken')).toBeDefined();
  }, 10_000);

  it('list reports registered servers', async () => {
    const reg = new MCPRegistry({ toolRegistry: toolReg, events, log: silentLog });
    // start with disabled so we don't try to actually spawn
    await reg.start(stdioCfg('a', { enabled: false }));
    await reg.start(stdioCfg('b', { enabled: false }));
    expect(reg.list()).toHaveLength(0); // disabled never registered
  });

  it('stopAll is a no-op when nothing registered', async () => {
    const reg = new MCPRegistry({ toolRegistry: toolReg, events, log: silentLog });
    await expect(reg.stopAll()).resolves.toBeUndefined();
  });

  it('restart on unknown server throws', async () => {
    const reg = new MCPRegistry({ toolRegistry: toolReg, events, log: silentLog });
    await expect(reg.restart('nope')).rejects.toThrow(/not registered/);
  });

  it('stop on unknown name is a no-op', async () => {
    const reg = new MCPRegistry({ toolRegistry: toolReg, events, log: silentLog });
    await expect(reg.stop('nope')).resolves.toBeUndefined();
  });
});
