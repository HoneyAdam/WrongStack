import { describe, expect, it } from 'vitest';
import { LruCache } from '../../src/utils/lru-cache.js';

/**
 * P3 #17 (before-release.md): the permission-policy eval cache was a plain
 * Map with no eviction. These tests pin the LruCache wrapper that caps the
 * size at a configurable maximum while preserving get/set/clear/has semantics.
 */
describe('LruCache — minimal LRU eviction (P3 #17)', () => {
  it('stores and retrieves values', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  it('reports size and has()', () => {
    const cache = new LruCache<string, number>(10);
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('evicts the least-recently-used entry when capacity is exceeded', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    // Inserting 'c' exceeds capacity → 'a' (oldest) is evicted.
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('reading an entry makes it most-recently-used (not evicted next)', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Read 'a' → it is now more recent than 'b'.
    expect(cache.get('a')).toBe(1);
    // Insert 'c' → 'b' (now the oldest) is evicted, 'a' survives.
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('updating an existing key refreshes its recency', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Update 'a' → it becomes most-recently-used.
    cache.set('a', 10);
    // Insert 'c' → 'b' (oldest) is evicted.
    cache.set('c', 3);
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('clear() empties the cache', () => {
    const cache = new LruCache<string, number>(10);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.has('a')).toBe(false);
  });

  it('rejects capacity < 1', () => {
    expect(() => new LruCache<string, number>(0)).toThrow();
    expect(() => new LruCache<string, number>(-1)).toThrow();
  });

  it('handles capacity of 1 (always evicts the previous entry)', () => {
    const cache = new LruCache<string, number>(1);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    cache.set('b', 2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('does not grow beyond capacity under heavy churn', () => {
    const capacity = 50;
    const cache = new LruCache<number, string>(capacity);
    for (let i = 0; i < 1000; i++) {
      cache.set(i, `val-${i}`);
    }
    expect(cache.size).toBe(capacity);
    // The most recent `capacity` entries survive.
    for (let i = 950; i < 1000; i++) {
      expect(cache.get(i)).toBe(`val-${i}`);
    }
    // Older entries were evicted.
    expect(cache.get(0)).toBeUndefined();
    expect(cache.get(100)).toBeUndefined();
  });
});
