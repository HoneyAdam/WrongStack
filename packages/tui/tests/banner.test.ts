import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { Banner, shortenPath } from '../src/components/history.js';

describe('<Banner />', () => {
  it('shows the WrongStack product name before the version', () => {
    const { lastFrame, unmount } = render(
      React.createElement(Banner, {
        entry: {
          id: 0,
          kind: 'banner',
          version: '1.2.3',
          provider: 'test-provider',
          model: 'test-model',
          cwd: '/workspace/my-project',
        },
      }),
    );

    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('WRONGSTACK');
    expect(frame).toContain('v1.2.3');
    // The cwd is shown in the workspace fact row in this layout
    expect(frame).toContain('my-project');
  });

  it('renders the full ASCII wordmark and runtime facts at normal terminal widths', () => {
    const { lastFrame, unmount } = render(
      React.createElement(Banner, {
        termWidth: 80,
        entry: {
          id: 0,
          kind: 'banner',
          version: '9.9.9',
          provider: 'anthropic',
          model: 'claude-test',
          cwd: '/workspace/wrongstack',
          family: 'claude',
          keyTail: 'XYZ',
        },
      }),
    );

    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('████');
    expect(frame).toContain('BUILT ON THE WRONG STACK. SHIPPED ANYWAY.');
    expect(frame).toContain('anthropic › claude-test');
    expect(frame).toContain('•••• XYZ');
    expect(frame).toContain('/workspace/wrongstack');
  });

  it('switches to a compact wordmark and keeps every row inside a narrow terminal', () => {
    const termWidth = 44;
    const { lastFrame, unmount } = render(
      React.createElement(Banner, {
        termWidth,
        entry: {
          id: 0,
          kind: 'banner',
          version: '1.2.3',
          provider: 'a-provider-with-a-very-long-name',
          model: 'a-model-with-a-very-long-name',
          cwd: '/workspace/a/very/deep/project/directory',
        },
      }),
    );

    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('WRONGSTACK');
    expect(frame).not.toContain('██');
    expect(frame).toContain('a-provider-with-a-very-long…');
    expect(frame.split('\n').every((line) => line.length <= termWidth)).toBe(true);
  });

  it('does not wrap its own content at ultra-compact widths', () => {
    const termWidth = 24;
    const { lastFrame, unmount } = render(
      React.createElement(Banner, {
        termWidth,
        entry: {
          id: 0,
          kind: 'banner',
          version: '123.456.789-preview',
          provider: 'provider',
          model: 'model',
          cwd: '/workspace/project',
        },
      }),
    );

    const frame = lastFrame() ?? '';
    unmount();

    expect(frame.split('\n').every((line) => line.length <= termWidth)).toBe(true);
    expect(frame).toContain('WrongStack');
  });
});

describe('shortenPath (banner cwd)', () => {
  it('returns the path unchanged when within the budget', () => {
    expect(shortenPath('/tmp/x', 32)).toBe('/tmp/x');
  });

  it('keeps the tail and prefixes with an ellipsis when over the budget', () => {
    const out = shortenPath('/aaa/bbb/ccc/ddd/eee/fff/ggg', 16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out.startsWith('…')).toBe(true);
    // The end of the path (closest to the user's actual working dir)
    // is preserved.
    expect(out.endsWith('ggg')).toBe(true);
  });

  it('honours the exact width budget down to the ellipsis character', () => {
    // 20-char path, 10-char budget → 1 ellipsis + 9 chars of tail.
    expect(shortenPath('abcdefghij1234567890', 10)).toBe('…2345678​90'.replace('​', ''));
    // simpler: check it's 10 chars and starts with ellipsis.
    const out = shortenPath('abcdefghij1234567890', 10);
    expect(out.length).toBe(10);
    expect(out[0]).toBe('…');
  });

  it('treats an empty string as a no-op', () => {
    expect(shortenPath('', 10)).toBe('');
  });
});
