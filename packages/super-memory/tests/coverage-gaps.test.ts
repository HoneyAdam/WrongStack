import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cosineSimilarity } from '../src/embeddings/provider.js';
import { HashingEmbeddingProvider } from '../src/embeddings/hashing.js';
import { InjectionTracker } from '../src/middleware/injection-tracker.js';
import { SuperMemoryGraph } from '../src/graph/graph.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MemoryGraphEdge } from '../src/types.js';
import {
  normalizeText,
  tokenize,
  normalizeTags,
  normalizeAudience,
  normalizeSources,
  validateRememberInput,
} from '../src/store-helpers.js';

// ── cosineSimilarity ───────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity(new Float32Array([1, 1]), new Float32Array([-1, -1]))).toBeCloseTo(-1, 5);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 2]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([0, 0]))).toBe(0);
  });

  it('computes partial similarity', () => {
    const a = new Float32Array([1, 1, 0]);
    const b = new Float32Array([1, 0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 5);
  });
});

// ── InjectionTracker — eviction + TTL ──────────────────────────────────

describe('InjectionTracker eviction and TTL', () => {
  it('bounds per-session context snapshots', () => {
    const tracker = new InjectionTracker({ maxEntries: 2, ttlMs: 60_000 });
    tracker.snapshotContext('', 's1', 1_000);
    tracker.snapshotContext('', 's2', 1_001);
    tracker.snapshotContext('', 's3', 1_002);
    expect((tracker as any).activeContextBySession.size).toBe(2);
  });

  it('evicts the oldest entries when maxEntries is exceeded', () => {
    const now = Date.now();
    const tracker = new InjectionTracker({ maxEntries: 2, ttlMs: 60_000, minTokens: 1 });
    tracker.record('m1', 'first memory text here', now);
    tracker.record('m2', 'second memory text here', now);
    tracker.record('m3', 'third memory text here', now);
    // m1 evicted (oldest), m2 and m3 remain
    expect(tracker.size).toBe(2);
    // m1 no longer matchable
    expect(tracker.consumeMatches('first memory text here', now)).not.toContain('m1');
  });

  it('prunes expired entries by TTL', () => {
    const now = Date.now();
    const tracker = new InjectionTracker({ ttlMs: 1000, minTokens: 1 });
    tracker.record('m1', 'some long enough text', now);
    // Still alive — just recorded
    expect(tracker.size).toBe(1);
    // Record an old entry directly by manipulating time via a fresh tracker
    const oldTracker = new InjectionTracker({ ttlMs: 1000, minTokens: 1 });
    oldTracker.record('m2', 'some long enough text', now - 2000);
    // The old entry is past TTL — size should prune it
    expect(oldTracker.size).toBe(0);
  });

  it('skips memories below minTokens', () => {
    const tracker = new InjectionTracker({ minTokens: 5 });
    tracker.record('m1', 'short');
    expect(tracker.size).toBe(0);
  });

  it('returns [] when no entries exist', () => {
    const tracker = new InjectionTracker();
    expect(tracker.consumeMatches('any text here')).toEqual([]);
  });

  it('returns [] when assistantText normalizes to empty', () => {
    const tracker = new InjectionTracker({ minTokens: 1 });
    tracker.record('m1', 'some memory text here');
    expect(tracker.consumeMatches('   ')).toEqual([]);
  });

  it('consumes matches so each injection counts once', () => {
    const tracker = new InjectionTracker({ minTokens: 1, matchThreshold: 0.1 });
    tracker.record('m1', 'the quick brown fox jumps over the lazy dog');
    tracker.record('m2', 'a completely different topic about space');
    const first = tracker.consumeMatches('the quick brown fox jumps over the lazy dog');
    expect(first).toContain('m1');
    // Second call: m1 is consumed, no match
    const second = tracker.consumeMatches('the quick brown fox jumps over the lazy dog');
    expect(second).not.toContain('m1');
  });
});

// ── SuperMemoryGraph — removeNodeEdges, removeEdge, traverse ───────────

describe('SuperMemoryGraph edge removal and traversal', () => {
  let tmpDir: string;
  let edgesPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sm-graph-'));
    edgesPath = join(tmpDir, 'edges.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes all edges involving a node', async () => {
    const graph = new SuperMemoryGraph(edgesPath, () => new Date('2026-01-01T00:00:00Z'));
    await graph.add('A', 'B', 'related_to');
    await graph.add('B', 'C', 'related_to');
    await graph.add('C', 'D', 'related_to');

    const removed = await graph.removeNodeEdges('B');
    expect(removed).toBe(2); // A-B and B-C

    const remaining = await graph.list();
    expect(remaining).toHaveLength(1); // C-D survives
    expect(remaining[0]!.from).toBe('C');
  });

  it('returns 0 when the node has no edges', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    await graph.add('A', 'B', 'related_to');
    const removed = await graph.removeNodeEdges('Z');
    expect(removed).toBe(0);
  });

  it('removes a single edge by id', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    const edge = await graph.add('A', 'B', 'related_to');
    const removed = await graph.removeEdge(edge.id);
    expect(removed).toBe(true);
    expect(await graph.list()).toHaveLength(0);
  });

  it('returns false when the edge id does not exist', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    await graph.add('A', 'B', 'related_to');
    const removed = await graph.removeEdge('nonexistent');
    expect(removed).toBe(false);
  });

  it('returns false when the edge is already deleted', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    const edge = await graph.add('A', 'B', 'related_to');
    await graph.removeEdge(edge.id);
    const secondAttempt = await graph.removeEdge(edge.id);
    expect(secondAttempt).toBe(false);
  });

  it('traverses from a start node with depth and limit', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    await graph.add('A', 'B', 'related_to');
    await graph.add('B', 'C', 'related_to');
    await graph.add('C', 'D', 'related_to');

    // Depth 1: only A-B
    const depth1 = await graph.traverse(['A'], { maxDepth: 1 });
    expect(depth1).toHaveLength(1);

    // Depth 2: A-B and B-C
    const depth2 = await graph.traverse(['A'], { maxDepth: 2 });
    expect(depth2).toHaveLength(2);

    // Depth 3: all three edges
    const depth3 = await graph.traverse(['A'], { maxDepth: 3 });
    expect(depth3).toHaveLength(3);
  });

  it('traverse respects the limit', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    await graph.add('A', 'B', 'related_to');
    await graph.add('B', 'C', 'related_to');
    await graph.add('C', 'D', 'related_to');

    const limited = await graph.traverse(['A'], { maxDepth: 5, limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('traverse filters by relation', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    await graph.add('A', 'B', 'related_to');
    await graph.add('A', 'C', 'supersedes');

    const filtered = await graph.traverse(['A'], { relations: ['supersedes'] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.relation).toBe('supersedes');
  });

  it('deduplicates identical (from, to, relation) edges on add', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    const edge1 = await graph.add('A', 'B', 'related_to');
    const edge2 = await graph.add('A', 'B', 'related_to');
    expect(edge1.id).toBe(edge2.id);
    expect(await graph.list()).toHaveLength(1);
  });

  it('clamps weight to [0, 1]', async () => {
    const graph = new SuperMemoryGraph(edgesPath);
    const edge = await graph.add('A', 'B', 'related_to', 5);
    expect(edge.weight).toBe(1);
    const edge2 = await graph.add('C', 'D', 'related_to', -1);
    expect(edge2.weight).toBe(0);
  });

  it('filters out malformed records on list', async () => {
    // Write a valid + invalid record to the edges file directly
    const validEdge: MemoryGraphEdge = {
      schemaVersion: 1,
      id: 'edge_valid',
      from: 'A',
      to: 'B',
      relation: 'related_to',
      weight: 0.5,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const malformed = JSON.stringify({ schemaVersion: 2, id: 'bad' });
    writeFileSync(edgesPath, `${JSON.stringify(validEdge)}\n${malformed}\n`, 'utf8');

    const graph = new SuperMemoryGraph(edgesPath);
    const edges = await graph.list();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe('edge_valid');
  });
});

// ── store-helpers — validation edge cases ──────────────────────────────

describe('store-helpers validation edges', () => {
  it('normalizeText collapses whitespace and trims', () => {
    expect(normalizeText('  hello\n  world  ')).toBe('hello world');
    expect(normalizeText('\t\t')).toBe('');
  });

  it('tokenize drops terms shorter than 3 chars and dedupes', () => {
    const tokens = tokenize('go to the typescript compiler API');
    expect(tokens).not.toContain('go');
    expect(tokens).not.toContain('to');
    expect(tokens).toContain('the');
    expect(tokens).toContain('typescript');
    // Deduped
    expect(tokens.filter((t) => t === 'the')).toHaveLength(1);
  });

  it('normalizeTags strips # prefix, lowercases, dedupes', () => {
    // The source does .replace(/^#/, '') BEFORE .trim(), so leading whitespace
    // before # prevents the strip. Without leading spaces it works:
    expect(normalizeTags(['#React', 'react', '#Node'])).toEqual(['react', 'node']);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(['', '  '])).toEqual([]);
  });

  it('normalizeAudience rejects non-object values', () => {
    expect(() => normalizeAudience('not-an-object' as never)).toThrow('must be an object');
    expect(() => normalizeAudience([1, 2] as never)).toThrow('must be an object');
    expect(() => normalizeAudience({ roles: 'not-an-array' } as never)).toThrow('must be an array of strings');
  });

  it('normalizeAudience rejects items over 256 chars', () => {
    const long = 'x'.repeat(257);
    expect(() => normalizeAudience({ roles: [long] })).toThrow('256 characters');
  });

  it('normalizeAudience returns undefined when all keys are empty', () => {
    expect(normalizeAudience({ roles: [], taskTypes: [] })).toBeUndefined();
  });

  it('normalizeAudience rejects too many items', () => {
    const many = Array.from({ length: 129 }, (_, i) => `r${i}`);
    expect(() => normalizeAudience({ roles: many })).toThrow('exceeds');
  });

  it('validateRememberInput rejects text exceeding 20000 chars', () => {
    expect(() => validateRememberInput({ text: 'x'.repeat(20_001) })).toThrow('exceeds');
  });

  it('validateRememberInput rejects invalid scope', () => {
    expect(() => validateRememberInput({ text: 'ok', scope: 'invalid' as never })).toThrow('Invalid Super Memory scope');
  });

  it('validateRememberInput rejects invalid kind', () => {
    expect(() => validateRememberInput({ text: 'ok', kind: 'invalid' as never })).toThrow('Invalid Super Memory kind');
  });

  it('validateRememberInput rejects anchor without path', () => {
    expect(() => validateRememberInput({ text: 'ok', anchors: [{ type: 'file' }] })).toThrow('require a path');
  });

  it('validateRememberInput rejects symbol anchor without symbol', () => {
    expect(() => validateRememberInput({
      text: 'ok',
      anchors: [{ type: 'symbol', path: '/f.ts' }],
    })).toThrow('require a symbol');
  });

  it('validateRememberInput rejects command anchor without command', () => {
    expect(() => validateRememberInput({
      text: 'ok',
      anchors: [{ type: 'command' }],
    })).toThrow('require a command');
  });

  it('validateRememberInput rejects oversized anchor paths', () => {
    expect(() => validateRememberInput({
      text: 'ok',
      anchors: [{ type: 'file', path: 'x'.repeat(4_097) }],
    })).toThrow('too long');
  });

  it('validateRememberInput rejects invalid source type', () => {
    expect(() => validateRememberInput({
      text: 'ok',
      sources: [{ type: 'invalid' as never }],
    })).toThrow('Invalid Super Memory source type');
  });

  it('validateRememberInput rejects too many tags', () => {
    expect(() => validateRememberInput({
      text: 'ok',
      tags: Array.from({ length: 129 }, (_, i) => `t${i}`),
    })).toThrow('exceeds');
  });

  it('normalizeSources dedupes and normalizes paths', () => {
    const sources = normalizeSources([
      { type: 'file', path: 'a/b/c.ts' },
      { type: 'file', path: 'a/b/c.ts' }, // duplicate
      { type: 'command', command: '  npm   test  ' },
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0]!.path).toBe('a/b/c.ts');
    expect(sources[1]!.command).toBe('npm test');
  });
});

// ── HashingEmbeddingProvider ──────────────────────────────────────────────

describe('HashingEmbeddingProvider', () => {
  it('produces deterministic vectors', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 64 });
    const vectors = await provider.embed(['hello world', 'hello world']);
    const v1 = vectors[0]!;
    const v2 = vectors[1]!;
    expect(v1.length).toBe(64);
    expect(v2.length).toBe(64);
    // Deterministic: same text → same vector
    for (let i = 0; i < 64; i++) {
      expect(v1[i]).toBe(v2[i]);
    }
  });

  it('produces different vectors for different texts', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 256 });
    const vectors = await provider.embed([
      'typescript project structure with interfaces and generics',
      'python data pipeline with pandas and numpy',
    ]);
    const v1 = vectors[0]!;
    const v2 = vectors[1]!;
    // Cosine similarity should be well below 1.0 for unrelated texts
    const sim = cosineSimilarity(v1, v2);
    expect(sim).toBeLessThan(0.85); // Not too similar
    expect(sim).toBeGreaterThan(0);  // Not completely orthogonal either
  });

  it('returns zero vector for empty text', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 32 });
    const vectors = await provider.embed(['']);
    const v = vectors[0]!;
    for (let i = 0; i < 32; i++) {
      expect(v[i]).toBe(0);
    }
  });

  it('handles batch of varying sizes', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 64 });
    const texts = ['a', 'b c', 'd e f', 'g h i j'];
    const vectors = await provider.embed(texts);
    expect(vectors).toHaveLength(4);
    for (const v of vectors) {
      expect(v.length).toBe(64);
    }
  });

  it('L2-normalized vector has unit length', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 256 });
    const vectors = await provider.embed(['the quick brown fox jumps over the lazy dog']);
    const v = vectors[0]!;
    let sumSq = 0;
    for (let i = 0; i < 256; i++) {
      sumSq += (v[i] ?? 0) * (v[i] ?? 0);
    }
    expect(Math.abs(Math.sqrt(sumSq) - 1)).toBeLessThan(0.001);
  });

  it('similar texts have higher cosine similarity than unrelated texts', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 256 });
    const vectors = await provider.embed([
      'react component with hooks and state management',
      'react functional component using hooks',
      'docker container deployment pipeline ci cd',
    ]);
    const vSimilar1 = vectors[0]!;
    const vSimilar2 = vectors[1]!;
    const vDiff = vectors[2]!;
    const simSimilar = cosineSimilarity(vSimilar1, vSimilar2);
    const simDiff = cosineSimilarity(vSimilar1, vDiff);
    expect(simSimilar).toBeGreaterThan(simDiff);
  });

  it('projected dimensions respect the configured size', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 512 });
    const vectors = await provider.embed(['test']);
    const v = vectors[0]!;
    expect(v.length).toBe(512);
  });

  it('accepts the maximum bounded dimension', () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 65_536 });
    expect(provider.dimensions).toBe(65_536);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 65_537])(
    'rejects invalid dimensions: %s',
    (dimensions) => {
      expect(() => new HashingEmbeddingProvider({ dimensions })).toThrow(
        'dimensions must be an integer from 1 to 65536',
      );
    },
  );

  it('projects a canonical FNV-1a hash to the expected dimension', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 256 });
    const [vector] = await provider.embed(['foobar']);
    expect(vector).toBeDefined();
    expect(vector!.findIndex((value) => value !== 0)).toBe(0xbf9cf968 % 256);
  });

  it('distributes representative tokens across every low-byte bucket', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 256 });
    const texts = Array.from({ length: 4_096 }, (_, index) => `token_${index}`);
    const vectors = await provider.embed(texts);
    const occupied = new Set(vectors.map((vector) => vector.findIndex((value) => value !== 0)));
    expect(occupied.size).toBe(256);
  });

  it('produces a nonzero vector for non-Latin text', async () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 64 });
    const [vector] = await provider.embed(['你好世界']);
    expect(vector).toBeDefined();
    expect(vector!.some((value) => value !== 0)).toBe(true);
  });

  it('has the expected id format', () => {
    const provider = new HashingEmbeddingProvider({ dimensions: 128 });
    expect(provider.id).toBe('hashing-v1-128');
    expect(provider.dimensions).toBe(128);
  });
});
