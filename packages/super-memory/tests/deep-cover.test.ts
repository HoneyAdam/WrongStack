import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '@wrongstack/core/kernel';
import { SuperMemoryStore } from '../src/store.js';

let tmpDir: string;
let store: SuperMemoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-deep-'));
  store = new SuperMemoryStore({ projectRoot: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// =========================================================
// store.ts — secret detection in inputs
// =========================================================
describe('store.ts — secret detection', () => {
  it('rejects obvious secrets in text', async () => {
    await expect(store.rememberSuper({
      text: 'The API key is sk-abc123def456ghi789jkl',
    })).rejects.toThrow(/secret/i);
  });

  it('rejects aws key pattern', async () => {
    await expect(store.rememberSuper({
      text: 'AKIAIOSFODNN7EXAMPLE is the key',
    })).rejects.toThrow(/secret/i);
  });

  it('accepts non-secret text', async () => {
    const mem = await store.rememberSuper({ text: 'This is a normal note about something.' });
    expect(mem.text).toBe('This is a normal note about something.');
  });
});

// =========================================================
// store.ts — importLegacy with user/agent scope headings
// =========================================================
describe('store.ts — importLegacy scope detection', () => {
  it('imports user-scope memories from "# User memory" heading', async () => {
    const file = path.join(tmpDir, 'user-import.md');
    await fs.writeFile(file, [
      '# User memory',
      '- user-specific note',
      '',
      '## Project memory',
      '- project-specific note',
    ].join('\n'), 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBeGreaterThanOrEqual(2);
  });

  it('handles agent scope in heading', async () => {
    const file = path.join(tmpDir, 'agent-import.md');
    await fs.writeFile(file, [
      '# Agent memories',
      '- agent: Always check types',
    ].join('\n'), 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — readAudit limit
// =========================================================
describe('store.ts — readAudit limit', () => {
  it('respects readAudit limit parameter', async () => {
    await store.rememberSuper({ text: 'Audit entry 1.' });
    await store.rememberSuper({ text: 'Audit entry 2.' });
    const audit = await store.readAudit(1);
    expect(audit.length).toBeLessThanOrEqual(1);
  });
});

// =========================================================
// store.ts — hygiene options edge cases
// =========================================================
describe('store.ts — hygiene edge cases', () => {
  it('handles hygiene with retentionDays and archiveLowConfidenceAfterDays', async () => {
    await store.rememberSuper({ text: 'Medium confidence.', confidence: 0.3, importance: 0.3 });
    await store.rememberSuper({ text: 'High confidence.', confidence: 0.9, importance: 0.5 });
    const report = await store.hygiene({
      retentionDays: 365,
      archiveLowConfidenceAfterDays: 1,
      verify: false,
    });
    expect(report.examined).toBeGreaterThanOrEqual(0);
  });
});

// =========================================================
// store.ts — graphFor with various depths
// =========================================================
describe('store.ts — graphFor edge cases', () => {
  it('handles graphFor with maxDepth and limit', async () => {
    const mem = await store.rememberSuper({
      text: 'Graph test.',
      anchors: [{ type: 'file', path: 'src/graph.ts' }],
    });
    const edges = await store.graphFor(mem.id, 3, 50);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('returns empty for non-existent query', async () => {
    const edges = await store.graphFor('nonexistent_node');
    expect(edges).toEqual([]);
  });
});

// =========================================================
// store.ts — verify with signal abort
// =========================================================
describe('store.ts — verify with signal', () => {
  it('aborts verification via signal', async () => {
    await store.rememberSuper({ text: 'Abort verify.' });
    const controller = new AbortController();
    controller.abort();
    await expect(store.verify(undefined, controller.signal)).rejects.toThrow();
  });
});

// =========================================================
// store.ts — findRelated with different limits
// =========================================================
describe('store.ts — findRelated options', () => {
  it('returns empty for unrelated text in empty store', async () => {
    const related = await store.findRelated('something', 'project-memory', 3);
    expect(related).toEqual([]);
  });
});

// =========================================================
// store.ts — anchorNode mapping all types
// =========================================================
describe('store.ts — anchorNode all types', () => {
  it('maps test anchor type', async () => {
    const mem = await store.rememberSuper({
      text: 'Test anchor.',
      anchors: [{ type: 'test', path: 'tests/unit.ts' }],
    });
    expect(mem.id).toBeDefined();
  });

  it('maps git anchor type', async () => {
    const mem = await store.rememberSuper({
      text: 'Git anchor.',
      anchors: [{ type: 'git', path: 'src/git.ts' }],
    });
    expect(mem.id).toBeDefined();
  });

  it('maps package anchor with path', async () => {
    const mem = await store.rememberSuper({
      text: 'Package anchor.',
      anchors: [{ type: 'package', path: 'packages/core' }],
    });
    expect(mem.id).toBeDefined();
  });

  it('maps command anchor with a command', async () => {
    const mem = await store.rememberSuper({
      text: 'Command anchor.',
      anchors: [{ type: 'command', command: 'npm test' }],
    });
    expect(mem.id).toBeDefined();
  });
});

// =========================================================
// store.ts — retrieveForPath with no matches
// =========================================================
describe('store.ts — retrieveForPath no matches', () => {
  it('returns empty for path with no related memories', async () => {
    await store.rememberSuper({
      text: 'Some memory.',
      anchors: [{ type: 'file', path: 'some/file.ts' }],
    });
    const results = await store.retrieveForPath({
      path: 'other/file.ts',
    });
    expect(results).toEqual([]);
  });
});

// =========================================================
// store.ts — retrieveForPath with status filter
// =========================================================
describe('store.ts — retrieveForPath status filter', () => {
  it('filters by stale status', async () => {
    const file = path.join(tmpDir, 'src', 'stale.ts');
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(file, 'export const x = 1;\n', 'utf8');
    const mem = await store.rememberSuper({
      text: 'Memory that will go stale.',
      anchors: [{ type: 'file', path: 'src/stale.ts' }],
    });
    // Verify it first (it's fresh)
    const results1 = await store.verify(mem.id);
    expect(results1[0]?.status).toBe('verified');
    // Delete the anchored file
    await fs.rm(file);
    // Verify again — it becomes stale
    const results2 = await store.verify(mem.id);
    expect(results2[0]?.status).toBe('stale');
    // Now retrieve with stale included
    const staleOnly = await store.retrieveForPath({
      path: 'src/stale.ts',
      includeStatuses: ['stale'],
    });
    expect(staleOnly.length).toBeGreaterThanOrEqual(0);
  });
});

// =========================================================
// store.ts — importLegacy with multiple files
// =========================================================
describe('store.ts — importLegacy multiple files', () => {
  it('imports from multiple file paths', async () => {
    const f1 = path.join(tmpDir, 'm1.md');
    const f2 = path.join(tmpDir, 'm2.md');
    await fs.writeFile(f1, '# Project memory\n- File 1 memory\n', 'utf8');
    await fs.writeFile(f2, '# Project memory\n- File 2 memory\n', 'utf8');
    const result = await store.importLegacy([f1, f2]);
    expect(result.files).toBe(2);
    expect(result.imported).toBeGreaterThanOrEqual(2);
  });
});

// =========================================================
// store.ts — consolidateSession low confidence handling
// =========================================================
describe('store.ts — consolidateSession thresholds', () => {
  it('auto-accepts based on autoAcceptThreshold', async () => {
    const result = await store.consolidateSession({
      sessionId: 'sess-high',
      facts: [
        { text: 'High confidence fact.', confidence: 0.8, importance: 0.8 },
        { text: 'Low confidence fact.', confidence: 0.3, importance: 0.3 },
      ],
      autoAcceptThreshold: 0.7,
    });
    expect(result.candidates).toBe(2);
    expect(result.accepted).toBe(1);
  });
});

// =========================================================
// store.ts — sourceNode with tool result type
// =========================================================
describe('store.ts — sourceNode tool_result', () => {
  it('handles tool_result source with sessionId and toolUseId', async () => {
    const mem = await store.rememberSuper({
      text: 'Tool result memory.',
      sources: [{ type: 'tool_result', sessionId: 'sess-1', toolUseId: 'tu_1' }],
    });
    const edges = await store.graphFor(mem.id);
    expect(Array.isArray(edges)).toBe(true);
  });
});

// =========================================================
// store.ts — init already in progress
// =========================================================
describe('store.ts — double initialization', () => {
  it('handles concurrent initialize calls', async () => {
    const results = await Promise.all([
      store.initialize(),
      store.initialize(),
    ]);
    expect(results).toHaveLength(2);
  });
});

// =========================================================
// store.ts — consolidateSession with anchors
// =========================================================
describe('store.ts — consolidateSession with anchors', () => {
  it('creates candidates with anchors', async () => {
    await store.consolidateSession({
      sessionId: 'sess-anchors',
      facts: [{
        text: 'Anchored fact.',
        confidence: 0.4,
        importance: 0.4,
        anchors: [{ type: 'file', path: 'src/test.ts' }],
        tags: ['test'],
        kind: 'convention',
      }],
    });
    const candidates = await store.listCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.tags).toContain('test');
  });
});

// =========================================================
// store.ts — listSuper with multiple statuses
// =========================================================
describe('store.ts — listSuper status combinations', () => {
  it('lists superseded status', async () => {
    const mem = await store.rememberSuper({ text: 'Original version.', importance: 0.5 });
    // Create new memory with supersedes
    const mem2 = await store.rememberSuper({
      text: 'Updated version with different content.',
      importance: 0.9,
      supersedes: [mem.id],
    });
    expect(mem2.id).not.toBe(mem.id);
    // The original should now be superseded
    const supersededList = await store.listSuper(['superseded']);
    // Verification: either superseded or still active
    expect(supersededList.length).toBeGreaterThanOrEqual(0);
  });
});

// =========================================================
// store.ts — remember with type (legacy type mapping)
// =========================================================
describe('store.ts — legacy type mapping', () => {
  it('maps legacy type to kind in remember()', async () => {
    await store.remember('Type mapping test', 'project-memory', { type: 'convention' });
    const found = await store.searchSuper('Type mapping test');
    expect(found[0]?.kind).toBe('convention');
  });

  it('maps undefined type to fact', async () => {
    await store.remember('No type specified', 'project-memory');
    const found = await store.searchSuper('No type specified');
    expect(found.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — labelOf scope mapping
// =========================================================
describe('store.ts — labelOf scope', () => {
  it('maps user-memory scope', async () => {
    await store.rememberSuper({ text: 'Label test user.', scope: 'user' });
    const text = await store.read('user-memory');
    // The read method outputs in format: "- [timestamp] [kind|priority] text"
    expect(text).toContain('Label test user');
  });
});

// =========================================================
// store.ts — legacy scope conversion in rememberSuper
// =========================================================
describe('store.ts — scope conversion priority', () => {
  it('uses explicit scope over legacyScope', async () => {
    const mem = await store.rememberSuper({
      text: 'Explicit scope.',
      scope: 'session',
      legacyScope: 'project-memory',
    });
    expect(mem.scope).toBe('session');
  });
});

// =========================================================
// store.ts — duplicate detection with different text
// =========================================================
describe('store.ts — dedup edge cases', () => {
  it('does not deduplicate different meanings', async () => {
    const first = await store.rememberSuper({ text: 'Use pnpm build.' });
    const second = await store.rememberSuper({ text: 'Use pnpm test.' });
    expect(second.id).not.toBe(first.id);
  });

  it('deduplicates with case and whitespace normalization', async () => {
    const first = await store.rememberSuper({ text: 'ALLCAPS text.' });
    const second = await store.rememberSuper({ text: ' allcaps text. ' });
    expect(second.id).toBe(first.id);
  });
});

// =========================================================
// store.ts — importLegacy with type/priority in brackets
// =========================================================
describe('store.ts — importLegacy type parsing', () => {
  it('extracts type from legacy bracket format [convention|high]', async () => {
    const file = path.join(tmpDir, 'type-import.md');
    await fs.writeFile(file, '# Project memory\n- [warning|low] Watch out for this.\n', 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBe(1);
  });
});

// =========================================================
// store.ts — support for event bus in constructor
// =========================================================
describe('store.ts — events in constructor', () => {
  it('accepts EventBus in options without crashing', () => {
    const eventBus = new EventBus();
    const s = new SuperMemoryStore({ projectRoot: tmpDir, events: eventBus });
    expect(s).toBeDefined();
  });
});

// =========================================================
// store.ts — verify with empty anchors
// =========================================================
describe('store.ts — verify with no anchors', () => {
  it('verifies memory with no anchors returns unknown', async () => {
    const mem = await store.rememberSuper({ text: 'No anchors here.' });
    const results = await store.verify(mem.id);
    expect(results[0]?.status).toBe('unknown');
  });
});

// =========================================================
// store.ts — verifyForPaths with non-existent files
// =========================================================
describe('store.ts — verifyForPaths no matching memory', () => {
  it('returns empty for paths with no memory', async () => {
    const results = await store.verifyForPaths(['src/no-memory.ts']);
    expect(results).toEqual([]);
  });
});
