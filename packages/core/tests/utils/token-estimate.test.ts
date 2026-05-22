import { describe, expect, it } from 'vitest';
import {
  estimateRequestTokens,
  estimateTextTokens,
  estimateToolDefTokens,
  estimateToolInputTokens,
  estimateToolResultTokens,
} from '../../src/utils/token-estimate.js';

describe('estimateToolInputTokens', () => {
  it('returns a positive integer for string input', () => {
    expect(estimateToolInputTokens('hello world')).toBeGreaterThan(0);
  });

  it('returns a positive integer for object input', () => {
    expect(estimateToolInputTokens({ command: 'ls -la' })).toBeGreaterThan(0);
  });

  it('handles null and primitive non-strings without throwing', () => {
    expect(estimateToolInputTokens(null)).toBeGreaterThan(0);
    expect(estimateToolInputTokens(42)).toBeGreaterThan(0);
    expect(estimateToolInputTokens(true)).toBeGreaterThan(0);
  });

  it('does NOT mutate the input object', () => {
    // Previously the function attached `__tokenEstimate` to the input — which
    // threw on frozen inputs and was visible to anyone iterating the object.
    const input = { command: 'echo hi', args: ['--flag'] };
    estimateToolInputTokens(input);
    expect(Object.keys(input).sort()).toEqual(['args', 'command']);
    expect(Object.getOwnPropertyNames(input).sort()).toEqual(['args', 'command']);
  });

  it('does NOT throw on a frozen input', () => {
    const frozen = Object.freeze({ url: 'https://example.com' });
    expect(() => estimateToolInputTokens(frozen)).not.toThrow();
  });

  it('returns the same estimate on repeated calls (cache hit)', () => {
    const input = { command: 'pwd' };
    const a = estimateToolInputTokens(input);
    const b = estimateToolInputTokens(input);
    expect(a).toBe(b);
  });

  it('cache eviction kicks in when crossing the size cap', () => {
    // Push >10k unique keys to trigger the eviction branch. Different shapes
    // each call → unique JSON.stringify keys.
    for (let i = 0; i < 10_050; i++) {
      estimateToolInputTokens({ k: i });
    }
    // After eviction the same call still returns a stable number.
    expect(estimateToolInputTokens({ k: 10_049 })).toBeGreaterThan(0);
  });
});

describe('estimateToolResultTokens', () => {
  it('returns >0 for plain string content', () => {
    expect(estimateToolResultTokens('some output')).toBeGreaterThan(0);
  });

  it('handles object content via JSON.stringify caching', () => {
    const a = estimateToolResultTokens({ stdout: 'ok' });
    const b = estimateToolResultTokens({ stdout: 'ok' });
    expect(a).toBe(b);
  });

  it('returns at least 1 for empty string', () => {
    expect(estimateToolResultTokens('')).toBeGreaterThanOrEqual(1);
  });
});

describe('estimateTextTokens', () => {
  it('scales roughly with text length', () => {
    const a = estimateTextTokens('hi');
    const b = estimateTextTokens('hello world');
    expect(b).toBeGreaterThan(a);
  });

  it('returns at least 1 for an empty string', () => {
    expect(estimateTextTokens('')).toBeGreaterThanOrEqual(1);
  });
});

describe('estimateToolDefTokens', () => {
  it('sums name + description + schema length', () => {
    const tool = {
      name: 'do_stuff',
      description: 'Run something',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
    };
    expect(estimateToolDefTokens(tool)).toBeGreaterThan(0);
  });

  it('handles missing description', () => {
    expect(estimateToolDefTokens({ name: 'x', inputSchema: {} })).toBeGreaterThan(0);
  });
});

describe('estimateRequestTokens', () => {
  it('returns zero across the board for empty inputs', () => {
    const r = estimateRequestTokens([], [], []);
    expect(r.messages).toBe(0);
    expect(r.systemPrompt).toBe(0);
    expect(r.tools).toBe(0);
    expect(r.total).toBe(0);
  });

  it('handles a string messages input', () => {
    const r = estimateRequestTokens('plain text', '', []);
    expect(r.messages).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(0);
  });

  it('handles array messages with string content', () => {
    const r = estimateRequestTokens(
      [{ role: 'user', content: 'hello there' }],
      '',
      [],
    );
    expect(r.messages).toBeGreaterThan(0);
  });

  it('handles array messages with content blocks (text and non-text)', () => {
    const r = estimateRequestTokens(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image', source: { type: 'base64', data: 'AAA' } },
          ],
        },
      ],
      '',
      [],
    );
    // Both text and non-text blocks contribute
    expect(r.messages).toBeGreaterThan(0);
  });

  it('handles string system prompt', () => {
    const r = estimateRequestTokens([], 'You are helpful.', []);
    expect(r.systemPrompt).toBeGreaterThan(0);
  });

  it('handles system prompt as array of text blocks', () => {
    const r = estimateRequestTokens(
      [],
      [
        { type: 'text', text: 'part one' },
        { type: 'text', text: 'part two' },
      ],
      [],
    );
    expect(r.systemPrompt).toBeGreaterThan(0);
  });

  it('sums tool definitions into the tools bucket', () => {
    const r = estimateRequestTokens(
      [],
      undefined,
      [
        { name: 'a', description: 'first', inputSchema: {} },
        { name: 'b', description: 'second', inputSchema: { x: 1 } },
      ],
    );
    expect(r.tools).toBeGreaterThan(0);
    // Empty messages array + non-string non-array system prompt
    // contribute 0; total === tools.
    expect(r.total).toBe(r.tools);
  });

  it('total equals sum of components', () => {
    const r = estimateRequestTokens(
      [{ role: 'user', content: 'msg' }],
      'sys',
      [{ name: 't', inputSchema: {} }],
    );
    expect(r.total).toBe(r.messages + r.systemPrompt + r.tools);
  });

  it('ignores messages that lack a content field', () => {
    const r = estimateRequestTokens([{ role: 'user' }], '', []);
    expect(r.messages).toBe(0);
  });

  it('ignores system prompt arrays whose entries are not text blocks', () => {
    const r = estimateRequestTokens([], [{ type: 'tool_use', id: 'x' }], []);
    expect(r.systemPrompt).toBe(0);
  });
});
