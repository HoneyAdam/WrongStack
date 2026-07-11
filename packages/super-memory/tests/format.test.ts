import { describe, expect, it } from 'vitest';
import { formatMemoryHints, formatMemoryHintsDetailed } from '../src/retrieval/format.js';
import type { SuperMemory } from '../src/types.js';

function makeMemory(id: string, overrides: Partial<SuperMemory> = {}): SuperMemory {
  return {
    id: `mem_${id}`,
    revision: 1,
    scope: 'project',
    kind: 'fact',
    status: 'active',
    text: `Memory ${id}`,
    importance: 0.5,
    confidence: 0.5,
    freshness: 0.5,
    tags: [],
    anchors: [],
    sources: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('formatMemoryHints', () => {
  it('returns empty string for empty memories', () => {
    expect(formatMemoryHints([])).toBe('');
  });

  it('renders memories in markdown-like list', () => {
    const result = formatMemoryHints([makeMemory('1', { text: 'Use pnpm.' })]);
    expect(result).toContain('Super Memory: related project knowledge');
    expect(result).toContain('Use pnpm.');
  });
});

describe('formatMemoryHintsDetailed', () => {
  it('returns empty text and ids for empty memories', () => {
    expect(formatMemoryHintsDetailed([])).toEqual({ text: '', memoryIds: [] });
  });

  it('returns empty when maxChars is 0', () => {
    const result = formatMemoryHintsDetailed([makeMemory('1')], { maxChars: 0 });
    expect(result).toEqual({ text: '', memoryIds: [] });
  });

  it('includes kind label and critical tag for high importance', () => {
    const memory = makeMemory('1', { kind: 'decision', importance: 0.95, text: 'Must do X.' });
    const result = formatMemoryHintsDetailed([memory]);
    expect(result.text).toContain('[decision][critical]');
  });

  it('includes status label when not active', () => {
    const memory = makeMemory('1', { kind: 'warning', status: 'stale', text: 'Old warning.' });
    const result = formatMemoryHintsDetailed([memory]);
    expect(result.text).toContain('[stale]');
  });

  it('includes anchor path in suffix', () => {
    const memory = makeMemory('1', { anchors: [{ type: 'file', path: 'src/main.ts' }] });
    const result = formatMemoryHintsDetailed([memory]);
    expect(result.text).toContain('(src/main.ts)');
  });

  it('includes anchor symbol#path in suffix', () => {
    const memory = makeMemory('1', { anchors: [{ type: 'symbol', path: 'src/main.ts', symbol: 'MyClass' }] });
    const result = formatMemoryHintsDetailed([memory]);
    expect(result.text).toContain('src/main.ts#MyClass');
  });

  it('handles anchor with symbol only', () => {
    const memory = makeMemory('1', { anchors: [{ type: 'symbol', symbol: 'MyFunc' }] });
    const result = formatMemoryHintsDetailed([memory]);
    expect(result.text).toContain('(MyFunc)');
  });

  it('handles anchor with command only', () => {
    const memory = makeMemory('1', { anchors: [{ type: 'command', command: 'npm test' }] });
    const result = formatMemoryHintsDetailed([memory]);
    expect(result.text).toContain('(npm test)');
  });

  it('truncates when memory text exceeds maxChars', () => {
    const longText = 'A'.repeat(500);
    const memory = makeMemory('1', { text: longText });
    const result = formatMemoryHintsDetailed([memory], { maxChars: 100 });
    expect(result.text.length).toBeLessThan(200);
    expect(result.text).toContain('…');
  });

  it('returns empty when no memory fits after truncation', () => {
    const memory = makeMemory('1', { text: 'Short enough.' });
    const result = formatMemoryHintsDetailed([memory], { maxChars: 10 });
    expect(result).toEqual({ text: '', memoryIds: [] });
  });

  it('stops at previous memory when a new one does not fit', () => {
    const m1 = makeMemory('1', { text: 'First memory' });
    const m2 = makeMemory('2', { text: 'Second memory is too long to fit' });
    const result = formatMemoryHintsDetailed([m1, m2], { maxChars: 80 });
    expect(result.text).toContain('First memory');
    expect(result.text).not.toContain('Second memory');
    expect(result.memoryIds).toEqual(['mem_1']);
  });

  it('honors custom heading', () => {
    const result = formatMemoryHintsDetailed([makeMemory('1')], { heading: 'Custom' });
    expect(result.text).toContain('--- Custom ---');
  });

  it('reports which memory IDs made the cut', () => {
    const result = formatMemoryHintsDetailed([
      makeMemory('1'),
      makeMemory('2'),
    ]);
    expect(result.memoryIds).toEqual(['mem_1', 'mem_2']);
  });

  it('handles high importance (>= 0.75) with high tag', () => {
    const result = formatMemoryHintsDetailed([makeMemory('1', { importance: 0.8, kind: 'convention' })]);
    expect(result.text).toContain('[convention][high]');
  });

  it('handles importance < 0.75 with no priority tag', () => {
    const result = formatMemoryHintsDetailed([makeMemory('1', { importance: 0.5 })]);
    expect(result.text).not.toContain('[critical]');
    expect(result.text).not.toContain('[high]');
  });
});
