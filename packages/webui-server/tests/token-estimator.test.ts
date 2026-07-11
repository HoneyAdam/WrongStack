import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  stringifyContent,
  messageTokens,
  messagePreview,
  estimateContextBreakdown,
} from '../src/server/token-estimator.js';

describe('estimateTokens', () => {
  it('returns ceil(length/4) for a short string', () => {
    expect(estimateTokens('abcd')).toBe(1); // 4/4 = 1
    expect(estimateTokens('abcde')).toBe(2); // 5/4 = 1.25 → 2
    expect(estimateTokens('')).toBe(0); // 0/4 = 0
  });

  it('handles longer strings', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25);
    expect(estimateTokens('a'.repeat(101))).toBe(26);
  });

  it('handles single character', () => {
    expect(estimateTokens('x')).toBe(1);
  });
});

describe('stringifyContent', () => {
  it('returns a string unchanged', () => {
    expect(stringifyContent('hello')).toBe('hello');
  });

  it('JSON stringifies an object', () => {
    expect(stringifyContent({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('JSON stringifies an array', () => {
    expect(stringifyContent([1, 2, 3])).toBe('[1,2,3]');
  });

  it('falls back to String() on circular reference', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = stringifyContent(obj);
    // Should not throw; falls back to String()
    expect(result).toBe(String(obj));
  });

  it('handles null', () => {
    expect(stringifyContent(null)).toBe('null');
  });

  it('handles numbers', () => {
    expect(stringifyContent(42)).toBe('42');
  });

  it('handles undefined (JSON.stringify returns raw undefined)', () => {
    // JSON.stringify(undefined) returns the JS value undefined (not a string),
    // so stringifyContent returns undefined for undefined input
    expect(stringifyContent(undefined)).toBeUndefined();
  });
});

describe('messageTokens', () => {
  it('estimates tokens for a string content', () => {
    expect(messageTokens('hello world')).toBe(estimateTokens('hello world'));
  });

  it('returns 0 for non-array, non-string content', () => {
    expect(messageTokens(42)).toBe(0);
    expect(messageTokens(null)).toBe(0);
    expect(messageTokens({})).toBe(0);
  });

  it('handles text blocks', () => {
    const content = [
      { type: 'text', text: 'Hello, how can I help you?' },
    ];
    expect(messageTokens(content)).toBe(estimateTokens('Hello, how can I help you?'));
  });

  it('handles text blocks with missing text', () => {
    const content = [{ type: 'text' }];
    expect(messageTokens(content)).toBe(0);
  });

  it('handles tool_use blocks', () => {
    const content = [
      { type: 'tool_use', name: 'read_file', input: { path: '/test.txt' } },
    ];
    expect(messageTokens(content)).toBe(
      estimateTokens(JSON.stringify({ path: '/test.txt' }))
    );
  });

  it('handles tool_result blocks', () => {
    const content = [
      { type: 'tool_result', content: 'file contents here' },
    ];
    expect(messageTokens(content)).toBe(
      estimateTokens(JSON.stringify('file contents here'))
    );
  });

  it('handles unknown block types gracefully', () => {
    const content = [
      { type: 'image', source: { url: '...' } },
    ];
    // Falls through to stringifyContent of the whole block
    expect(messageTokens(content)).toBeGreaterThan(0);
  });

  it('sums tokens across multiple blocks', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', name: 'read', input: { file: 'x' } },
      { type: 'tool_result', content: 'result data' },
    ];
    // For strings, stringifyContent returns them unchanged (not JSON-quoted)
    // For objects, stringifyContent uses JSON.stringify
    const expected =
      estimateTokens('Hello') +
      estimateTokens(stringifyContent({ file: 'x' })) +
      estimateTokens(stringifyContent('result data'));
    expect(messageTokens(content)).toBe(expected);
  });
});

describe('messagePreview', () => {
  it('returns first 60 chars of a string content', () => {
    expect(messagePreview('hello world')).toBe('hello world');
    const long = 'a'.repeat(100);
    expect(messagePreview(long)).toBe('a'.repeat(60));
  });

  it('returns empty string for non-array, non-string content', () => {
    expect(messagePreview(42)).toBe('');
    expect(messagePreview(null)).toBe('');
    expect(messagePreview({})).toBe('');
  });

  it('previews text blocks with first 40 chars', () => {
    const content = [{ type: 'text', text: 'Hello, how can I help you today?' }];
    const preview = messagePreview(content);
    expect(preview).toBe('Hello, how can I help you today?');
    expect(preview.length).toBeLessThanOrEqual(60);
  });

  it('previews tool_use blocks', () => {
    const content = [
      { type: 'tool_use', name: 'read_file' },
    ];
    expect(messagePreview(content)).toBe('[tool_use: read_file]');
  });

  it('previews tool_result blocks', () => {
    const content = [{ type: 'tool_result', content: 'data' }];
    expect(messagePreview(content)).toBe('[tool_result]');
  });

  it('handles unknown block types', () => {
    const content = [{ type: 'image_block', source: { url: '...' } }];
    expect(messagePreview(content)).toBe('[image_block]');
  });

  it('truncates combined preview to 60 chars', () => {
    const content = [
      { type: 'text', text: 'This is a very long text that goes well beyond sixty characters' },
      { type: 'tool_result', content: 'more data' },
    ];
    const preview = messagePreview(content);
    expect(preview.length).toBeLessThanOrEqual(60);
  });

  it('handles text blocks with undefined text', () => {
    const content = [{ type: 'text' }];
    expect(messagePreview(content)).toBe('');
  });
});

describe('estimateContextBreakdown', () => {
  it('computes a full breakdown with empty inputs', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [],
      tools: [],
      messages: [],
    });
    expect(result).toEqual({
      total: 0,
      systemPrompt: 0,
      tools: { total: 0, count: 0, breakdown: [] },
      messages: { total: 0, count: 0, breakdown: [] },
    });
  });

  it('includes system prompt tokens', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [{ text: 'You are a helpful assistant.' }],
      tools: [],
      messages: [],
    });
    expect(result.systemPrompt).toBeGreaterThan(0);
    expect(result.total).toBe(result.systemPrompt);
  });

  it('handles system prompt blocks with missing text', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [{ text: undefined }],
      tools: [],
      messages: [],
    });
    expect(result.systemPrompt).toBe(0);
  });

  it('includes tool breakdown with schema and description', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [],
      tools: [
        { name: 'read_file', inputSchema: { type: 'object' }, description: 'Read a file' },
      ],
      messages: [],
    });
    expect(result.tools.count).toBe(1);
    expect(result.tools.total).toBeGreaterThan(0);
    expect(result.tools.breakdown[0].name).toBe('read_file');
    expect(result.tools.breakdown[0].tokens).toBeGreaterThan(0);
  });

  it('handles tools with empty schema and description', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [],
      tools: [{ name: 'empty_tool' }],
      messages: [],
    });
    expect(result.tools.count).toBe(1);
    expect(result.tools.total).toBeGreaterThan(0);
  });

  it('includes message breakdown', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [],
      tools: [],
      messages: [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ],
    });
    expect(result.messages.count).toBe(2);
    expect(result.messages.total).toBeGreaterThan(0);
    expect(result.messages.breakdown[0].role).toBe('user');
    expect(result.messages.breakdown[1].role).toBe('assistant');
  });

  it('computes total as sum of all parts', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [
        { text: 'You are a helpful assistant that can use tools.' },
      ],
      tools: [
        { name: 'read_file', inputSchema: { type: 'object', properties: {} }, description: 'Read a file from disk' },
        { name: 'write_file', inputSchema: { type: 'object' }, description: 'Write a file to disk' },
      ],
      messages: [
        { role: 'user', content: 'Read the config file for me.' },
        { role: 'assistant', content: [
          { type: 'text', text: "I'll read that file now." },
          { type: 'tool_use', name: 'read_file', input: { path: '/config.json' } },
        ] },
        { role: 'tool', content: [
          { type: 'tool_result', content: JSON.stringify({ key: 'value' }) },
        ] },
      ],
    });
    expect(result.total).toBe(
      result.systemPrompt + result.tools.total + result.messages.total
    );
    expect(result.total).toBeGreaterThan(0);
  });

  it('handles messages with non-array, non-string content', () => {
    const result = estimateContextBreakdown({
      systemPrompt: [],
      tools: [],
      messages: [
        { role: 'system', content: 42 },
      ],
    });
    expect(result.messages.breakdown[0].tokens).toBe(0);
  });
});
