import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyMemoryAnchors } from '../src/anchors/verify.js';
import { isSqliteAvailable, SqliteSuperMemoryStore } from '../src/sqlite-store.js';
import { SuperMemoryStore } from '../src/store.js';

describe('Super Memory agent relationships', () => {
  let projectRoot = '';

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrongstack-agent-anchor-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('materializes an about_agent edge in the canonical graph', async () => {
    const store = new SuperMemoryStore({ projectRoot });
    const memory = await store.rememberSuper({
      text: 'The reviewer must verify rollback behavior for database migrations.',
      anchors: [{ type: 'agent', role: 'Reviewer' }],
    });

    expect(memory.anchors).toEqual([{ type: 'agent', role: 'reviewer' }]);
    expect(await store.graphFor('agent:reviewer')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: `mem:${memory.id}`,
          to: 'agent:reviewer',
          relation: 'about_agent',
        }),
      ]),
    );
  });

  it('rejects malformed agent role anchors', async () => {
    const store = new SuperMemoryStore({ projectRoot });
    await expect(
      store.rememberSuper({
        text: 'This invalid role must never become a graph node.',
        anchors: [{ type: 'agent', role: '../reviewer' }],
      }),
    ).rejects.toThrow(/role is invalid/);
  });

  it('treats traversal-shaped legacy agent anchors as stale during verification', async () => {
    const store = new SuperMemoryStore({ projectRoot });
    const memory = await store.rememberSuper({
      text: 'A valid memory used to exercise legacy anchor verification.',
      anchors: [{ type: 'agent', role: 'reviewer' }],
    });

    const result = await verifyMemoryAnchors(projectRoot, {
      ...memory,
      anchors: [{ type: 'agent', role: '../reviewer' }],
    });
    expect(result.anchors[0]).toMatchObject({
      status: 'stale',
      reason: 'Agent anchor has an invalid role.',
    });
  });

  it.skipIf(!isSqliteAvailable())('keeps SQLite agent anchor edges in sync', async () => {
    const store = new SqliteSuperMemoryStore({ projectRoot });
    const memory = await store.rememberSuper({
      text: 'The executor follows the project package manager convention.',
      anchors: [{ type: 'agent', role: 'executor' }],
    });

    expect(await store.traverseGraph(['agent:executor'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: `mem:${memory.id}`,
          to: 'agent:executor',
          relation: 'about_agent',
        }),
      ]),
    );
    store.close();
  });
});
