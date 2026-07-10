import { describe, expect, it } from 'vitest';
import { splitStableStreamPrefix } from '../../src/components/MessageBubble/StreamingMarkdown';

describe('splitStableStreamPrefix', () => {
  it('returns everything as tail when there is no blank line yet', () => {
    expect(splitStableStreamPrefix('a single growing paragraph')).toEqual([
      '',
      'a single growing paragraph',
    ]);
  });

  it('splits at the last completed paragraph boundary', () => {
    const text = 'first para\n\nsecond para\n\nstill typing thi';
    const [prefix, tail] = splitStableStreamPrefix(text);
    expect(prefix).toBe('first para\n\nsecond para\n\n');
    expect(tail).toBe('still typing thi');
    expect(prefix + tail).toBe(text);
  });

  it('never splits inside an open code fence', () => {
    const text = 'intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\nnot closed yet';
    const [prefix, tail] = splitStableStreamPrefix(text);
    // The only safe blank line is the one before the fence opened.
    expect(prefix).toBe('intro\n\n');
    expect(tail.startsWith('```ts')).toBe(true);
    expect(prefix + tail).toBe(text);
  });

  it('splits after a closed code fence', () => {
    const text = '```js\nx()\n```\n\nafter the block continu';
    const [prefix, tail] = splitStableStreamPrefix(text);
    expect(prefix).toBe('```js\nx()\n```\n\n');
    expect(tail).toBe('after the block continu');
  });

  it('keeps everything as tail when the text ends exactly at the boundary', () => {
    // Splitting here would leave an empty tail; prefix+tail must reproduce
    // the input either way.
    const text = 'done para\n\n';
    const [prefix, tail] = splitStableStreamPrefix(text);
    expect(prefix + tail).toBe(text);
  });

  it('always reassembles to the exact original input', () => {
    const samples = [
      '',
      '\n\n',
      'a\n\nb\n\nc',
      '~~~\nfence alt syntax\n\nstill open',
      'text\n\n```\ncode\n```\n\ntail here\n\nmore',
    ];
    for (const s of samples) {
      const [p, t] = splitStableStreamPrefix(s);
      expect(p + t).toBe(s);
    }
  });
});
