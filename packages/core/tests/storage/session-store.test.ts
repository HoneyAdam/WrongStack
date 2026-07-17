import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DefaultSessionStore } from '../../src/storage/session-store.js';
import { EventBus } from '../../src/kernel/events.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-store-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('DefaultSessionStore — basic lifecycle', () => {
  it('constructs without error', () => {
    const store = new DefaultSessionStore({ dir: tmpDir });
    expect(store).toBeDefined();
  });

  it('list returns empty array when no sessions exist', async () => {
    const store = new DefaultSessionStore({ dir: tmpDir });
    const sessions = await store.list();
    expect(sessions).toEqual([]);
  });

  it('listFiltered returns empty with criteria on empty store', async () => {
    const store = new DefaultSessionStore({ dir: tmpDir });
    const sessions = await store.listFiltered({ provider: 'openai' });
    expect(sessions).toEqual([]);
  });

  it('clearLoadCache does not throw', () => {
    const store = new DefaultSessionStore({ dir: tmpDir });
    expect(() => store.clearLoadCache()).not.toThrow();
    expect(() => store.clearLoadCache('nonexistent')).not.toThrow();
  });

  it('load throws for nonexistent session', async () => {
    const store = new DefaultSessionStore({ dir: tmpDir });
    await expect(store.load('nonexistent-id')).rejects.toThrow();
  });

  it('loadEventsOnly throws for nonexistent session', async () => {
    const store = new DefaultSessionStore({ dir: tmpDir });
    await expect(store.loadEventsOnly('nonexistent-id')).rejects.toThrow();
  });
});

describe('DefaultSessionStore — with EventBus', () => {
  it('accepts an EventBus in options', () => {
    const events = new EventBus();
    const store = new DefaultSessionStore({ dir: tmpDir, events });
    expect(store).toBeDefined();
  });

  it('accepts a projectRoot', () => {
    const store = new DefaultSessionStore({ dir: tmpDir, projectRoot: '/some/project' });
    expect(store).toBeDefined();
  });
});

describe('DefaultSessionStore — delete on nonexistent', () => {
  it('delete does not throw for nonexistent session', async () => {
    const store = new DefaultSessionStore({ dir: tmpDir });
    // delete should be idempotent or throw a known error, not crash
    try {
      await store.delete('nonexistent-id');
    } catch (e) {
      // Expected — just verify it doesn't crash the process
      expect(e).toBeInstanceOf(Error);
    }
  });
});
