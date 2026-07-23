import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteSageStore } from '../src/sqlite-store.js';

describe('SqliteSageStore v3 migration', () => {
  let tempDir: string;
  let store: SqliteSageStore | undefined;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wrongstack-sqlite-v3-'));
  });

  afterEach(async () => {
    store?.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('opens a v2 database before creating indexes that require v3 columns', async () => {
    const memoryDir = path.join(tempDir, '.wrongstack', 'memories');
    const dbPath = path.join(memoryDir, 'sage.db');
    await fs.promises.mkdir(memoryDir, { recursive: true });

    const v2 = new DatabaseSync(dbPath);
    v2.exec(`
      CREATE TABLE schema_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      INSERT INTO schema_meta (key, value) VALUES ('version', 2);

      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    v2.close();

    store = new SqliteSageStore({ projectRoot: tempDir });
    await expect(store.initialize()).resolves.toBeUndefined();

    const migrated = new DatabaseSync(dbPath, { readOnly: true });
    const candidateColumns = migrated.prepare('PRAGMA table_info(candidates)').all() as Array<{
      name: string;
    }>;
    const candidateIndexes = migrated.prepare('PRAGMA index_list(candidates)').all() as Array<{
      name: string;
    }>;
    const version = migrated
      .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
      .get() as { value: number };
    migrated.close();

    expect(candidateColumns.map((column) => column.name)).toContain('canonical_text');
    expect(candidateIndexes.map((index) => index.name)).toContain(
      'idx_candidates_status_canonical',
    );
    expect(version.value).toBe(3);
  });
});
