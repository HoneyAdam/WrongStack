import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { AssistantTail, ASSISTANT_TAIL_HEIGHT, assistantTailRows } from '../src/components/history.js';

// Regression: AssistantTail must always render at exactly ASSISTANT_TAIL_HEIGHT
// rows. NOTE: As of the assistant-tail removal, this component is no longer
// wired into the ScrollableHistory or History rendering pipelines — committed
// assistant entries now render as normal history entries. The constant and
// component are kept for reference; these tests verify the component's
// contract remains intact if a future consumer re-integrates it.
describe('ASSISTANT_TAIL_HEIGHT constant', () => {
  it('renders at exactly ASSISTANT_TAIL_HEIGHT rows', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AssistantTail, { text: 'hello\nworld', termWidth: 120 }),
    );

    const frame = lastFrame() ?? '';
    // Strip ANSI sequences and OSC-8 hyperlink escapes before counting lines.
    const clean = frame.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\]8;[^\x07]*?(?:\x07|\x1b\\)/g, '');
    // Count ALL split entries — marginY rows produce empty strings that are
    // real layout rows. ASSISTANT_TAIL_HEIGHT = marginY(2) + header(1) +
    // body(8) = 11 rows.
    const lines = clean.split('\n');
    expect(lines.length).toBe(ASSISTANT_TAIL_HEIGHT);
    unmount();
  });

  it('always renders exactly ASSISTANT_TAIL_HEIGHT rows even with long text', () => {
    const longText = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const { lastFrame, unmount } = render(
      React.createElement(AssistantTail, { text: longText, termWidth: 120 }),
    );

    const frame = lastFrame() ?? '';
    const clean = frame.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\]8;[^\x07]*?(?:\x07|\x1b\\)/g, '');
    const lines = clean.split('\n');

    expect(lines.length).toBe(ASSISTANT_TAIL_HEIGHT);
    unmount();
  });

  it('matches the manual breakdown: marginY(2) + header(1) + body(ASSISTANT_TAIL_LINES)', () => {
    // Pure-function verification: assistantTailRows always returns exactly
    // tailLines rows regardless of input length.
    for (const text of ['', 'hi', 'a\nb\nc', 'x'.repeat(200)]) {
      expect(assistantTailRows(text, 8, 120)).toHaveLength(8);
    }
  });
});
