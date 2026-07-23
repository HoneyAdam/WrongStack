import { describe, expect, it } from 'vitest';
import {
  sageToLegacyScope,
  legacyToSageScope,
  kindToLegacyType,
  legacyTypeToKind,
  toLegacyEntry,
} from '../src/types.js';
import type { Sage, SageKind } from '../src/types.js';

describe('sageToLegacyScope', () => {
  it('maps user to user-memory', () => {
    expect(sageToLegacyScope('user')).toBe('user-memory');
  });

  it('maps project to project-memory', () => {
    expect(sageToLegacyScope('project')).toBe('project-memory');
  });

  it('maps session to project-memory', () => {
    expect(sageToLegacyScope('session')).toBe('project-memory');
  });

  it('maps file to project-memory', () => {
    expect(sageToLegacyScope('file')).toBe('project-memory');
  });

  it('maps symbol to project-memory', () => {
    expect(sageToLegacyScope('symbol')).toBe('project-memory');
  });
});

describe('legacyToSageScope', () => {
  it('maps user-memory to user', () => {
    expect(legacyToSageScope('user-memory')).toBe('user');
  });

  it('maps project-agents to project', () => {
    expect(legacyToSageScope('project-agents')).toBe('project');
  });

  it('maps project-memory to project', () => {
    expect(legacyToSageScope('project-memory')).toBe('project');
  });
});

describe('kindToLegacyType', () => {
  const testCases: [SageKind, string][] = [
    ['decision', 'decision'],
    ['convention', 'convention'],
    ['preference', 'preference'],
    ['anti_pattern', 'anti_pattern'],
    ['file_note', 'reference'],
    ['symbol_note', 'reference'],
    ['command_note', 'reference'],
    ['warning', 'fact'],
    ['workflow', 'fact'],
    ['bug_root_cause', 'fact'],
    ['summary', 'fact'],
    ['fact', 'fact'],
  ];

  for (const [kind, expected] of testCases) {
    it(`maps ${kind} to ${expected}`, () => {
      expect(kindToLegacyType(kind)).toBe(expected);
    });
  }
});

describe('legacyTypeToKind', () => {
  it('maps decision to decision', () => {
    expect(legacyTypeToKind('decision')).toBe('decision');
  });

  it('maps convention to convention', () => {
    expect(legacyTypeToKind('convention')).toBe('convention');
  });

  it('maps preference to preference', () => {
    expect(legacyTypeToKind('preference')).toBe('preference');
  });

  it('maps anti_pattern to anti_pattern', () => {
    expect(legacyTypeToKind('anti_pattern')).toBe('anti_pattern');
  });

  it('maps reference to file_note', () => {
    expect(legacyTypeToKind('reference')).toBe('file_note');
  });

  it('maps fact to fact', () => {
    expect(legacyTypeToKind('fact')).toBe('fact');
  });

  it('maps undefined to fact', () => {
    expect(legacyTypeToKind(undefined)).toBe('fact');
  });
});

describe('toLegacyEntry', () => {
  function makeMemory(overrides: Partial<Sage> = {}): Sage {
    return {
      id: 'mem_1',
      revision: 1,
      scope: 'project',
      kind: 'fact',
      status: 'active',
      text: 'A test memory.',
      importance: 0.5,
      confidence: 0.8,
      freshness: 0.9,
      tags: [],
      anchors: [],
      sources: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('uses legacyScope when present', () => {
    const memory = makeMemory({ legacyScope: 'user-memory', scope: 'project' });
    const entry = toLegacyEntry(memory);
    expect(entry.scope).toBe('user-memory');
  });

  it('falls back to sageToLegacyScope when legacyScope is undefined', () => {
    const memory = makeMemory({ scope: 'user', legacyScope: undefined });
    const entry = toLegacyEntry(memory);
    expect(entry.scope).toBe('user-memory');
  });

  it('includes tags when present', () => {
    const memory = makeMemory({ tags: ['test', 'memory'] });
    const entry = toLegacyEntry(memory);
    expect(entry.tags).toEqual(['test', 'memory']);
  });

  it('sets tags to undefined when empty', () => {
    const memory = makeMemory({ tags: [] });
    const entry = toLegacyEntry(memory);
    expect(entry.tags).toBeUndefined();
  });

  it('maps priority from importance: >= 0.9 critical', () => {
    const memory = makeMemory({ importance: 0.95 });
    expect(toLegacyEntry(memory).priority).toBe('critical');
  });

  it('maps priority from importance: >= 0.75 high', () => {
    const memory = makeMemory({ importance: 0.8 });
    expect(toLegacyEntry(memory).priority).toBe('high');
  });

  it('maps priority from importance: >= 0.4 medium', () => {
    const memory = makeMemory({ importance: 0.5 });
    expect(toLegacyEntry(memory).priority).toBe('medium');
  });

  it('maps priority from importance: < 0.4 low', () => {
    const memory = makeMemory({ importance: 0.3 });
    expect(toLegacyEntry(memory).priority).toBe('low');
  });

  it('includes source from first source ref', () => {
    const memory = makeMemory({ sources: [{ type: 'tool_result' }] });
    const entry = toLegacyEntry(memory);
    expect(entry.source).toBe('tool_result');
  });

  it('includes lastAccessedAt when defined', () => {
    const memory = makeMemory({ lastAccessedAt: '2026-06-01T00:00:00.000Z' });
    const entry = toLegacyEntry(memory);
    expect(entry.lastAccessed).toBe('2026-06-01T00:00:00.000Z');
  });

  it('omits lastAccessed when undefined', () => {
    const memory = makeMemory({ lastAccessedAt: undefined });
    const entry = toLegacyEntry(memory);
    expect(entry.lastAccessed).toBeUndefined();
  });
});
