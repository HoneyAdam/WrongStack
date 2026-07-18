import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Input, type KeyEvent } from '../src/components/input.js';
import { feedPaste } from '../src/paste-accumulator.js';

describe('Input + paste accumulator integration', () => {
  it('does not turn normal typing into fake pasted blocks after a stripped ANSI fragment', async () => {
    const seen: Array<{ input: string; key: KeyEvent }> = [];
    let pasteAccum: string | null = null;
    let committed = '';

    const onKey = (input: string, key: KeyEvent) => {
      seen.push({ input, key });
      if (!input) return;
      const paste = feedPaste(pasteAccum, input);
      if (paste) {
        pasteAccum = paste.accum;
        if (paste.complete !== null) committed += paste.complete;
        return;
      }
      committed += input;
    };

    const { stdin, unmount } = render(
      React.createElement(Input, {
        value: '',
        cursor: 0,
        onKey,
      }),
    );

    stdin.write('[0m');
    stdin.write('a');
    stdin.write('b');
    stdin.write('c');
    await new Promise((resolve) => setImmediate(resolve));

    expect(seen.some((call) => call.input === '[0m')).toBe(true);
    expect(committed).toBe('abc');
    expect(pasteAccum).toBeNull();

    unmount();
  });
});
