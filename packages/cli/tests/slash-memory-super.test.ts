import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '@wrongstack/super-memory';
import { buildMemoryCommand } from '../src/slash-commands/memory.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-slash-memory-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function command(store: SuperMemoryStore) {
  return buildMemoryCommand({ memoryStore: store, projectRoot: root, cwd: root } as never);
}

describe('/memory Super Memory commands', () => {
  it('searches, traverses graph, verifies, runs hygiene, and reports stats', async () => {
    await fs.writeFile(path.join(root, 'source.ts'), 'export const stableSymbol = true;\n');
    const store = new SuperMemoryStore({ projectRoot: root });
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

  it('lists and resolves candidates', async () => {
    const store = new SuperMemoryStore({ projectRoot: root });
    const candidate = await store.createCandidate({ text: 'Candidate invariant.' });
    const cmd = command(store);
    expect((await cmd.run('candidates'))?.message).toContain(candidate.id);
    expect((await cmd.run(`candidates accept ${candidate.id}`))?.message).toContain('Accepted');
    expect((await cmd.run('candidates'))?.message).toContain('No memory candidates');
  });
});
