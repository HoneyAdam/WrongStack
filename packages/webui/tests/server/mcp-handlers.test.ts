import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleMcpAdd,
  handleMcpDisable,
  handleMcpDiscover,
  handleMcpEnable,
  handleMcpList,
  handleMcpRemove,
  handleMcpSleep,
  handleMcpUpdate,
  handleMcpWake,
} from '../../src/server/mcp-handlers';

let tmp: string;
let configPath: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-h-'));
  configPath = path.join(tmp, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({ version: 1 }));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Fake OPEN WebSocket that records every JSON message it's sent. */
function fakeWs() {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  return {
    readyState: 1, // WebSocket.OPEN
    send: (data: string) => sent.push(JSON.parse(data)),
    sent,
  };
}

function makeRegistry(overrides: Record<string, unknown> = {}) {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockReturnValue([]),
    ...overrides,
  } as never;
}

const msg = (type: string, payload?: unknown) => ({ type, payload }) as never;
const types = (ws: ReturnType<typeof fakeWs>) => ws.sent.map((m) => m.type);
const result = (ws: ReturnType<typeof fakeWs>) =>
  ws.sent.find((m) => m.type === 'mcp.operation_result')?.payload as {
    success: boolean;
    message: string;
  };

async function readServers() {
  const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
  return raw.mcpServers ?? {};
}

async function seed(servers: Record<string, unknown>) {
  await fs.writeFile(configPath, JSON.stringify({ version: 1, mcpServers: servers }));
}

// ── mcp.add ───────────────────────────────────────────────────────────────────

describe('mcp.add (WebUI "Add Custom" / "Add" official)', () => {
  it('adds a custom stdio server (enabled) → added + connected + ok, config persisted', async () => {
    const ws = fakeWs();
    const registry = makeRegistry();
    await handleMcpAdd(
      ws as never,
      msg('mcp.add', {
        name: 'fs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        enabled: true,
      }),
      configPath,
      registry,
    );
    const s = (await readServers()).fs;
    expect(s.command).toBe('npx');
    expect(s.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '.']);
    expect(s.enabled).toBe(true);
    expect((registry as { start: ReturnType<typeof vi.fn> }).start).toHaveBeenCalled();
    expect(types(ws)).toEqual(
      expect.arrayContaining(['mcp.server.added', 'mcp.server.connected', 'mcp.operation_result']),
    );
    expect(result(ws).success).toBe(true);
  });

  it('adds an official http server with url (context7), url persisted', async () => {
    const ws = fakeWs();
    await handleMcpAdd(
      ws as never,
      msg('mcp.add', {
        name: 'context7',
        transport: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        enabled: false,
      }),
      configPath,
      makeRegistry(),
    );
    expect((await readServers()).context7?.url).toBe('https://mcp.context7.com/mcp');
    expect(types(ws)).toContain('mcp.server.added');
    expect(result(ws).success).toBe(true);
  });

  it('normalizes a bare "http" transport to streamable-http', async () => {
    const ws = fakeWs();
    await handleMcpAdd(
      ws as never,
      msg('mcp.add', { name: 'svc', transport: 'http', url: 'https://x/mcp', enabled: false }),
      configPath,
      makeRegistry(),
    );
    expect((await readServers()).svc?.transport).toBe('streamable-http');
  });

  it('persists the lazy flag from the dialog checkbox', async () => {
    const ws = fakeWs();
    await handleMcpAdd(
      ws as never,
      msg('mcp.add', { name: 'fs', transport: 'stdio', command: 'npx', enabled: false, lazy: true }),
      configPath,
      makeRegistry(),
    );
    expect((await readServers()).fs?.lazy).toBe(true);
  });

  it('rejects a duplicate name', async () => {
    await seed({ fs: { name: 'fs', transport: 'stdio', command: 'npx' } });
    const ws = fakeWs();
    await handleMcpAdd(
      ws as never,
      msg('mcp.add', { name: 'fs', transport: 'stdio', command: 'npx' }),
      configPath,
      makeRegistry(),
    );
    expect(result(ws).success).toBe(false);
    expect(result(ws).message).toContain('already exists');
  });

  it('rejects a missing name', async () => {
    const ws = fakeWs();
    await handleMcpAdd(ws as never, msg('mcp.add', { transport: 'stdio' }), configPath, makeRegistry());
    expect(result(ws).success).toBe(false);
  });
});

// ── mcp.list ──────────────────────────────────────────────────────────────────

describe('mcp.list (WebUI panel load / refresh)', () => {
  it('returns an empty list when nothing is configured', async () => {
    const ws = fakeWs();
    await handleMcpList(ws as never, msg('mcp.list'), configPath, makeRegistry());
    const list = ws.sent.find((m) => m.type === 'mcp.list');
    expect((list?.payload as { servers: unknown[] }).servers).toEqual([]);
  });

  it('merges live registry status + real tool names', async () => {
    await seed({ github: { name: 'github', transport: 'stdio', command: 'npx', enabled: true } });
    const ws = fakeWs();
    await handleMcpList(
      ws as never,
      msg('mcp.list'),
      configPath,
      makeRegistry({ list: () => [{ name: 'github', state: 'connected', toolCount: 2, tools: ['a', 'b'] }] }),
    );
    const servers = (ws.sent.find((m) => m.type === 'mcp.list')?.payload as {
      servers: Array<{ status: string; tools: string[] }>;
    }).servers;
    expect(servers[0]?.status).toBe('connected');
    expect(servers[0]?.tools).toEqual(['a', 'b']);
  });

  it('maps a dormant lazy server to "sleeping" with cached tools', async () => {
    await seed({ ctx: { name: 'ctx', transport: 'stdio', command: 'npx', enabled: true, lazy: true } });
    const ws = fakeWs();
    await handleMcpList(
      ws as never,
      msg('mcp.list'),
      configPath,
      makeRegistry({ list: () => [{ name: 'ctx', state: 'dormant', toolCount: 1, tools: ['t'] }] }),
    );
    const s = (ws.sent.find((m) => m.type === 'mcp.list')?.payload as {
      servers: Array<{ status: string; lazy?: boolean; tools: string[] }>;
    }).servers[0];
    expect(s?.status).toBe('sleeping');
    expect(s?.lazy).toBe(true);
    expect(s?.tools).toEqual(['t']);
  });
});

// ── mcp.update (WebUI "Edit" dialog) ──────────────────────────────────────────

describe('mcp.update (WebUI Edit dialog)', () => {
  beforeEach(async () => {
    await seed({
      ctx: {
        name: 'ctx',
        transport: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        description: 'old',
        enabled: false,
      },
    });
  });

  it('preserves url/command when the Edit dialog omits them (blanked fields)', async () => {
    // The Edit dialog clears command/args/url and sends only changed fields —
    // the omitted ones must NOT be wiped from config.
    const ws = fakeWs();
    await handleMcpUpdate(
      ws as never,
      msg('mcp.update', { name: 'ctx', description: 'new description' }),
      configPath,
      makeRegistry(),
    );
    const s = (await readServers()).ctx;
    expect(s.url).toBe('https://mcp.context7.com/mcp'); // preserved
    expect(s.description).toBe('new description'); // updated
    expect(result(ws).success).toBe(true);
    expect(types(ws)).toContain('mcp.server.updated');
  });

  it('toggling "Enable server" on → starts the server + persists enabled:true', async () => {
    const ws = fakeWs();
    const registry = makeRegistry();
    await handleMcpUpdate(
      ws as never,
      msg('mcp.update', { name: 'ctx', enabled: true }),
      configPath,
      registry,
    );
    expect((await readServers()).ctx.enabled).toBe(true);
    expect(
      (registry as { start: ReturnType<typeof vi.fn>; restart: ReturnType<typeof vi.fn> }).start
        .mock.calls.length +
        (registry as { restart: ReturnType<typeof vi.fn> }).restart.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it('changing the url persists the new value', async () => {
    const ws = fakeWs();
    await handleMcpUpdate(
      ws as never,
      msg('mcp.update', { name: 'ctx', url: 'https://new.example/mcp' }),
      configPath,
      makeRegistry(),
    );
    expect((await readServers()).ctx.url).toBe('https://new.example/mcp');
  });

  it('errors on a server that is not in config', async () => {
    const ws = fakeWs();
    await handleMcpUpdate(ws as never, msg('mcp.update', { name: 'ghost' }), configPath, makeRegistry());
    expect(result(ws).success).toBe(false);
    expect(result(ws).message).toContain('not found');
  });
});

// ── mcp.wake / mcp.sleep / mcp.discover (card buttons) ─────────────────────────

describe('mcp.wake / mcp.sleep / mcp.discover (server card buttons)', () => {
  beforeEach(async () => {
    await seed({ github: { name: 'github', transport: 'stdio', command: 'npx', enabled: true } });
  });

  it('wake restarts a registered server → waking + connected + ok', async () => {
    const ws = fakeWs();
    const registry = makeRegistry({ list: () => [{ name: 'github', state: 'connected', toolCount: 0, tools: [] }] });
    await handleMcpWake(ws as never, msg('mcp.wake', { name: 'github' }), configPath, registry);
    expect((registry as { restart: ReturnType<typeof vi.fn> }).restart).toHaveBeenCalledWith('github');
    expect(types(ws)).toEqual(expect.arrayContaining(['mcp.server.waking', 'mcp.server.connected']));
    expect(result(ws).success).toBe(true);
  });

  it('sleep stops the process but KEEPS enabled:true in config', async () => {
    const ws = fakeWs();
    const registry = makeRegistry();
    await handleMcpSleep(ws as never, msg('mcp.sleep', { name: 'github' }), configPath, registry);
    expect((registry as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalledWith('github');
    // Sleep is NOT disable — config stays enabled.
    expect((await readServers()).github.enabled).toBe(true);
    expect(types(ws)).toContain('mcp.server.sleeping');
    expect(result(ws).success).toBe(true);
  });

  it('discover reports live tools from the server', async () => {
    const ws = fakeWs();
    const registry = makeRegistry({ list: () => [{ name: 'github', state: 'connected', toolCount: 3, tools: ['x', 'y', 'z'] }] });
    await handleMcpDiscover(ws as never, msg('mcp.discover', { name: 'github' }), configPath, registry);
    const d = ws.sent.find((m) => m.type === 'mcp.server.discovered')?.payload as { tools: string[] };
    expect(d.tools).toEqual(['x', 'y', 'z']);
    expect(result(ws).success).toBe(true);
  });

  it('wake reports failure (not crash) when the server fails to restart', async () => {
    const ws = fakeWs();
    const registry = makeRegistry({
      list: () => [{ name: 'github', state: 'connected', toolCount: 0, tools: [] }],
      restart: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await handleMcpWake(ws as never, msg('mcp.wake', { name: 'github' }), configPath, registry);
    expect(result(ws).success).toBe(false);
    expect(result(ws).message).toContain('boom');
  });
});

// ── mcp.enable / mcp.disable / mcp.remove ─────────────────────────────────────

describe('mcp.enable / mcp.disable / mcp.remove', () => {
  beforeEach(async () => {
    await seed({ github: { name: 'github', transport: 'stdio', command: 'npx', enabled: false } });
  });

  it('enable flips config and starts', async () => {
    const ws = fakeWs();
    const registry = makeRegistry();
    await handleMcpEnable(ws as never, msg('mcp.enable', { name: 'github' }), configPath, registry);
    expect((await readServers()).github?.enabled).toBe(true);
    expect(types(ws)).toContain('mcp.server.connected');
  });

  it('disable stops and flips config to false', async () => {
    await seed({ github: { name: 'github', transport: 'stdio', command: 'npx', enabled: true } });
    const ws = fakeWs();
    const registry = makeRegistry();
    await handleMcpDisable(ws as never, msg('mcp.disable', { name: 'github' }), configPath, registry);
    expect((registry as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalledWith('github');
    expect((await readServers()).github?.enabled).toBe(false);
    expect(types(ws)).toContain('mcp.server.sleeping');
  });

  it('remove deletes from config + emits removed', async () => {
    const ws = fakeWs();
    await handleMcpRemove(ws as never, msg('mcp.remove', { name: 'github' }), configPath, makeRegistry());
    expect(await readServers()).toEqual({});
    expect(types(ws)).toContain('mcp.server.removed');
  });

  it('remove errors when the server is not present', async () => {
    const ws = fakeWs();
    await handleMcpRemove(ws as never, msg('mcp.remove', { name: 'ghost' }), configPath, makeRegistry());
    expect(result(ws).success).toBe(false);
  });
});

// ── registry-missing guard (defensive) ────────────────────────────────────────

describe('registry-missing guard', () => {
  it('every mutating op reports a clean failure (no crash) without a registry', async () => {
    for (const [handler, type] of [
      [handleMcpAdd, 'mcp.add'],
      [handleMcpUpdate, 'mcp.update'],
      [handleMcpRemove, 'mcp.remove'],
      [handleMcpEnable, 'mcp.enable'],
      [handleMcpDisable, 'mcp.disable'],
      [handleMcpWake, 'mcp.wake'],
      [handleMcpSleep, 'mcp.sleep'],
      [handleMcpDiscover, 'mcp.discover'],
    ] as const) {
      const ws = fakeWs();
      await handler(ws as never, msg(type, { name: 'x' }), configPath, undefined);
      expect(result(ws).success).toBe(false);
    }
  });
});
