import { describe, it, expect, vi } from 'vitest';
import { buildLspCommand } from '../../src/slash-commands/lsp.js';
import type { LSPRegistry } from '../../src/registry.js';
import type { DocumentTracker } from '../../src/document-tracker.js';
import type { PlugLSPConfig } from '../../src/types.js';

// ── Mock helpers ────────────────────────────────────────────────────────

interface MockServer {
  name: string;
  state: 'stopped' | 'starting' | 'initializing' | 'ready' | 'failed' | 'disabled';
  config: {
    command: string;
    args?: string[];
    languages?: string[];
    rootPatterns?: string[];
    enabled?: boolean;
  };
  lastStderr?: string;
  diagnostics: Map<string, unknown[]>;
}

function makeRegistry(servers: MockServer[]): LSPRegistry {
  const map = new Map(servers.map((s) => [s.name, s]));
  return {
    list: vi.fn(() => servers),
    start: vi.fn(async (name: string) => {
      const srv = map.get(name);
      if (!srv) throw new Error(`Unknown server: ${name}`);
      if (srv.state === 'failed') throw new Error('Server process exited');
      srv.state = 'ready';
    }),
    stop: vi.fn((name: string) => {
      const srv = map.get(name);
      if (srv) srv.state = 'stopped';
    }),
  } as unknown as LSPRegistry;
}

function makeTracker(files: string[] = []): DocumentTracker {
  return {
    list: vi.fn(() => files),
  } as unknown as DocumentTracker;
}

function makeCtx(servers: MockServer[] = [], files: string[] = []) {
  return {
    registry: makeRegistry(servers),
    tracker: makeTracker(files),
    cfg: { autoStart: false, severityFilter: 'hint', maxDiagnosticsPerFile: 50, maxDiagnosticsTotal: 500 } as PlugLSPConfig,
    cwd: '/proj',
  };
}

async function runCmd(ctx: ReturnType<typeof makeCtx>, args: string) {
  const cmd = buildLspCommand(ctx);
  return cmd.run!(args);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('buildLspCommand — parseArgs dispatch', () => {
  it('returns the command metadata', () => {
    const cmd = buildLspCommand(makeCtx());
    expect(cmd.name).toBe('lsp');
    expect(cmd.category).toBe('Inspect');
    expect(cmd.aliases).toContain('lsplsp');
    expect(cmd.help).toContain('Usage:');
  });

  it('defaults to list when no args', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, '');
    expect(result.message).toContain('No servers configured');
  });

  it('list shows all configured servers with state', async () => {
    const ctx = makeCtx([
      { name: 'tsserver', state: 'ready', config: { command: 'typescript-language-server', args: ['--stdio'], languages: ['typescript'], enabled: true }, diagnostics: new Map() },
      { name: 'gopls', state: 'failed', config: { command: 'gopls', args: ['serve'], languages: ['go'], enabled: true }, lastStderr: 'binary not found', diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'list');
    expect(result.message).toContain('tsserver');
    expect(result.message).toContain('READY');
    expect(result.message).toContain('gopls');
    expect(result.message).toContain('FAILED');
  });

  it('ls is an alias for list', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'ls');
    expect(result.message).toContain('No servers configured');
  });

  it('status shows summary counts', async () => {
    const ctx = makeCtx([
      { name: 'tsserver', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
      { name: 'gopls', state: 'failed', config: { command: 'gopls', languages: ['go'], enabled: true }, lastStderr: 'oops', diagnostics: new Map() },
      { name: 'pylsp', state: 'starting', config: { command: 'pylsp', languages: ['py'], enabled: true }, diagnostics: new Map() },
    ], ['/proj/a.ts']);
    const result = await runCmd(ctx, 'status');
    expect(result.message).toContain('Total servers:');
    expect(result.message).toContain('Ready:');
    expect(result.message).toContain('Starting:');
    expect(result.message).toContain('Failed:');
    expect(result.message).toContain('Failed servers:');
    expect(result.message).toContain('gopls');
    expect(result.message).toContain('oops');
    expect(result.message).toContain('Active files tracked:');
  });

  it('stat is an alias for status', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'stat');
    expect(result.message).toContain('LSP Status Report');
  });

  it('help returns the help text', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'help');
    expect(result.message).toContain('Usage:');
  });

  it('h and --help are aliases for help', async () => {
    const ctx = makeCtx([]);
    expect((await runCmd(ctx, 'h')).message).toContain('Usage:');
    expect((await runCmd(ctx, '--help')).message).toContain('Usage:');
  });

  it('unknown subcommand falls back to help', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'xyz');
    expect(result.message).toContain('Usage:');
  });
});

describe('buildLspCommand — start/stop/restart', () => {
  it('starts a specific server by name', async () => {
    const ctx = makeCtx([
      { name: 'tsserver', state: 'stopped', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'start tsserver');
    expect(result.message).toContain('Started:');
    expect(ctx.registry.start).toHaveBeenCalledWith('tsserver');
  });

  it('start with unknown name returns error', async () => {
    const ctx = makeCtx([
      { name: 'tsserver', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'start gopls');
    expect(result.message).toContain('Server not found:');
    expect(result.message).toContain('tsserver');
  });

  it('start all skips ready and disabled servers', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
      { name: 'go', state: 'stopped', config: { command: 'gopls', languages: ['go'], enabled: true }, diagnostics: new Map() },
      { name: 'py', state: 'stopped', config: { command: 'pylsp', languages: ['py'], enabled: false }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'start');
    expect(result.message).toContain('Started:');
    expect(result.message).toContain('go');
    // ts was already ready, py was disabled
    expect(ctx.registry.start).toHaveBeenCalledTimes(1);
    expect(ctx.registry.start).toHaveBeenCalledWith('go');
  });

  it('start reports failure when registry.start throws', async () => {
    const ctx = makeCtx([
      { name: 'go', state: 'failed', config: { command: 'gopls', languages: ['go'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'start go');
    expect(result.message).toContain('Failed to start:');
  });

  it('start with no servers returns a hint', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'start');
    expect(result.message).toContain('No servers to start');
  });

  it('stops a specific server', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'stop ts');
    expect(result.message).toContain('Stopped:');
    expect(ctx.registry.stop).toHaveBeenCalledWith('ts');
  });

  it('stop with unknown name returns error', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'stop ghost');
    expect(result.message).toContain('Server not found:');
  });

  it('stops all servers', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
      { name: 'go', state: 'ready', config: { command: 'gopls', languages: ['go'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'stop');
    expect(result.message).toContain('2 server(s)');
    expect(ctx.registry.stop).toHaveBeenCalledTimes(2);
  });

  it('restarts a specific server', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'restart ts');
    expect(result.message).toContain('Restarted:');
    expect(ctx.registry.stop).toHaveBeenCalledWith('ts');
    expect(ctx.registry.start).toHaveBeenCalledWith('ts');
  });

  it('restart with unknown name returns error', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'restart ghost');
    expect(result.message).toContain('Server not found:');
  });

  it('reload is an alias for restart', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'reload ts');
    expect(result.message).toContain('Restarted:');
  });

  it('restart all enabled servers', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
      { name: 'go', state: 'ready', config: { command: 'gopls', languages: ['go'], enabled: false }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'restart');
    expect(result.message).toContain('Restarted:');
    expect(result.message).toContain('ts');
    // go is disabled, should not be restarted
    expect(ctx.registry.start).toHaveBeenCalledTimes(1);
  });
});

describe('buildLspCommand — install', () => {
  it('rejects unknown language', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'install cobol');
    expect(result.message).toContain('Unknown language:');
    expect(result.message).toContain('Supported languages:');
  });

  it('install without language returns help', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'install');
    expect(result.message).toContain('Usage:');
  });
});

describe('buildLspCommand — config mutations (add/remove/enable/disable)', () => {
  it('add returns help (no add subcommand in parser — falls to help)', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'add');
    expect(result.message).toContain('Usage:');
  });

  it('remove returns config instructions', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'remove foo');
    expect(result.message).toContain('To remove a server');
  });

  it('remove without name returns help', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'remove');
    expect(result.message).toContain('Usage:');
  });

  it('rm and delete are aliases for remove', async () => {
    const ctx = makeCtx([]);
    expect((await runCmd(ctx, 'rm foo')).message).toContain('To remove a server');
    expect((await runCmd(ctx, 'delete foo')).message).toContain('To remove a server');
  });

  it('enable returns config instructions', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'enable foo');
    expect(result.message).toContain('To enable a server');
  });

  it('enable without name returns help', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'enable');
    expect(result.message).toContain('Usage:');
  });

  it('disable returns config instructions', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'disable foo');
    expect(result.message).toContain('To disable a server');
  });

  it('disable without name returns help', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'disable');
    expect(result.message).toContain('Usage:');
  });
});

describe('buildLspCommand — diagnostics', () => {
  it('shows no-diagnostics message when no servers are ready', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'stopped', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'diagnostics');
    expect(result.message).toContain('No diagnostics reported');
  });

  it('shows workspace diagnostics overview', async () => {
    const diagMap = new Map([['file:///proj/src/a.ts', [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: 'syntax error' }]]]);
    const ctx = {
      registry: makeRegistry([
        { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: diagMap },
      ]),
      tracker: makeTracker(),
      cfg: { autoStart: false, severityFilter: 'error', maxDiagnosticsPerFile: 50, maxDiagnosticsTotal: 500 } as PlugLSPConfig,
      cwd: '/proj',
    };
    const result = await runCmd(ctx, 'diagnostics');
    expect(result.message).toContain('Showing diagnostics');
  });

  it('diag is an alias for diagnostics', async () => {
    const ctx = makeCtx([]);
    const result = await runCmd(ctx, 'diag');
    expect(result.message).toContain('LSP Diagnostics');
  });

  it('diagnostics for a specific file with no issues', async () => {
    const ctx = makeCtx([
      { name: 'ts', state: 'ready', config: { command: 'tsls', languages: ['ts'], enabled: true }, diagnostics: new Map() },
    ]);
    const result = await runCmd(ctx, 'diagnostics src/clean.ts');
    expect(result.message).toContain('No diagnostics for');
  });
});
