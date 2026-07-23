import { describe, expect, it } from 'vitest';
import { DefaultAttachmentStore } from '@wrongstack/core/storage';
import {
  TOKEN_PREVIEW_MAX_CHARS,
  TOKEN_PREVIEW_MAX_LINES,
  TOKEN_PREVIEWS_MAX_CHARS,
  TOKEN_PREVIEWS_MAX_ENTRIES,
  TokenPreviewStore,
  createTokenPreview,
  resolveAttachmentTokens,
} from '../src/token-previews.js';

describe('createTokenPreview', () => {
  it('keeps content at the exact per-preview character boundary', () => {
    const value = 'x'.repeat(TOKEN_PREVIEW_MAX_CHARS);
    expect(createTokenPreview(value)).toBe(value);
  });

  it('hard-caps oversized values and appends a truncation marker', () => {
    const preview = createTokenPreview('x'.repeat(TOKEN_PREVIEW_MAX_CHARS + 1));
    expect(preview.length).toBe(TOKEN_PREVIEW_MAX_CHARS);
    expect(preview).toContain('preview truncated');
  });

  it('keeps only the first six lines plus a truncation marker', () => {
    const preview = createTokenPreview('one\ntwo\nthree\nfour\nfive\nsix\nseven');
    expect(preview.split('\n').slice(0, TOKEN_PREVIEW_MAX_LINES)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
    ]);
    expect(preview).not.toContain('seven');
    expect(preview).toContain('preview truncated');
  });
});

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

  it('evicts oldest entries when the aggregate character budget is exceeded', () => {
    const store = new TokenPreviewStore({ maxChars: 10, maxPreviewChars: 10 });
    store.set('[1]', 'aaaa');
    store.set('[2]', 'bbbb');
    store.set('[3]', 'cccc');
    expect(store.has('[1]')).toBe(false);
    expect(store.chars).toBe(8);
    expect(store.keysOldestFirst()).toEqual(['[2]', '[3]']);
  });

  it('never exempts an oversized newest item from the aggregate budget', () => {
    const store = new TokenPreviewStore({ maxChars: 5, maxPreviewChars: 100 });
    store.set('[huge]', 'x'.repeat(100));
    expect(store.size).toBe(1);
    expect(store.chars).toBe(5);
    expect(store.get('[huge]')).toHaveLength(5);
  });

  it('get() refreshes LRU recency so recently-read entries survive eviction', () => {
    const store = new TokenPreviewStore({ maxEntries: 3 });
    store.set('[1]', 'a');
    store.set('[2]', 'b');
    store.set('[3]', 'c');
    expect(store.get('[1]')).toBe('a');
    store.set('[4]', 'd');
    expect(store.has('[1]')).toBe(true);
    expect(store.has('[2]')).toBe(false);
    expect(store.keysOldestFirst()).toEqual(['[3]', '[1]', '[4]']);
  });

  it('stays within all default budgets under a heavy attachment workload', () => {
    const store = new TokenPreviewStore();
    const attachment = 'x'.repeat(50_000);
    for (let i = 0; i < 100; i++) store.set(`[pasted #${i}]`, attachment);
    expect(store.size).toBeLessThanOrEqual(TOKEN_PREVIEWS_MAX_ENTRIES);
    expect(store.chars).toBeLessThanOrEqual(TOKEN_PREVIEWS_MAX_CHARS);
    expect(store.get('[pasted #99]')?.length).toBeLessThanOrEqual(TOKEN_PREVIEW_MAX_CHARS);
    expect(store.get('[pasted #99]')).not.toBe(attachment);
  });

  it('clamps pathological budgets to at least one entry and one char', () => {
    const store = new TokenPreviewStore({ maxEntries: 0, maxChars: 0 });
    store.set('[a]', 'a');
    store.set('[b]', 'b');
    expect(store.size).toBe(1);
    expect(store.get('[b]')).toBe('b');
  });
});

describe('resolveAttachmentTokens', () => {
  it('resolves full canonical content even when the retained preview is truncated', async () => {
    const attachments = new DefaultAttachmentStore();
    const full = 'line\n'.repeat(2_000);
    const ref = await attachments.add({ kind: 'text', data: full });
    const token = `[pasted #${ref.seq}, 2001 lines]`;
    const previews = new TokenPreviewStore();
    previews.set(token, full);

    expect(previews.get(token)?.length).toBeLessThan(full.length);
    const resolved = await resolveAttachmentTokens(`/fix ${token}`, attachments);
    expect(resolved).toBe(`/fix ${full}`);
    expect(resolved).not.toContain(token);
  });

  it('leaves image tokens intact because text dispatch cannot carry image blocks', async () => {
    const attachments = new DefaultAttachmentStore();
    const ref = await attachments.add({
      kind: 'image',
      data: 'AAAA',
      meta: { mediaType: 'image/png' },
    });
    const token = `[image #${ref.seq}, PNG]`;
    expect(await resolveAttachmentTokens(`/fix ${token}`, attachments)).toBe(`/fix ${token}`);
  });
});
