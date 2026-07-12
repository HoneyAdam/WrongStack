import { describe, expect, it } from 'vitest';
import { parseToolInput } from '../src/_tool-input.js';

function dedent(s: string): string {
  return s.replace(/^[ \t]+/gm, '');
}

describe('parseToolInput (provider stream → canonical Record<string, unknown>)', () => {
  it('returns {} for undefined / empty', () => {
    expect(parseToolInput(undefined)).toEqual({});
    expect(parseToolInput('')).toEqual({});
  });

  it('returns the parsed object as-is for valid JSON object', () => {
    const r = parseToolInput('{"a":1,"b":"hi"}');
    expect(r).toEqual({ a: 1, b: 'hi' });
  });

  it('wraps a JSON array under __raw to preserve object contract', () => {
    const r = parseToolInput('[1,2,3]');
    expect(r).toHaveProperty('__raw');
    expect((r as { __raw: unknown }).__raw).toEqual([1, 2, 3]);
  });

  it('wraps a scalar (string) under __raw', () => {
    const r = parseToolInput('"plain string"');
    expect(r).toEqual({ __raw: 'plain string' });
  });

  it('wraps a scalar (number) under __raw', () => {
    const r = parseToolInput('42');
    expect(r).toEqual({ __raw: 42 });
  });

  it('wraps JSON null under __raw (defensive — falsy but parseable)', () => {
    const r = parseToolInput('null');
    // null is the JSON value; we still return an object envelope. The
    // __raw field holds the original raw string so the executor can see
    // exactly what arrived.
    expect(r).toHaveProperty('__raw');
  });

  it('preserves invalid JSON via __raw rather than throwing', () => {
    const r = parseToolInput('{not valid json');
    expect(r).toEqual({ __raw: '{not valid json' });
  });

  it('salvages valid JSON objects wrapped inside a JSON string scalar', () => {
    // Escaped string that parses to a valid JSON string scalar containing an object:
    // "{\"calls\":[{\"tool\":\"bash\",\"input\":{}}]}"
    const input = '"{\\"calls\\":[{\\"tool\\":\\"bash\\",\\"input\\":{}}]}"';
    const r = parseToolInput(input);
    expect(r).toEqual({
      calls: [{ tool: 'bash', input: {} }],
    });
  });

  it('result is always a plain object (callers can index by key)', () => {
    const cases = ['', '{}', '[]', '"x"', '42', 'null', 'true', '{bad'];
    for (const c of cases) {
      const r = parseToolInput(c);
      expect(typeof r).toBe('object');
      expect(r).not.toBeNull();
      expect(Array.isArray(r)).toBe(false);
    }
  });

  describe('repair ladder', () => {
    it('unwraps a ```json fenced object', () => {
      const r = parseToolInput('```json\n{"path":"a.ts","limit":5}\n```');
      expect(r).toEqual({ path: 'a.ts', limit: 5 });
    });

    it('unwraps a bare ``` fence without a language tag', () => {
      const r = parseToolInput('```\n{"a":1}\n```');
      expect(r).toEqual({ a: 1 });
    });

    it('unwraps a fenced object whose closing fence was truncated away', () => {
      const r = parseToolInput('```json\n{"a":1}');
      expect(r).toEqual({ a: 1 });
    });

    it('extracts a fenced object embedded in prose', () => {
      const r = parseToolInput('Here are the arguments:\n```json\n{"cmd":"ls"}\n```\nDone.');
      expect(r).toEqual({ cmd: 'ls' });
    });

    it('repairs a fenced object that is also truncated', () => {
      const r = parseToolInput('```json\n{"path":"a.ts","content":"hel');
      expect(r).toEqual({ path: 'a.ts', content: 'hel' });
    });

    it('does not touch fences inside legitimate string values', () => {
      const r = parseToolInput('{"text":"use ```js\\nfences\\n``` here"}');
      expect(r).toEqual({ text: 'use ```js\nfences\n``` here' });
    });

    it('repairs trailing commas', () => {
      const r = parseToolInput('{"a":1,"b":2,}');
      expect(r).toEqual({ a: 1, b: 2 });
    });

    it('repairs single-line comments', () => {
      const r = parseToolInput('{\n// the target file\n"path":"a.ts"\n}');
      expect(r).toEqual({ path: 'a.ts' });
    });

    it('repairs literal control characters inside string values', () => {
      const r = parseToolInput('{"old_string":"line1\nline2"}');
      expect(r).toEqual({ old_string: 'line1\nline2' });
    });

    it('repairs a truncated payload that also carries raw newlines', () => {
      const r = parseToolInput('{"content":"line1\nline2","path":"a.t');
      expect(r).toEqual({ content: 'line1\nline2', path: 'a.t' });
    });

    it('salvages a double-wrapped string that contains a fenced object', () => {
      const r = parseToolInput('"```json\\n{\\"a\\":1}\\n```"');
      expect(r).toEqual({ a: 1 });
    });

    it('still wraps an unrecoverable fenced payload under __raw', () => {
      const r = parseToolInput('```json\nnot json at all\n```');
      expect(r).toHaveProperty('__raw');
    });
  });
});
