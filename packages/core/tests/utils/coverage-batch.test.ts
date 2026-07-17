import { describe, it, expect } from 'vitest';
import { LruCache } from '../../src/utils/lru-cache.js';
import { completePartialObject } from '../../src/utils/json-repair.js';
import { isPrivateIPv4, isPrivateIPv6, expandIPv6 } from '../../src/utils/ip-guard.js';
import { unifiedDiff } from '../../src/utils/diff.js';

// ── LruCache ──────────────────────────────────────────────────────────────

describe('LruCache', () => {
  it('stores and retrieves values', () => {
    const c = new LruCache<string, number>(3);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBe(2);
    expect(c.get('missing')).toBeUndefined();
  });

  it('evicts the least-recently-used entry when capacity is reached', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    // Access 'a' so 'b' becomes LRU
    c.get('a');
    c.set('c', 3); // should evict 'b'
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
  });

  it('re-inserts on get to update recency', () => {
    const c = new LruCache<string, number>(2);
    c.set('x', 10);
    c.set('y', 20);
    c.get('x');
    c.set('z', 30); // evicts 'y' (LRU after x was accessed)
    expect(c.has('x')).toBe(true);
    expect(c.has('y')).toBe(false);
  });

  it('updating an existing key does not grow size', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 99); // update, not insert
    expect(c.size).toBe(2);
    expect(c.get('a')).toBe(99);
  });

  it('throws on capacity < 1', () => {
    expect(() => new LruCache<string, number>(0)).toThrow('capacity must be >= 1');
  });

  it('clear empties the cache', () => {
    const c = new LruCache<string, number>(5);
    c.set('a', 1);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.has('a')).toBe(false);
  });
});

// ── json-repair ────────────────────────────────────────────────────────────

describe('completePartialObject', () => {
  it('returns valid JSON unchanged', () => {
    expect(completePartialObject('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it('returns non-object input unchanged', () => {
    expect(completePartialObject('hello')).toBe('hello');
  });

  it('closes a single unclosed brace', () => {
    const result = completePartialObject('{"key":"value"');
    expect(JSON.parse(result)).toEqual({ key: 'value' });
  });

  it('closes nested unclosed braces', () => {
    const result = completePartialObject('{"outer":{"inner":"val"');
    expect(JSON.parse(result)).toEqual({ outer: { inner: 'val' } });
  });

  it('closes an unclosed string value', () => {
    const result = completePartialObject('{"key":"partial');
    expect(JSON.parse(result)).toEqual({ key: 'partial' });
  });

  it('completes a key with no value to null', () => {
    const result = completePartialObject('{"key":');
    expect(JSON.parse(result)).toEqual({ key: null });
  });

  it('completes an empty value before close brace', () => {
    const result = completePartialObject('{"key":}');
    expect(JSON.parse(result)).toEqual({ key: null });
  });

  it('handles a bare open brace gracefully', () => {
    expect(completePartialObject('{')).toBe('{');
  });

  it('handles escaped quotes inside strings', () => {
    const result = completePartialObject('{"key":"value with \\"quote');
    expect(JSON.parse(result)).toEqual({ key: 'value with "quote' });
  });
});

// ── ip-guard ───────────────────────────────────────────────────────────────

describe('isPrivateIPv4', () => {
  it('blocks loopback', () => {
    expect(isPrivateIPv4('127.0.0.1')).toBe(true);
  });
  it('blocks private ranges', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true);
    expect(isPrivateIPv4('172.16.0.1')).toBe(true);
    expect(isPrivateIPv4('192.168.1.1')).toBe(true);
  });
  it('blocks link-local (169.254)', () => {
    expect(isPrivateIPv4('169.254.169.254')).toBe(true);
  });
  it('blocks CGNAT (100.64.0.0/10)', () => {
    expect(isPrivateIPv4('100.64.0.1')).toBe(true);
  });
  it('blocks multicast and reserved', () => {
    expect(isPrivateIPv4('224.0.0.1')).toBe(true);
    expect(isPrivateIPv4('240.0.0.1')).toBe(true);
  });
  it('allows public addresses', () => {
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('1.1.1.1')).toBe(false);
    expect(isPrivateIPv4('203.0.113.1')).toBe(false);
  });
  it('blocks malformed input', () => {
    expect(isPrivateIPv4('not-an-ip')).toBe(true);
    expect(isPrivateIPv4('999.999.999.999')).toBe(true);
  });
});

describe('isPrivateIPv6', () => {
  it('blocks loopback', () => {
    expect(isPrivateIPv6('::1')).toBe(true);
  });
  it('blocks unspecified', () => {
    expect(isPrivateIPv6('::')).toBe(true);
  });
  it('blocks unique local (fc00::/7)', () => {
    expect(isPrivateIPv6('fc00::1')).toBe(true);
    expect(isPrivateIPv6('fd00::1')).toBe(true);
  });
  it('blocks link-local (fe80::/10)', () => {
    expect(isPrivateIPv6('fe80::1')).toBe(true);
  });
  it('allows public addresses', () => {
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false);
  });
  it('blocks IPv4-mapped private', () => {
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true);
  });
  it('blocks IPv4-mapped public (dotted-quad form not parsed — defensive block)', () => {
    // expandIPv6 cannot parse the dotted-quad suffix in ::ffff:8.8.8.8,
    // so it returns null → isPrivateIPv6 defensively returns true.
    // This is a known limitation: only the hex form (::ffff:0808:0808) is
    // correctly expanded. The defensive block is safe (over-block > leak).
    expect(isPrivateIPv6('::ffff:8.8.8.8')).toBe(true);
    // Hex form works correctly:
    expect(isPrivateIPv6('::ffff:0808:0808')).toBe(false);
  });
});

describe('expandIPv6', () => {
  it('expands a full address', () => {
    expect(expandIPv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toHaveLength(8);
  });
  it('expands :: compression', () => {
    const groups = expandIPv6('2001:db8::1');
    expect(groups).toHaveLength(8);
    expect(groups?.[0]).toBe(0x2001);
    expect(groups?.[7]).toBe(1);
  });
  it('returns null for malformed input', () => {
    expect(expandIPv6(':::')).toBeNull();
    expect(expandIPv6('gggg::1')).toBeNull();
  });
});

// ── diff ───────────────────────────────────────────────────────────────────

describe('unifiedDiff', () => {
  it('returns empty string for identical text', () => {
    expect(unifiedDiff('hello\nworld', 'hello\nworld')).toBe('');
  });

  it('produces a diff for changed text', () => {
    const result = unifiedDiff('line1\nline2\nline3', 'line1\nchanged\nline3');
    expect(result).toContain('--- a');
    expect(result).toContain('+++ b');
    expect(result).toContain('-line2');
    expect(result).toContain('+changed');
    expect(result).toContain('@@');
  });

  it('uses custom file names', () => {
    const result = unifiedDiff('a', 'b', { fromFile: 'old.txt', toFile: 'new.txt' });
    expect(result).toContain('--- old.txt');
    expect(result).toContain('+++ new.txt');
  });

  it('handles pure insertion', () => {
    const result = unifiedDiff('line1', 'line1\nline2');
    expect(result).toContain('+line2');
  });

  it('handles pure deletion', () => {
    const result = unifiedDiff('line1\nline2', 'line1');
    expect(result).toContain('-line2');
  });

  it('handles empty input', () => {
    expect(unifiedDiff('', '')).toBe('');
    const result = unifiedDiff('', 'new');
    expect(result).toContain('+new');
  });
});
