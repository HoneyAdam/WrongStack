import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ToolRegistry } from '@wrongstack/core/registry';
import { isSqliteAvailable, SqliteMemoryPort } from '@wrongstack/super-memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerCanonicalHostTools } from '../src/tool-registration.js';

let tempDir: string;
let store: SqliteMemoryPort;

beforeEach(async () => {
  if (!isSqliteAvailable()) {
    throw new Error('node:sqlite is required for this test (Node >= 22.5).');
  }
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wrongstack-runtime-sqlite-'));
  store = new SqliteMemoryPort({ projectRoot: tempDir });
  await store.initialize();
});

afterEach(async () => {
  try {
    store.close();
  } catch {
    // already closed
  }
  await new Promise((r) => setTimeout(r, 10));
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

describe('registerCanonicalHostTools with real SqliteMemoryPort', () => {
  it('registers and executes the Super Memory remember tool end-to-end', async () => {
    const registry = new ToolRegistry();
    const result = registerCanonicalHostTools({
      registry,
      tier: 'minimal',
      memory: { enabled: true, store },
    });

    // The SQLite store now satisfies the full MemoryStore contract via the
    // compatibility adapter, so the safe legacy guard should register the
    // legacy `remember` tool (no SuperMemoryServiceLike claim).
    expect(result.memoryBackend).toBe('legacy');
    const rememberTool = registry.get('remember');
    expect(rememberTool).toBeDefined();
    expect(rememberTool?.inputSchema.properties).toHaveProperty('type');

    const executed = await rememberTool?.execute(
      {
        text: 'Always verify migration reversibility.',
        type: 'convention',
        scope: 'project-memory',
        priority: 'high',
      } as never,
      {} as never,
      { signal: new AbortController().signal } as never,
    );

    expect(executed).toEqual({ ok: true, scope: 'project-memory' });

    // Round-trip through the legacy MemoryStore surface to prove the
    // adapter wrote the row that `remember()` would have written.
    const list = await store.list('project-memory');
    expect(list.map((entry) => entry.text)).toContain('Always verify migration reversibility.');
    expect(list.find((entry) => entry.text.startsWith('Always verify'))?.type).toBe('convention');

    // The original failure mode (TypeError) cannot recur because the
    // contract adapter routes the call into rememberSuper.
  });
});
