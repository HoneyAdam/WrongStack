import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { DefaultMemoryStore } from '../../src/defaults/memory-store.js';
import { resolveWstackPaths } from '../../src/utils/wstack-paths.js';

describe('DefaultMemoryStore', () => {
  let projectRoot: string;
  let userHome: string;
  let store: DefaultMemoryStore;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-mem-proj-'));
    userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-mem-home-'));
    const paths = resolveWstackPaths({ projectRoot, userHome });
    store = new DefaultMemoryStore({ paths });
  });
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(userHome, { recursive: true, force: true });
  });

  it('remember appends with timestamp', async () => {
    await store.remember('use pnpm');
    const content = await store.read('project-memory');
    expect(content).toContain('use pnpm');
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}/);
  });

  it('readAll concatenates all scopes', async () => {
    await store.remember('proj note', 'project-memory');
    await store.remember('user note', 'user-memory');
    const all = await store.readAll();
    expect(all).toContain('proj note');
    expect(all).toContain('user note');
  });

  it('forget removes matching lines', async () => {
    await store.remember('keep this');
    await store.remember('remove this');
    const removed = await store.forget('remove');
    expect(removed).toBe(1);
    const remaining = await store.read('project-memory');
    expect(remaining).toContain('keep this');
    expect(remaining).not.toContain('remove this');
  });

  it('forget on empty file returns 0', async () => {
    expect(await store.forget('nothing')).toBe(0);
  });

  it('writes project-memory under user home, not project tree', async () => {
    await store.remember('test note');
    const projFiles = await fs.readdir(path.join(projectRoot, '.wrongstack')).catch(() => []);
    expect(projFiles).not.toContain('memory.md');
  });

  it('consolidate dedupes identical bullet entries (ignoring timestamps)', async () => {
    await store.remember('prefer pnpm');
    await new Promise((r) => setTimeout(r, 2));
    await store.remember('prefer pnpm');
    await new Promise((r) => setTimeout(r, 2));
    await store.remember('use biome');
    await store.consolidate('project-memory');
    const content = await store.read('project-memory');
    const pnpmHits = content.match(/prefer pnpm/g) ?? [];
    expect(pnpmHits.length).toBe(1);
    expect(content).toContain('use biome');
  });

  it('consolidate is a no-op on missing file', async () => {
    await expect(store.consolidate('user-memory')).resolves.toBeUndefined();
  });

  it('readAll returns empty string when no memory exists', async () => {
    const all = await store.readAll();
    expect(all).toBe('');
  });

  it('read on missing file returns empty string', async () => {
    expect(await store.read('user-memory')).toBe('');
  });

  it('honours project-agents scope (writes to project tree)', async () => {
    await store.remember('built with pnpm', 'project-agents');
    const agentsFile = path.join(projectRoot, '.wrongstack', 'AGENTS.md');
    const content = await fs.readFile(agentsFile, 'utf8');
    expect(content).toContain('built with pnpm');
  });
});
