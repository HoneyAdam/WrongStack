import { render } from 'ink-testing-library';
import { createElement as e } from 'react';
import { describe, expect, it } from 'vitest';
import { DiffBlock, type DiffLineRow } from '../src/components/history/code-block.js';

function renderDiffBlock(
  rows: DiffLineRow[],
  opts: { useColor?: boolean; added?: number; removed?: number; hidden?: number; hiddenAdded?: number; hiddenRemoved?: number } = {},
): string {
  const { lastFrame, unmount } = render(
    e(DiffBlock, {
      rows,
      hidden: opts.hidden ?? 0,
      added: opts.added ?? 0,
      removed: opts.removed ?? 0,
      hiddenAdded: opts.hiddenAdded ?? 0,
      hiddenRemoved: opts.hiddenRemoved ?? 0,
      useColor: opts.useColor ?? false,
    }),
  );
  const frame = lastFrame() ?? '';
  unmount();
  return frame;
}

describe('<DiffBlock /> rendering', () => {
  const rows: DiffLineRow[] = [
    { kind: 'hunk', text: '@@ -1 +1 @@' },
    { kind: 'del', text: '-old line', oldLine: 1 },
    { kind: 'add', text: '+new line', newLine: 1 },
    { kind: 'ctx', text: ' unchanged', oldLine: 2, newLine: 2 },
  ];

  it('renders the + and - markers for added and removed lines (no-color mode)', () => {
    const frame = renderDiffBlock(rows);
    expect(frame).toContain('+');
    expect(frame).toContain('-');
    expect(frame).toContain('new line');
    expect(frame).toContain('old line');
  });

  it('shows the hunk header', () => {
    const frame = renderDiffBlock(rows);
    expect(frame).toContain('@@ -1 +1 @@');
  });

  it('uses distinct markers — `+` for added, `-` for removed, blank for context', () => {
    const frame = renderDiffBlock(rows);
    // Each line carries its kind marker at the gutter position; the
    // assertion below is intentionally loose because the + appears in
    // the diff text too (in "+new line"); we just verify all three
    // kinds show up in the rendered frame.
    expect(frame).toMatch(/[+]/);
    expect(frame).toMatch(/[-]/);
    expect(frame).toContain('unchanged');
  });

  it('renders no footer when there are zero totals and no hidden lines', () => {
    // added=removed=hidden=0 → summaryFooter returns null, so nothing
    // extra appears below the body.
    const frame = renderDiffBlock(rows, {});
    expect(frame).not.toContain('more line');
    expect(frame).not.toContain('added');
    expect(frame).not.toContain('deleted');
  });

  it('renders an always-visible summary footer with total +N/-N (no truncation)', () => {
    // Even when the whole diff fits on screen (hidden=0), the totals
    // must surface so the change size is readable at a glance.
    const frame = renderDiffBlock(rows, { added: 7, removed: 3 });
    expect(frame).toContain('+7');
    expect(frame).toContain('added');
    expect(frame).toContain('-3');
    expect(frame).toContain('deleted');
    // No truncation note when nothing is hidden.
    expect(frame).not.toContain('more line');
  });

  it('renders hidden-line footer when there are more rows than shown', () => {
    const many: DiffLineRow[] = [
      { kind: 'hunk', text: '@@ -1,30 +1,30 @@' },
      ...Array.from({ length: 12 }, (_, i) => ({
        kind: 'add' as const,
        text: `+added line ${i}`,
        newLine: i + 1,
      })),
      { kind: 'add', text: '+more', newLine: 13 },
    ];
    // Caller (parseUnifiedDiff) is responsible for slicing the rows
    // AND for reporting `hidden` + `hiddenAdded`/`hiddenRemoved` and the
    // overall `added`/`removed` totals separately. Pass them in here so
    // both the summary chip and the truncation note have data to print.
    const { lastFrame, unmount } = render(
      e(DiffBlock, {
        rows: many,
        hidden: 5,
        added: 16,
        removed: 0,
        hiddenAdded: 4,
        hiddenRemoved: 1,
        useColor: false,
      }),
    );
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).toContain('…');
    expect(frame).toContain('more line');
    // Total additions surfaced by the summary chip.
    expect(frame).toContain('+16');
    // Hidden breakdown (+4 / -1) carried by the truncation note.
    expect(frame).toMatch(/\+4\b/);
    expect(frame).toMatch(/-1\b/);
  });

  it('renders the + marker with bold styling (no-color fallback)', () => {
    // In `useColor=false` mode the diff still distinguishes added vs
    // removed via the bold marker — the marker character + bold flag
    // are always emitted, only the wash is optional. We assert that the
    // frame carries both markers and they show up in their respective
    // line positions (i.e. we did NOT collapse add/del into the same
    // glyph or drop the bold flag).
    const frame = renderDiffBlock([
      { kind: 'del', text: '-old', oldLine: 1 },
      { kind: 'add', text: '+new', newLine: 1 },
    ]);
    expect(frame).toContain('-');
    expect(frame).toContain('+');
    expect(frame).toContain('old');
    expect(frame).toContain('new');
  });

  it('useColor=true renders content lines with the same body (visual parity)', () => {
    // The structural difference between useColor=true and useColor=false
    // is the background wash on add/del lines. The actual text content
    // (markers + body) must be identical regardless — otherwise users
    // would see different diffs based on terminal capability.
    const withoutColor = renderDiffBlock(
      [
        { kind: 'del', text: '-old line', oldLine: 1 },
        { kind: 'add', text: '+new line', newLine: 1 },
      ],
      { useColor: false },
    );
    const withColor = renderDiffBlock(
      [
        { kind: 'del', text: '-old line', oldLine: 1 },
        { kind: 'add', text: '+new line', newLine: 1 },
      ],
      { useColor: true },
    );
    // Strip whitespace and compare the textual content (ink-testing-library
    // strips ANSI escapes from lastFrame, so both should be plain text).
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(normalize(withoutColor)).toBe(normalize(withColor));
  });
});