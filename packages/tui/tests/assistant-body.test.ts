import { describe, expect, it } from 'vitest';
import { type BodySegment, splitFencedBlocks } from '../src/components/history.js';

function shapes(segs: BodySegment[]) {
  return segs.map((s) => (s.type === 'code' ? `code:${s.lang}` : 'prose'));
}

describe('splitFencedBlocks', () => {
  it('returns a single prose segment when there is no fence', () => {
    const segs = splitFencedBlocks('just some text\nover two lines');
    expect(shapes(segs)).toEqual(['prose']);
    expect(segs[0]?.text).toBe('just some text\nover two lines');
  });

  it('splits prose / code / prose in order with detected language', () => {
    const text = 'before\n```ts\nconst x = 1\n```\nafter';
    const segs = splitFencedBlocks(text);
    expect(shapes(segs)).toEqual(['prose', 'code:ts', 'prose']);
    expect(segs[0]?.text).toBe('before');
    expect(segs[1]?.text).toBe('const x = 1');
    expect(segs[2]?.text).toBe('after');
  });

  it('handles a code block at the very start', () => {
    const segs = splitFencedBlocks('```bash\nls -la\n```');
    expect(shapes(segs)).toEqual(['code:bash']);
    expect(segs[0]?.text).toBe('ls -la');
  });

  it('treats an unterminated fence as code to end of text', () => {
    const segs = splitFencedBlocks('text\n```python\ndef f():\n    pass');
    expect(shapes(segs)).toEqual(['prose', 'code:python']);
    expect(segs[1]?.text).toBe('def f():\n    pass');
  });

  it('maps an unknown fence language to plain', () => {
    const segs = splitFencedBlocks('```rust\nfn main() {}\n```');
    expect(shapes(segs)).toEqual(['code:plain']);
  });

  it('supports consecutive code blocks', () => {
    const segs = splitFencedBlocks('```ts\na\n```\n```json\n{}\n```');
    expect(shapes(segs)).toEqual(['code:ts', 'code:json']);
  });
});
