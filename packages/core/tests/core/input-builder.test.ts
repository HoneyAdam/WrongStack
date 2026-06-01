import { describe, expect, it } from 'vitest';
import { InputBuilder } from '../../src/core/input-builder.js';
import { DefaultAttachmentStore } from '../../src/storage/attachment-store.js';

function makeBuilder() {
  const store = new DefaultAttachmentStore();
  const builder = new InputBuilder({ store, pasteLineThreshold: 3, pasteCharThreshold: 50 });
  return { store, builder };
}

describe('InputBuilder', () => {
  it('inlines small text and submits a single text block', async () => {
    const { builder } = makeBuilder();
    builder.appendText('hi ');
    builder.appendText('there');
    const blocks = await builder.submit();
    expect(blocks).toEqual([{ type: 'text', text: 'hi there' }]);
  });

  it('collapses large pastes to [pasted #N] placeholder and expands on submit', async () => {
    const { builder } = makeBuilder();
    builder.appendText('look: ');
    const big = 'a'.repeat(200);
    const placeholder = await builder.appendPaste(big);
    expect(placeholder).toBe('[pasted #1]');
    expect(builder.text).toBe('look: [pasted #1]');
    const blocks = await builder.submit();
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toContain(big);
  });

  it('inlines pastes under the threshold', async () => {
    const { builder } = makeBuilder();
    const placeholder = await builder.appendPaste('short');
    expect(placeholder).toBeNull();
    expect(builder.text).toBe('short');
    expect(builder.attachments).toHaveLength(0);
  });

  it('always collapses images regardless of size', async () => {
    const { builder } = makeBuilder();
    builder.appendText('see this: ');
    const ph = await builder.appendImage('AAAA', 'image/png');
    expect(ph).toBe('[image #1]');
    const blocks = await builder.submit();
    expect(blocks.some((b) => b.type === 'image')).toBe(true);
  });

  it('submit() resets state for next turn', async () => {
    const { builder } = makeBuilder();
    builder.appendText('first');
    await builder.submit();
    expect(builder.text).toBe('');
    expect(builder.attachments).toHaveLength(0);
    builder.appendText('second');
    expect(builder.text).toBe('second');
  });

  it('isEmpty reflects whitespace-only state', async () => {
    const { builder } = makeBuilder();
    expect(builder.isEmpty).toBe(true);
    builder.appendText('   \n\t');
    expect(builder.isEmpty).toBe(true);
    builder.appendText('x');
    expect(builder.isEmpty).toBe(false);
  });

  it('wouldCollapse mirrors appendPaste collapse decision without mutating state', async () => {
    const { builder } = makeBuilder(); // thresholds: 3 lines / 50 chars
    expect(builder.wouldCollapse('short')).toBe(false);
    expect(builder.wouldCollapse('a'.repeat(50))).toBe(true);
    expect(builder.wouldCollapse('one\ntwo\nthree')).toBe(true);
    // Predicate is pure — it must not append anything to the display.
    expect(builder.text).toBe('');
    // And it agrees with the actual appendPaste outcome.
    expect(await builder.appendPaste('short')).toBeNull();
    builder.reset();
    expect(await builder.appendPaste('a'.repeat(50))).toBe('[pasted #1]');
  });

  it('numbers placeholders independently per kind', async () => {
    const { builder } = makeBuilder();
    await builder.appendPaste('x'.repeat(100));
    await builder.appendImage('AAAA', 'image/png');
    await builder.appendPaste('y'.repeat(100));
    expect(builder.text).toContain('[pasted #1]');
    expect(builder.text).toContain('[image #1]');
    expect(builder.text).toContain('[pasted #2]');
  });

  describe('register-only methods (TUI: token without display mutation)', () => {
    it('registerPaste stores the paste and returns a token but leaves display empty', async () => {
      const { store, builder } = makeBuilder();
      const token = await builder.registerPaste('one\ntwo\nthree\nfour');
      expect(token).toMatch(/^\[pasted #1, \d+ lines\]$/);
      expect(builder.text).toBe(''); // display untouched
      // The ref lives in the store, so expanding the token resolves it.
      const blocks = await store.expand(token);
      expect((blocks[0] as { text: string }).text).toContain('two');
    });

    it('registerFile returns a path-keyed token resolvable via the store', async () => {
      const { store, builder } = makeBuilder();
      const token = await builder.registerFile({
        kind: 'file',
        data: 'CONTENT',
        meta: { filename: 'src/x.ts', label: 'src/x.ts' },
      });
      expect(token).toBe('[file:src/x.ts]');
      expect(builder.text).toBe('');
      const blocks = await store.expand(token);
      expect((blocks[0] as { text: string }).text).toContain('CONTENT');
    });

    it('registerImage returns a seq-keyed labelled token without touching display', async () => {
      const { store, builder } = makeBuilder();
      const token = await builder.registerImage('AAAA', 'image/png');
      expect(token).toBe('[image #1, PNG]');
      expect(builder.text).toBe('');
      const blocks = await store.expand(token);
      expect(blocks.some((b) => b.type === 'image')).toBe(true);
    });

    it('a buffer of register-only tokens expands once via appendText + submit', async () => {
      const { builder } = makeBuilder();
      // Simulate the TUI: tokens live in the caller's own buffer.
      const p = await builder.registerPaste('aaa\nbbb\nccc\nddd');
      const f = await builder.registerFile({
        kind: 'file',
        data: 'FILE_BODY',
        meta: { filename: 'a.ts', label: 'a.ts' },
      });
      builder.appendText(`hello ${p} and ${f}`);
      const blocks = await builder.submit();
      const joined = blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
      expect(joined).toContain('hello ');
      expect(joined).toContain('bbb'); // paste expanded exactly once
      expect(joined).toContain('FILE_BODY'); // file expanded exactly once
      // No leftover literal tokens.
      expect(joined).not.toContain('[pasted #1');
      expect(joined).not.toContain('[file:a.ts]');
    });
  });
});
