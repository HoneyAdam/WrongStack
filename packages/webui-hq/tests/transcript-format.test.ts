/**
 * Unit tests for the pure transcript-formatting helpers that power the HQ Live
 * Console chat view (tool classification, input summaries, todo extraction,
 * duration/clock formatting). Diff extraction now lives in the shared
 * `@wrongstack/tools/tool-diff` model (tested in packages/tools); input
 * summaries delegate to `@wrongstack/tools/tool-summary` — the tests below pin
 * the delegation, not the summary grammar itself.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyTool,
  extractTodos,
  formatClock,
  formatDuration,
  prettyInput,
  summarizeToolInput,
  toolDisplayName,
  tryParseJson,
} from '../src/lib/transcript-format.js';

describe('classifyTool', () => {
  it('maps tool names to families case-insensitively', () => {
    expect(classifyTool('Edit')).toBe('edit');
    expect(classifyTool('write_file')).toBe('write');
    expect(classifyTool('BASH')).toBe('bash');
    expect(classifyTool('read')).toBe('read');
    expect(classifyTool('grep')).toBe('search');
    expect(classifyTool('WebFetch')).toBe('fetch');
    expect(classifyTool('TodoWrite')).toBe('todo');
    expect(classifyTool('mystery_tool')).toBe('generic');
  });

  it('strips the mcp__server__ prefix before classifying', () => {
    expect(classifyTool('mcp__fs__read')).toBe('read');
  });
});

describe('tryParseJson', () => {
  it('parses objects and arrays, ignores scalars/garbage', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson('[1,2]')).toEqual([1, 2]);
    expect(tryParseJson('plain text')).toBeUndefined();
    expect(tryParseJson('{bad json')).toBeUndefined();
    expect(tryParseJson(undefined)).toBeUndefined();
  });
});

describe('summarizeToolInput (delegates to @wrongstack/tools/tool-summary)', () => {
  it('summarizes a bash command', () => {
    expect(summarizeToolInput('bash', '{"command":"pnpm test"}')).toBe('$ pnpm test');
  });

  it('summarizes an edit with the file path and line counts', () => {
    const input = JSON.stringify({ file_path: 'a.ts', old_string: 'x\ny', new_string: 'x\ny\nz' });
    const s = summarizeToolInput('edit', input);
    expect(s).toContain('a.ts');
    expect(s).toContain('2');
    expect(s).toContain('3');
  });

  it('summarizes a todo list with done/in-progress counts', () => {
    const input = JSON.stringify({
      todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }],
    });
    const s = summarizeToolInput('TodoWrite', input);
    expect(s).toContain('3 todos');
    expect(s).toContain('1 done');
  });

  it('summarizes a read with offset/limit as a range', () => {
    const s = summarizeToolInput('read', '{"file_path":"a.ts","offset":10,"limit":20}');
    expect(s).toContain('a.ts');
    expect(s).toContain('10');
    expect(s).toContain('30');
  });

  it('returns clipped raw text when input is not JSON', () => {
    expect(summarizeToolInput('bash', 'not json here')).toBe('not json here');
  });

  it('returns empty for empty/absent input', () => {
    expect(summarizeToolInput('bash', undefined)).toBe('');
    expect(summarizeToolInput('bash', '{}')).toBe('');
  });
});

describe('extractTodos', () => {
  it('normalizes todo items and defaults unknown status to pending', () => {
    const input = JSON.stringify({
      todos: [
        { status: 'completed', content: 'a' },
        { status: 'in_progress', subject: 'b' },
        { status: 'weird', title: 'c' },
      ],
    });
    expect(extractTodos(input)).toEqual([
      { status: 'completed', content: 'a' },
      { status: 'in_progress', content: 'b' },
      { status: 'pending', content: 'c' },
    ]);
  });

  it('returns null when there is no todo array', () => {
    expect(extractTodos('{"command":"ls"}')).toBeNull();
    expect(extractTodos('not json')).toBeNull();
    expect(extractTodos('{"todos":[]}')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats ms / s / m ranges and rejects junk', () => {
    expect(formatDuration(820)).toBe('820ms');
    expect(formatDuration(2400)).toBe('2.4s');
    expect(formatDuration(63_000)).toBe('1m3s');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(-5)).toBe('');
  });
});

describe('toolDisplayName', () => {
  it('rewrites mcp prefixes and defaults empty to "tool"', () => {
    expect(toolDisplayName('mcp__github__list_prs')).toBe('github:list_prs');
    expect(toolDisplayName(undefined)).toBe('tool');
  });
});

describe('prettyInput', () => {
  it('pretty-prints JSON and passes through plain text', () => {
    expect(prettyInput('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyInput('plain')).toBe('plain');
  });
});

describe('formatClock', () => {
  it('returns empty for unparseable input', () => {
    expect(formatClock('not-a-date')).toBe('');
    expect(formatClock(undefined)).toBe('');
  });

  it('formats a valid ISO timestamp', () => {
    expect(formatClock('2026-07-08T12:34:56Z')).toMatch(/\d/);
  });
});
