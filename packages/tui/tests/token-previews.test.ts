import { describe, expect, it } from 'vitest';
import {
  TOKEN_PREVIEWS_MAX_CHARS,
  TOKEN_PREVIEWS_MAX_ENTRIES,
  TokenPreviewStore,
} from '../src/token-previews.js';

describe('TokenPreviewStore', () => {
  it('stores and retrieves previews like a Map', () => {
    const store = new TokenPreviewStore();
    store.set('[pasted #1]', 'hello world');
    expect(store.get('[pasted #1]')).toBe('hello world');
    expect(store.has('[pasted #1]')).toBe(true);
    expect(store.size).toBe(1);
    expect(store.chars).toBe('hello world'.length);
    expect(store.get('[missing]')).toBeUndefined();
  });

  it('replaces an existing token without double-counting chars', () => {
    const store = new TokenPreviewStore();
    store.set('[t]', 'aaaa');
    store.set('[t]', 'bb');
    expect(store.get('[t]')).toBe('bb');
    expect(store.size).toBe(1);
    expect(store.chars).toBe(2);
  });

  it('delete() and clear() release memory', () => {
    const store = new TokenPreviewStore();
    store.set('[a]', 'aaaa');
    store.set('[b]', 'bb');
    expect(store.delete('[a]')).toBe(true);
    expect(store.delete('[a]')).toBe(false);
    expect(store.chars).toBe(2);
    store.clear();
    expect(store.size).toBe(0);
    expect(store.chars).toBe(0);
  });

  it('evicts oldest entries when the entry budget is exceeded', () => {
    const store = new TokenPreviewStore({ maxEntries: 3 });
    store.set('[1]', 'a');
    store.set('[2]', 'b');
    store.set('[3]', 'c');
    store.set('[4]', 'd');
    expect(store.size).toBe(3);
    expect(store.has('[1]')).toBe(false);
    expect(store.keysOldestFirst()).toEqual(['[2]', '[3]', '[4]']);
  });

  it('evicts oldest entries when the char budget is exceeded', () => {
    const store = new TokenPreviewStore({ maxChars: 10 });
    store.set('[1]', 'aaaa'); // 4
    store.set('[2]', 'bbbb'); // 8 total
    store.set('[3]', 'cccc'); // 12 → evict [1] → 8
    expect(store.has('[1]')).toBe(false);
    expect(store.chars).toBe(8);
    expect(store.keysOldestFirst()).toEqual(['[2]', '[3]']);
  });

  it('always keeps the newest entry even when it alone exceeds the budget', () => {
    const store = new TokenPreviewStore({ maxChars: 5 });
    store.set('[small]', 'abc');
    store.set('[huge]', 'x'.repeat(100));
    expect(store.size).toBe(1);
    expect(store.get('[huge]')).toBe('x'.repeat(100));
  });

  it('get() refreshes LRU recency so recently-read entries survive eviction', () => {
    const store = new TokenPreviewStore({ maxEntries: 3 });
    store.set('[1]', 'a');
    store.set('[2]', 'b');
    store.set('[3]', 'c');
    // Read [1] — it becomes the most-recently-used entry.
    expect(store.get('[1]')).toBe('a');
    store.set('[4]', 'd');
    // [2] is now the oldest and must be evicted, not [1].
    expect(store.has('[1]')).toBe(true);
    expect(store.has('[2]')).toBe(false);
    expect(store.keysOldestFirst()).toEqual(['[3]', '[1]', '[4]']);
  });

  it('stays within default budgets under a heavy attachment workload', () => {
    const store = new TokenPreviewStore();
    // Simulate a long session: many max-size pastes (50K chars each).
    const paste = 'x'.repeat(50_000);
    for (let i = 0; i < 100; i++) {
      store.set(`[pasted #${i}]`, paste);
    }
    expect(store.size).toBeLessThanOrEqual(TOKEN_PREVIEWS_MAX_ENTRIES);
    expect(store.chars).toBeLessThanOrEqual(TOKEN_PREVIEWS_MAX_CHARS);
    // Newest paste still resolves for slash commands.
    expect(store.get('[pasted #99]')).toBe(paste);
  });

  it('clamps pathological budgets to at least one entry / one char', () => {
    const store = new TokenPreviewStore({ maxEntries: 0, maxChars: 0 });
    store.set('[a]', 'a');
    store.set('[b]', 'b');
    expect(store.size).toBe(1);
    expect(store.get('[b]')).toBe('b');
  });
});
