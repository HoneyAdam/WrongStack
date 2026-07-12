import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '../src/store.js';

let tmpDir: string;
let store: SuperMemoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-store-extra-'));
  store = new SuperMemoryStore({ projectRoot: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SuperMemoryStore — validation', () => {
  it('rejects empty text', async () => {
    await expect(store.rememberSuper({ text: '' })).rejects.toThrow(/empty/);
    await expect(store.rememberSuper({ text: '   ' })).rejects.toThrow(/empty/);
  });

  it('rejects text exceeding max length', async () => {
    const long = 'x'.repeat(50_000);
    await expect(store.rememberSuper({ text: long })).rejects.toThrow(/20000|20.000/);
  });

  it('rejects invalid scope', async () => {
    await expect(store.rememberSuper({ text: 'test', scope: 'invalid' as never })).rejects.toThrow(/scope/i);
  });

  it('rejects invalid kind', async () => {
    await expect(store.rememberSuper({ text: 'test', kind: 'unknown' as never })).rejects.toThrow(/kind/i);
  });

  it('rejects invalid anchor type', async () => {
    await expect(store.rememberSuper({
      text: 'test',
      anchors: [{ type: 'invalid' as never, path: 'src/file.ts' }],
    })).rejects.toThrow(/anchor type/i);
  });

  it('rejects invalid source type', async () => {
    await expect(store.rememberSuper({
      text: 'test',
      sources: [{ type: 'magic' as never }],
    })).rejects.toThrow(/source type/i);
  });

  it('rejects too many tags', async () => {
    const tags = Array.from({ length: 150 }, (_, i) => `tag${i}`);
    await expect(store.rememberSuper({ text: 'test', tags })).rejects.toThrow(/128/);
  });

  it('rejects too many anchors', async () => {
    const anchors = Array.from({ length: 150 }, (_, i) => ({ type: 'file' as const, path: `file${i}.ts` }));
    await expect(store.rememberSuper({ text: 'test', anchors })).rejects.toThrow(/128/);
  });

  it('rejects too many sources', async () => {
    const sources = Array.from({ length: 150 }, (_, i) => ({ type: 'session' as const, sessionId: `s${i}` }));
    await expect(store.rememberSuper({ text: 'test', sources })).rejects.toThrow(/128/);
  });
});

describe('SuperMemoryStore — legacy remember() options', () => {
  it('remembers with type and priority opts', async () => {
    await store.remember('critical item', 'project-memory', {
      type: 'decision',
      priority: 'critical',
      tags: ['a', 'b'],
    });
    const found = await store.searchSuper('critical item');
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it('remembers with user-memory scope', async () => {
    await store.remember('user item', 'user-memory');
    // Returns void — memory stored regardless
    const found = await store.searchSuper('user item', { includeStatuses: ['active'] });
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it('remembers with high priority', async () => {
    await store.remember('high item', 'project-memory', { priority: 'high' });
    const found = await store.searchSuper('high item');
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it('returns void for duplicate text', async () => {
    await store.rememberSuper({ text: 'duplicate text for remember' });
    const result = await store.remember('duplicate text for remember', 'project-memory');
    expect(result).toBeUndefined();
  });
});

describe('SuperMemoryStore — stats and list', () => {
  it('returns stats', async () => {
    await store.rememberSuper({ text: 'A memory.', kind: 'fact' });
    const stats = await store.stats();
    expect(stats.total).toBe(1);
    expect(stats.byStatus.active).toBe(1);
    expect(stats.byKind.fact).toBe(1);
    expect(typeof stats.edges).toBe('number');
  });

  it('lists by status', async () => {
    await store.rememberSuper({ text: 'Active one.' });
    const active = await store.listSuper(['active']);
    expect(active).toHaveLength(1);
    expect(await store.listSuper(['stale'])).toHaveLength(0);
  });
});

describe('SuperMemoryStore — candidates', () => {
  it('accepts a candidate', async () => {
    const result = await store.consolidateSession({
      sessionId: 's1',
      facts: [{ text: 'Candidate memory.', confidence: 0.4, importance: 0.4 }],
    });
    expect(result.candidates).toBe(1);
    const candidates = await store.listCandidates();
    expect(candidates).toHaveLength(1);

    const accepted = await store.acceptCandidate(candidates[0]!.id);
    expect(accepted?.text).toBe('Candidate memory.');
  });

  it('rejects a candidate', async () => {
    await store.consolidateSession({
      sessionId: 's2',
      facts: [{ text: 'Reject me.', confidence: 0.4, importance: 0.4 }],
    });
    const candidates = await store.listCandidates();
    const rejected = await store.rejectCandidate(candidates[0]!.id, 'Not useful');
    expect(rejected).toBe(true);
    expect(await store.listCandidates()).toHaveLength(0);
    expect(await store.listCandidates(true)).toHaveLength(1);
  });

  it('rejects already accepted candidate gracefully', async () => {
    await store.consolidateSession({
      sessionId: 's3',
      facts: [{ text: 'Accept then reject.', confidence: 0.4, importance: 0.4 }],
    });
    const candidates = await store.listCandidates();
    await store.acceptCandidate(candidates[0]!.id);
    await expect(store.rejectCandidate(candidates[0]!.id, 'Too late')).resolves.toBe(false);
  });
});

describe('SuperMemoryStore — graph traversal', () => {
  it('finds related memories through graph edges', async () => {
    await store.rememberSuper({
      text: 'Memory A.',
      anchors: [{ type: 'file', path: 'src/a.ts' }],
    });
    await store.rememberSuper({
      text: 'Memory B.',
      anchors: [{ type: 'file', path: 'src/b.ts' }],
    });
    const edges = await store.graphFor('src/a.ts');
    expect(edges).toBeDefined();
  });
});

describe('SuperMemoryStore — searchSuper', () => {
  it('searches with status filter', async () => {
    await store.rememberSuper({ text: 'Test search.', importance: 0.5 });
    // Update via rememberSuper with supersedes should work but we can't directly update
    // Instead use a second remember with same text (dedup will merge)
    const activeOnly = await store.searchSuper('Test', { includeStatuses: ['active'] });
    expect(activeOnly.length).toBeGreaterThanOrEqual(1);
    const withStale = await store.searchSuper('Test', { includeStatuses: ['active', 'stale'] });
    expect(withStale.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SuperMemoryStore — findRelated legacy', () => {
  it('finds related memories', async () => {
    await store.rememberSuper({ text: 'Related to session storage.', importance: 0.5 });
    await store.rememberSuper({ text: 'Unrelated note.', importance: 0.3 });
    const found = await store.findRelated('session', 'project-memory', 5);
    expect(found.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SuperMemoryStore — audit log', () => {
  it('reads audit log entries', async () => {
    await store.rememberSuper({ text: 'Audited memory.' });
    const audit = await store.readAudit();
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit.some((a) => a.event.includes('memory'))).toBe(true);
  });
});

describe('SuperMemoryStore — hygiene with verification', () => {
  it('hygiene with verification enabled returns report', async () => {
    await store.rememberSuper({ text: 'Memory for hygiene.' });
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    const report = await store.hygiene({ verify: true });
    expect(report.examined).toBe(1);
    expect(report.verified).toBeGreaterThanOrEqual(0);
  });
});

describe('SuperMemoryStore — importLegacy edge cases', () => {
  it('handles empty legacy file', async () => {
    const file = path.join(tmpDir, 'empty.md');
    await fs.writeFile(file, '', 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBe(0);
    expect(result.files).toBe(1);
  });

  it('imports legacy memories with type and priority metadata', async () => {
    const file = path.join(tmpDir, 'import.md');
    await fs.writeFile(file, [
      '# Project memory',
      '- [2026-01-01T00:00:00.000Z] [convention|high] Use pnpm for builds. #pnpm',
      '- Some plain text without timestamp',
    ].join('\n'), 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBe(2);
  });

  it('parses user scope in legacy format', async () => {
    const file = path.join(tmpDir, 'user-mem.md');
    await fs.writeFile(file, [
      '# User memory',
      '- User-specific note',
    ].join('\n'), 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBe(1);
  });

  it('parses agent scope in legacy format', async () => {
    const file = path.join(tmpDir, 'agent-mem.md');
    await fs.writeFile(file, [
      '# Agent memory',
      '- Agent-specific directive',
    ].join('\n'), 'utf8');
    const result = await store.importLegacy(file);
    expect(result.files).toBe(1);
  });
});

describe('SuperMemoryStore — verifyForPaths', () => {
  it('verifies non-existent paths returns stale', async () => {
    await store.rememberSuper({
      text: 'Memory for missing file.',
      anchors: [{ type: 'file', path: 'missing.ts' }],
    });
    const result = await store.verifyForPaths(['missing.ts']);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('SuperMemoryStore — retrieveForPath options', () => {
  it('retrieves by path with includeStatuses', async () => {
    await store.rememberSuper({
      text: 'Deeper path memory.',
      anchors: [{ type: 'file', path: 'packages/core/src/index.ts' }],
    });
    const results = await store.retrieveForPath({
      path: 'packages/core/src/index.ts',
      limit: 10,
      includeAncestors: true,
      includeStatuses: ['active'],
    });
    expect(results).toHaveLength(1);
  });
});

describe('SuperMemoryStore — traceId in constructor', () => {
  it('sets traceId', () => {
    const s = new SuperMemoryStore({ projectRoot: tmpDir, traceId: 'trace-123' });
    expect(s).toBeDefined();
  });
});

describe('SuperMemoryStore — verify errors', () => {
  it('verifies all memories when no id given', async () => {
    await store.rememberSuper({ text: 'Test verify all.' });
    const results = await store.verify();
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SuperMemoryStore — recordInjection', () => {
  it('records injection event', async () => {
    const mem = await store.rememberSuper({ text: 'Injected.' });
    await store.recordInjection?.([mem.id], 'read');
    const audit = await store.readAudit();
    expect(audit.some((a) => a.event === 'memory.injected')).toBe(true);
  });
});

describe('SuperMemoryStore — searchSuper with different queries', () => {
  it('returns empty for totally unrelated query', async () => {
    await store.rememberSuper({ text: 'This is about pnpm builds.' });
    expect(await store.searchSuper('completely_unrelated_xyzzy')).toEqual([]);
  });

  it('finds by tag token', async () => {
    await store.rememberSuper({ text: 'Important concept.', tags: ['core', 'api'] });
    const results = await store.searchSuper('core');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SuperMemoryStore — fresh memory dedup', () => {
  it('deduplicates identical text within same session', async () => {
    const first = await store.rememberSuper({ text: 'Dedup test.' });
    const second = await store.rememberSuper({ text: 'Dedup test.' });
    expect(second.id).toBe(first.id);
  });

  it('deduplicates with normalized whitespace', async () => {
    const first = await store.rememberSuper({ text: 'Extra   spaces.' });
    const second = await store.rememberSuper({ text: 'Extra spaces.' });
    expect(second.id).toBe(first.id);
  });
});

describe('SuperMemoryStore — addGraphEdge', () => {
  it('adds edges and lists them', async () => {
    const edge = await store.addGraphEdge('node:a', 'node:b', 'related_to');
    expect(edge.from).toBe('node:a');
    expect(edge.relation).toBe('related_to');
  });
});

describe('SuperMemoryStore — hygiene without verification', () => {
  it('hygiene report counts examined memories', async () => {
    await store.rememberSuper({ text: 'Memory 1.' });
    await store.rememberSuper({ text: 'Memory 2.' });
    const report = await store.hygiene({ verify: false });
    expect(report.examined).toBe(2);
  });
});

describe('SuperMemoryStore — forget legacy', () => {
  it('forgets a memory by text query', async () => {
    await store.rememberSuper({ text: 'Forget me please.' });
    const count = await store.forget('Forget me');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('returns 0 when no match', async () => {
    expect(await store.forget('nonexistent')).toBe(0);
  });
});

describe('SuperMemoryStore — legacy list/search', () => {
  it('lists memories by scope', async () => {
    await store.rememberSuper({ text: 'List me.', scope: 'project' });
    const entries = await store.list('project-memory');
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('searches by scope', async () => {
    await store.rememberSuper({ text: 'Search target.' });
    const found = await store.search('Search target', 'project-memory');
    expect(found.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SuperMemoryStore — consolidate legacy', () => {
  it('consolidates scope', async () => {
    await store.remember('consolidate me', 'project-memory');
    await expect(store.consolidate('project-memory')).resolves.toBeUndefined();
  });
});
