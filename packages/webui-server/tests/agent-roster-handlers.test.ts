import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { AgentRosterWSHandler } from '../src/server/agent-roster-handlers.js';

describe('AgentRosterWSHandler', () => {
  let projectRoot = '';
  let handler: AgentRosterWSHandler;
  const ws = {} as WebSocket;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrongstack-roster-handler-'));
    handler = new AgentRosterWSHandler({ projectRoot: () => projectRoot });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('lists the complete catalog even before any role has learned data', async () => {
    const response = await handler.handleMessage(ws, 'agent-roster.list', {});
    const payload = response.payload as { roles: string[]; stats: unknown[]; catalog: unknown[] };

    expect(payload.roles).toContain('executor');
    expect(payload.roles.length).toBeGreaterThan(20);
    expect(payload.stats).toHaveLength(payload.roles.length);
    expect(payload.catalog).toHaveLength(payload.roles.length);
  });

  it('pauses learning without deleting the role knowledge', async () => {
    await handler.handleMessage(ws, 'agent-roster.append-learned', {
      role: 'executor',
      content: 'Use the project package manager and preserve focused test evidence.',
    });
    const response = await handler.handleMessage(ws, 'agent-roster.update-learning', {
      role: 'executor',
      enabled: false,
    });
    const payload = response.payload as {
      success: boolean;
      stats: { learningEnabled: boolean; entryCount: number };
    };

    expect(payload.success).toBe(true);
    expect(payload.stats).toMatchObject({ learningEnabled: false, entryCount: 1 });
    expect(
      fs.existsSync(path.join(projectRoot, '.wrongstack', 'agents', 'executor', 'learned.md')),
    ).toBe(true);
  });

  it('rejects traversal role ids', async () => {
    await expect(
      handler.handleMessage(ws, 'agent-roster.update-identity', {
        role: '../outside',
        content: 'invalid',
      }),
    ).rejects.toThrow(/Invalid project agent role/);
  });

  it('requires an explicit role for reset and allows clearing learned content', async () => {
    await handler.handleMessage(ws, 'agent-roster.append-learned', {
      role: 'executor',
      content: 'Temporary lesson that the operator can remove.',
    });

    const reset = await handler.handleMessage(ws, 'agent-roster.reset', {});
    expect(reset.payload).toMatchObject({ error: expect.stringContaining('role required') });

    const cleared = await handler.handleMessage(ws, 'agent-roster.update-learned', {
      role: 'executor',
      content: '',
    });
    expect(cleared.payload).toMatchObject({ success: true });
    expect(
      fs.readFileSync(
        path.join(projectRoot, '.wrongstack', 'agents', 'executor', 'learned.md'),
        'utf8',
      ),
    ).toBe('');
  });

  it('rejects malformed runtime config instead of persisting it', async () => {
    await expect(
      handler.handleMessage(ws, 'agent-roster.update-config', {
        role: 'executor',
        config: { tools: 'shell', budget: { timeoutMs: -1 } },
      }),
    ).rejects.toThrow(/config "tools"/);
  });

  it('persists the complete runtime policy and marks built-in roles as protected', async () => {
    const updated = await handler.handleMessage(ws, 'agent-roster.update-config', {
      role: 'executor',
      config: {
        tools: ['read_file'],
        allowedCapabilities: ['fs.read'],
        cwd: 'packages/core',
        worktree: 'required',
        modelPolicy: {
          allowed: [
            { provider: 'openai', model: 'primary' },
            { provider: 'anthropic', model: 'fallback' },
          ],
          fallbacks: [{ provider: 'anthropic', model: 'fallback' }],
          strict: true,
        },
        availability: {
          timezone: 'Europe/Kiev',
          days: [1, 2, 3, 4, 5],
          start: '09:00',
          end: '18:00',
          mode: 'enforce',
        },
        budget: { maxIterations: 50, maxToolCalls: 100 },
      },
    });
    expect(updated.payload).toMatchObject({ success: true, role: 'executor' });

    const read = await handler.handleMessage(ws, 'agent-roster.read-customization', {
      role: 'executor',
    });
    expect(read.payload).toMatchObject({
      systemProtected: true,
      config: {
        cwd: 'packages/core',
        worktree: 'required',
        modelPolicy: { strict: true },
        availability: { timezone: 'Europe/Kiev', mode: 'enforce' },
      },
    });
  });

  it('creates and lists an independently managed generic project agent', async () => {
    const created = await handler.handleMessage(ws, 'agent-roster.create-generic', {
      name: 'ABC',
      purpose: 'Own X, Y and Z workflows for this project.',
      taskTypes: ['X workflow', 'Y analysis', 'Z verification'],
    });
    expect(created.payload).toMatchObject({ success: true, role: 'abc' });

    const listed = await handler.handleMessage(ws, 'agent-roster.list', {});
    const payload = listed.payload as {
      roles: string[];
      catalog: Array<{ role: string; name: string; custom: boolean; baseRole?: string }>;
    };
    expect(payload.roles).toContain('abc');
    expect(payload.catalog).toContainEqual(
      expect.objectContaining({ role: 'abc', name: 'ABC', custom: true, baseRole: 'generic' }),
    );
    expect(
      fs.existsSync(path.join(projectRoot, '.wrongstack', 'agents', 'abc', 'profile.json')),
    ).toBe(true);
  });

  it('clones a selected roster role and rejects missing clone sources', async () => {
    const created = await handler.handleMessage(ws, 'agent-roster.create', {
      name: 'Project Executor',
      baseRole: 'executor',
      purpose: 'Execute project-specific implementation and verification tasks.',
      taskTypes: ['implementation', 'verification'],
    });
    expect(created.payload).toMatchObject({
      success: true,
      role: 'project-executor',
      profile: { baseRole: 'executor' },
    });

    const missing = await handler.handleMessage(ws, 'agent-roster.create', {
      name: 'Broken Clone',
      baseRole: 'does-not-exist',
      purpose: 'This clone should not be created from an unknown role.',
      taskTypes: ['invalid clone'],
    });
    expect(missing.payload).toMatchObject({ error: expect.stringContaining('unknown') });
  });
});
