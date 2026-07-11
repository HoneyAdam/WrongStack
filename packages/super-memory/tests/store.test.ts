import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SuperMemoryStore,
  createSuperMemoryToolCallMiddleware,
} from '../src/index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-super-memory-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('SuperMemoryStore', () => {
  it('stores project-local JSONL memory and exposes the legacy MemoryStore list/search contract', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });

    await store.remember('Project uses pnpm for workspace commands', 'project-memory', {
      type: 'convention',
      tags: ['pnpm', 'workspace'],
      priority: 'high',
    });

    const list = await store.list('project-memory');
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe('Project uses pnpm for workspace commands');
    expect(list[0]?.type).toBe('convention');

    const found = await store.search('pnpm workspace', 'project-memory');
    expect(found).toHaveLength(1);

    const raw = await fs.readFile(path.join(tempDir, '.wrongstack', 'memories', 'memories.jsonl'), 'utf8');
    expect(raw).toContain('"recordType":"memory"');
  });

  it('retrieves memory attached to a file path and ancestor directory', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });

    await store.rememberSuper({
      text: 'Session storage changes require lifecycle regression tests',
      kind: 'warning',
      importance: 0.95,
      anchors: [{ type: 'directory', path: 'packages/core/src/storage' }],
      tags: ['session', 'storage'],
    });

    const direct = await store.retrieveForPath({
      path: 'packages/core/src/storage/session-store.ts',
      limit: 5,
    });

    expect(direct.map((m) => m.text)).toContain('Session storage changes require lifecycle regression tests');
  });

  it('rejects obvious secrets', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });

    await expect(
      store.remember('api_key = "abcdefghijklmnopqrstuvwxyz123456"'),
    ).rejects.toThrow(/secret/i);
  });
});

describe('Super Memory tool-call middleware', () => {
  it('appends related file memory to read results and applies repeat cooldown', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Do not emit session_end from save-only flows',
      kind: 'warning',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'packages/core/src/storage/session-store.ts' }],
      tags: ['session'],
    });

    const mw = createSuperMemoryToolCallMiddleware({
      memory: store,
      repeatCooldownMs: 60_000,
    });

    const payload = {
      toolUse: {
        type: 'tool_use' as const,
        id: 'toolu_1',
        name: 'read',
        input: { path: 'packages/core/src/storage/session-store.ts' },
      },
      result: {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_1',
        name: 'read',
        content: '1| export class SessionStore {}',
      },
      ctx: { projectRoot: tempDir, session: { id: 'sess' } },
    };

    await mw.handler(payload as never, async (value) => value);
    expect(payload.result.content).toContain('Super Memory: related project knowledge');
    expect(payload.result.content).toContain('Do not emit session_end');

    const second = {
      ...payload,
      result: {
        ...payload.result,
        content: '1| export class SessionStore {}',
      },
    };
    await mw.handler(second as never, async (value) => value);
    expect(second.result.content).not.toContain('Super Memory: related project knowledge');
  });
});
