import { describe, expect, it } from 'vitest';
import { hammingDistance64, simhash64 } from '../src/store.js';

describe('simhash64', () => {
  it('returns 0n for empty string', () => {
    expect(simhash64('')).toBe(0n);
  });

  it('returns 0n for strings with only short tokens (<3 chars)', () => {
    // Tokenizer drops tokens shorter than 3 characters, so "a b c" produces
    // an empty token set.
    expect(simhash64('a b c')).toBe(0n);
  });

  it('returns the same fingerprint for the same input (deterministic)', () => {
    const text = 'Configure C++ build flags using clang++ for performance.';
    expect(simhash64(text)).toBe(simhash64(text));
  });

  it('is case-insensitive (NFKC + lowercase in canonical form)', () => {
    const a = simhash64('Configure C++ Build Flags');
    const b = simhash64('configure c++ build flags');
    expect(a).toBe(b);
  });

  it('strips trailing sentence punctuation but preserves internal punctuation', () => {
    // Trailing "!" is stripped, but "C++" and "C#" internal punctuation is preserved.
    const withPunct = simhash64('Use TypeScript with strict mode.');
    const withoutPunct = simhash64('Use TypeScript with strict mode');
    expect(withPunct).toBe(withoutPunct);
  });

  it('distinguishes texts with different internal punctuation', () => {
    // "C++" and "C#" canonicalize differently (internal punctuation is
    // preserved), so their SimHashes should differ.
    const a = simhash64('Configure C++ build flags');
    const b = simhash64('Configure C# build flags');
    expect(a).not.toBe(b);
  });

  it('produces similar (low Hamming distance) hashes for semantically similar texts', () => {
    // Two near-duplicates that share most tokens. They should produce
    // SimHashes within a small Hamming distance.
    const a = simhash64('Configure C++ build flags using clang++ for performance.');
    const b = simhash64('Configure C++ build flags using clang++ for optimal performance.');
    const dist = hammingDistance64(a, b);
    expect(dist).toBeLessThanOrEqual(10); // Near-duplicate threshold
  });

  it('produces dissimilar (high Hamming distance) hashes for unrelated texts', () => {
    const a = simhash64('Configure C++ build flags using clang++ for performance.');
    const b = simhash64('Schedule a team retrospective for the engineering org.');
    const dist = hammingDistance64(a, b);
    expect(dist).toBeGreaterThan(10); // Should be far apart
  });

  it('returns a 64-bit bigint fingerprint', () => {
    const hash = simhash64('Some text with enough tokens to produce a hash.');
    expect(typeof hash).toBe('bigint');
    expect(hash).toBeGreaterThanOrEqual(0n);
    // Top bit should be 0 or 1 (64-bit range)
    expect(hash).toBeLessThan(1n << 64n);
  });
});

describe('hammingDistance64', () => {
  it('returns 0 for identical fingerprints', () => {
    const hash = simhash64('Some text with enough tokens to produce a hash.');
    expect(hammingDistance64(hash, hash)).toBe(0);
  });

  it('returns the number of differing bits', () => {
    const a = 0b1010n;
    const b = 0b1101n;
    // XOR = 0b0111 — bits 0, 1, 2 differ
    expect(hammingDistance64(a, b)).toBe(3);
  });

  it('returns 1 for a single-bit difference', () => {
    const a = 0b1000n;
    const b = 0b1001n;
    expect(hammingDistance64(a, b)).toBe(1);
  });

  it('returns 64 for maximally different fingerprints', () => {
    const a = 0n;
    const b = (1n << 64n) - 1n; // all 64 bits set
    expect(hammingDistance64(a, b)).toBe(64);
  });

  it('is symmetric: hamming(a, b) === hamming(b, a)', () => {
    const a = simhash64('Configure C++ build flags');
    const b = simhash64('Schedule a team retrospective');
    expect(hammingDistance64(a, b)).toBe(hammingDistance64(b, a));
  });
});