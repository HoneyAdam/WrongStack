import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const histMocks = vi.hoisted(() => ({
  listHistory: vi.fn(),
  getHistoryEntry: vi.fn(),
  restoreFromHistory: vi.fn(),
  restoreLast: vi.fn(),
}));

vi.mock('../src/config-history.js', () => histMocks);

const fleetMocks = vi.hoisted(() => ({ sessionsFleetCmd: vi.fn() }));

vi.mock('../src/subcommands/handlers/sessions-fleet.js', () => ({
  sessionsFleetCmd: fleetMocks.sessionsFleetCmd,
}));

import { sessionsCmd, configCmd } from '../src/subcommands/handlers/sessions-config.js';

let tmp: string;
let writes: string[];
let errors: string[];
let renderer: { write: (s: string) => void; writeError: (s: string) => void };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-cfg-'));
  writes = [];
  errors = [];
  renderer = {
    write: (s: string) => writes.push(s),
    writeError: (s: string) => errors.push(s),
  };
  histMocks.listHistory.mockReset();
  histMocks.getHistoryEntry.mockReset();
  histMocks.restoreFromHistory.mockReset();
  histMocks.restoreLast.mockReset();
  fleetMocks.sessionsFleetCmd.mockReset();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function mkDeps(over: Record<string, unknown> = {}) {
  return {
    renderer,
    config: { providers: { anth: { apiKey: 'secret' } }, model: 'opus' },
    paths: { globalConfig: path.join(tmp, 'config.json') },
    sessionStore: {
      list: vi.fn().mockResolvedValue([]),
    },
    ...over,
  } as never;
}

// ── sessionsCmd ──────────────────────────────────────────────────────────────

describe('sessionsCmd', () => {
  it('delegates to sessionsFleetCmd when first arg is "fleet"', async () => {
    fleetMocks.sessionsFleetCmd.mockResolvedValue(0);
    const code = await sessionsCmd(['fleet', 'run-1'], mkDeps());
    expect(code).toBe(0);
    expect(fleetMocks.sessionsFleetCmd).toHaveBeenCalledWith(['run-1'], expect.anything());
  });

  it('errors when no session store is wired', async () => {
    const code = await sessionsCmd([], mkDeps({ sessionStore: undefined }));
    expect(code).toBe(1);
    expect(errors[0]).toContain('No session store');
  });

  it('prints "No sessions found" on empty list', async () => {
    const deps = mkDeps();
    const code = await sessionsCmd([], deps);
    expect(code).toBe(0);
    expect(writes.join('')).toContain('No sessions found');
  });

  it('lists sessions with id, time, tokens, and title', async () => {
    const deps = mkDeps({
      sessionStore: {
        list: vi.fn().mockResolvedValue([
          { id: 'sess-1', startedAt: '2026-05-22', tokenTotal: 123, title: 'first' },
          { id: 'sess-2', startedAt: '2026-05-23', tokenTotal: 456, title: 'second' },
        ]),
      },
    });
    const code = await sessionsCmd([], deps);
    expect(code).toBe(0);
    const out = writes.join('');
    expect(out).toContain('sess-1');
    expect(out).toContain('first');
    expect(out).toContain('sess-2');
    expect(out).toContain('123');
  });
});

// ── configCmd ────────────────────────────────────────────────────────────────

describe('configCmd', () => {
  it('default (no arg) prints redacted config JSON', async () => {
    const code = await configCmd([], mkDeps());
    expect(code).toBe(0);
    const out = writes.join('');
    expect(out).toContain('providers');
    expect(out).not.toContain('secret'); // apiKey should be redacted
  });

  it('show is an alias for the default', async () => {
    const code = await configCmd(['show'], mkDeps());
    expect(code).toBe(0);
    expect(writes.join('')).toContain('providers');
  });

  it('edit prints the editor command line', async () => {
    delete process.env['EDITOR'];
    const code = await configCmd(['edit'], mkDeps());
    expect(code).toBe(0);
    expect(writes.join('')).toMatch(/Run: vi /);
    expect(writes.join('')).toContain('config.json');
  });

  it('edit respects $EDITOR env var', async () => {
    process.env['EDITOR'] = 'nvim';
    const code = await configCmd(['edit'], mkDeps());
    expect(code).toBe(0);
    expect(writes.join('')).toMatch(/Run: nvim/);
    delete process.env['EDITOR'];
  });

  it('errors on unknown subcommand', async () => {
    const code = await configCmd(['frobulate'], mkDeps());
    expect(code).toBe(1);
    expect(errors[0]).toContain('Unknown config subcommand');
  });

  // ── config history ────────────────────────────────────────────────────────

  it('history (no entries) prints "No config history yet"', async () => {
    histMocks.listHistory.mockResolvedValue([]);
    const code = await configCmd(['history'], mkDeps());
    expect(code).toBe(0);
    expect(writes.join('')).toContain('No config history yet');
  });

  it('history lists entries with description truncation > 60 chars', async () => {
    histMocks.listHistory.mockResolvedValue([
      {
        id: 'h-1',
        timestamp: Date.now(),
        description: 'short change',
        diffSummary: '+1 -0',
      },
      {
        id: 'h-2',
        timestamp: Date.now(),
        description: 'x'.repeat(80),
        diffSummary: '+2 -1',
      },
    ]);
    const code = await configCmd(['history'], mkDeps());
    expect(code).toBe(0);
    const out = writes.join('');
    expect(out).toContain('Config History');
    expect(out).toContain('h-1');
    expect(out).toContain('short change');
    expect(out).toContain('…'); // truncated marker
  });

  it('history --id <id> prints details when entry exists', async () => {
    histMocks.getHistoryEntry.mockResolvedValue({
      id: 'h-99',
      timestamp: 1716345600000,
      description: 'changed provider',
      diffSummary: '+1 -1',
      snapshotMasked: { provider: 'openai' },
    });
    const code = await configCmd(['history', '--id', 'h-99'], mkDeps());
    expect(code).toBe(0);
    const out = writes.join('');
    expect(out).toContain('h-99');
    expect(out).toContain('changed provider');
    expect(out).toContain('openai');
  });

  it('history --id <id> errors when entry is missing', async () => {
    histMocks.getHistoryEntry.mockResolvedValue(undefined);
    const code = await configCmd(['history', '--id', 'missing'], mkDeps());
    expect(code).toBe(1);
    expect(errors[0]).toContain('not found');
  });

  it('history --id=<id> form (equals sign) also works', async () => {
    histMocks.getHistoryEntry.mockResolvedValue({
      id: 'h-1',
      timestamp: 0,
      description: 'd',
      diffSummary: '',
      snapshotMasked: {},
    });
    await configCmd(['history', '--id=h-1'], mkDeps());
    expect(histMocks.getHistoryEntry).toHaveBeenCalledWith('h-1');
  });

  // ── config restore ────────────────────────────────────────────────────────

  it('restore --latest calls restoreLast', async () => {
    histMocks.restoreLast.mockResolvedValue({ ok: true });
    const code = await configCmd(['restore', '--latest'], mkDeps());
    expect(code).toBe(0);
    expect(histMocks.restoreLast).toHaveBeenCalled();
    expect(writes.join('')).toContain('Restored from config.json.last');
  });

  it('restore -l (shortcut) also calls restoreLast', async () => {
    histMocks.restoreLast.mockResolvedValue({ ok: true });
    await configCmd(['restore', '-l'], mkDeps());
    expect(histMocks.restoreLast).toHaveBeenCalled();
  });

  it('restore --latest reports the error when restoreLast fails', async () => {
    histMocks.restoreLast.mockResolvedValue({ ok: false, error: 'corrupt' });
    const code = await configCmd(['restore', '--latest'], mkDeps());
    expect(code).toBe(1);
    expect(errors[0]).toContain('corrupt');
  });

  it('restore without args prints usage', async () => {
    const code = await configCmd(['restore'], mkDeps());
    expect(code).toBe(1);
    expect(writes.join('')).toContain('Usage:');
  });

  it('restore <id> calls restoreFromHistory', async () => {
    histMocks.restoreFromHistory.mockResolvedValue({ ok: true });
    const code = await configCmd(['restore', 'h-3'], mkDeps());
    expect(code).toBe(0);
    expect(histMocks.restoreFromHistory).toHaveBeenCalledWith('h-3');
    expect(writes.join('')).toContain('Restored to history entry');
  });

  it('restore --id <id> form also works', async () => {
    histMocks.restoreFromHistory.mockResolvedValue({ ok: true });
    await configCmd(['restore', '--id', 'h-4'], mkDeps());
    expect(histMocks.restoreFromHistory).toHaveBeenCalledWith('h-4');
  });

  it('restore <id> reports error on failure', async () => {
    histMocks.restoreFromHistory.mockResolvedValue({ ok: false, error: 'no such id' });
    const code = await configCmd(['restore', 'h-x'], mkDeps());
    expect(code).toBe(1);
    expect(errors[0]).toContain('no such id');
  });
});
