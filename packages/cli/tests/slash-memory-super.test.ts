import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { JsonlMemoryPort } from '@wrongstack/super-memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMemoryCommand } from '../src/slash-commands/memory.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-slash-memory-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function command(store: JsonlMemoryPort) {
  return buildMemoryCommand({ memoryStore: store, projectRoot: root, cwd: root } as never);
}

/** Build a /memory command with a stubbed LLM provider for `compact`. */
function commandWithLlm(store: JsonlMemoryPort, opsJson: unknown) {
  const provider = {
    async complete() {
      return { content: [{ type: 'text', text: JSON.stringify(opsJson) }] };
    },
  };
  return buildMemoryCommand({
    memoryStore: store,
    projectRoot: root,
    cwd: root,
    llmProvider: provider,
    llmModel: 'test-model',
  } as never);
}

describe('/memory Super Memory commands', () => {
  it('searches, traverses graph, verifies, runs hygiene, and reports stats', async () => {
    await fs.writeFile(path.join(root, 'source.ts'), 'export const stableSymbol = true;\n');
    const store = new JsonlMemoryPort({ projectRoot: root });
    const memory = await store.rememberSuper({
      text: 'stableSymbol is part of the public contract.',
      kind: 'decision',
      importance: 0.95,
      anchors: [{ type: 'symbol', path: 'source.ts', symbol: 'stableSymbol' }],
    });
    const cmd = command(store);

    expect((await cmd.run('search stableSymbol'))?.message).toContain(memory.id);
    expect((await cmd.run('graph source.ts'))?.message).toContain('about_symbol');
    expect((await cmd.run(`verify ${memory.id}`))?.message).toContain('verified: 1');
    expect((await cmd.run('hygiene'))?.message).toContain('Super Memory Hygiene');
    // Memory→symbol, symbol→file, and file→project-root directory.
    expect((await cmd.run('stats'))?.message).toContain('Graph edges: 3');
  });

  it('remembers with structured flags, then updates and deletes by id', async () => {
    const store = new JsonlMemoryPort({ projectRoot: root });
    const cmd = command(store);

    // remember with full structured args
    const remembered = await cmd.run(
      'remember Project uses pnpm v9 --kind convention --tag pnpm,build --importance 0.9',
    );
    expect(remembered?.message).toContain('[convention]');
    expect(remembered?.message).toContain('#pnpm');

    const listed = await store.listSuper();
    expect(listed).toHaveLength(1);
    const created = listed[0]!;
    expect(created.kind).toBe('convention');
    expect(created.tags).toEqual(expect.arrayContaining(['pnpm', 'build']));
    expect(created.importance).toBeCloseTo(0.9, 5);

    // update status + text by id
    const updated = await cmd.run(
      `update ${created.id} --status stale --text Project pins pnpm v9`,
    );
    expect(updated?.message).toContain('stale');
    const afterUpdate = await store.getSuperMemory(created.id);
    expect(afterUpdate?.status).toBe('stale');
    expect(afterUpdate?.text).toBe('Project pins pnpm v9');

    // delete by id
    const deleted = await cmd.run(`delete ${created.id} no longer relevant`);
    expect(deleted?.message).toContain('Deleted');
    const afterDelete = await store.getSuperMemory(created.id);
    expect(afterDelete?.status).toBe('deleted');
  });

  it('rejects an invalid --kind with a helpful message', async () => {
    const store = new JsonlMemoryPort({ projectRoot: root });
    const cmd = command(store);
    const out = await cmd.run('remember something --kind bogus');
    expect(out?.message).toContain('--kind must be one of');
    expect(await store.listSuper()).toHaveLength(0);
  });

  it('compact operates on real super ids (merge + delete), not the broken legacy parse', async () => {
    const store = new JsonlMemoryPort({ projectRoot: root });
    const a = await store.rememberSuper({
      text: 'Project uses pnpm workspaces.',
      kind: 'convention',
    });
    const b = await store.rememberSuper({ text: 'pnpm is the package manager.', kind: 'fact' });
    const c = await store.rememberSuper({ text: 'Temporary debug note.', kind: 'fact' });

    const cmd = commandWithLlm(store, {
      operations: [
        {
          action: 'merge',
          targets: [a.id, b.id],
          newText: 'Project uses pnpm workspaces as its package manager.',
          reason: 'dupes',
        },
        { action: 'delete', targets: [c.id], reason: 'obsolete' },
      ],
      summary: '3 → 1',
    });

    const out = await cmd.run('compact');
    expect(out?.message).toContain('Memory Compact');

    const active = await store.listSuper(['active']);
    // Keeper (a) survives with merged text; b and c are gone.
    expect(active.map((m) => m.id).sort()).toEqual([a.id]);
    const keeper = await store.getSuperMemory(a.id);
    expect(keeper?.text).toBe('Project uses pnpm workspaces as its package manager.');
    expect((await store.getSuperMemory(b.id))?.status).toBe('deleted');
    expect((await store.getSuperMemory(c.id))?.status).toBe('deleted');
  });

  it('lists and resolves candidates', async () => {
    const store = new JsonlMemoryPort({ projectRoot: root });
    const candidate = await store.createCandidate({ text: 'Candidate invariant.' });
    const cmd = command(store);
    expect((await cmd.run('candidates'))?.message).toContain(candidate.id);
    expect((await cmd.run(`candidates accept ${candidate.id}`))?.message).toContain('Accepted');
    expect((await cmd.run('candidates'))?.message).toContain('No memory candidates');
  });

  describe('/memory audience', () => {
    it('remembers, lists, searches, and clears audience-scoped memories', async () => {
      const store = new JsonlMemoryPort({ projectRoot: root });
      const cmd = command(store);

      await store.rememberSuper({
        text: 'Check for reversible rollback SQL.',
        audience: { roles: ['reviewer'] },
      });
      const refactor = await store.rememberSuper({
        text: 'Preserve public API signatures.',
        audience: { roles: ['refactor-planner'], taskTypes: ['refactor'] },
      });
      await store.rememberSuper({
        text: 'General project note without scope.',
      });

      // list all scoped
      const listed = await cmd.run('audience list');
      expect(listed?.message).toContain('Check for reversible rollback SQL.');
      expect(listed?.message).toContain('Preserve public API signatures.');
      expect(listed?.message).not.toContain('General project note');

      // list filtered by role
      const reviewerList = await cmd.run('audience list --role reviewer');
      expect(reviewerList?.message).toContain('rollback SQL');
      expect(reviewerList?.message).not.toContain('Preserve public API');

      // search by role name
      const searchRole = await cmd.run('audience search refactor-planner');
      expect(searchRole?.message).toContain(refactor.id);

      // search by text content
      const searchText = await cmd.run('audience search rollback');
      expect(searchText?.message).toContain('Check for reversible rollback SQL.');

      // search with no match
      const searchMiss = await cmd.run('audience search nonexistent');
      expect(searchMiss?.message).toContain('No audience-scoped memories match');

      // clear scope
      const cleared = await cmd.run(`audience clear ${refactor.id}`);
      expect(cleared?.message).toContain('Cleared audience scope');
      const afterClear = await store.getSuperMemory(refactor.id);
      expect(afterClear?.audience).toBeUndefined();
    });

    it('remember requires at least one selector', async () => {
      const store = new JsonlMemoryPort({ projectRoot: root });
      const cmd = command(store);
      const out = await cmd.run('audience remember some text');
      expect(out?.message).toContain('At least one of --role');
    });
  });
});
