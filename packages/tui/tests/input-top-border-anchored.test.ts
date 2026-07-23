/**
 * Regression test for the TUI chat screen input top-border anchoring fix.
 *
 * Symptom: on the chat screen, the input row's top border line was being
 * drawn as a line of input text. The proximate trigger was a stray REPL-style
 * message briefly appearing at the bottom of the terminal — an out-of-band
 * write to `process.stdout` between two Ink frames that shifted the terminal
 * cursor down by one row. Ink's next-frame diff re-anchored using the
 * drifted cursor, and the first content row of the input rewrote on top of
 * the top border row.
 *
 * Fix: pin the visible Input's outer Box to an explicit height so Ink
 * positions the whole region via absolute cursor moves on every frame,
 * immune to cursor drift from out-of-band writes.
 *
 * What this test verifies:
 *   The Input's rendered frame always has the top border (`╭─…╮`) on its
 *   FIRST line, the input content on the next line, and the bottom frame
 *   (`╰─…─╯`) on the LAST line — across the natural content height of
 *   `rows.length + 2`. This locks in the structural invariant the fix
 *   depends on.
 *
 * What this test does NOT verify (would require a PTY harness):
 *   That the on-screen terminal position of the top border is preserved
 *   when stray bytes are written to `process.stdout` between two Ink
 *   frames. `ink-testing-library`'s `lastFrame()` returns Ink's intended
 *   output buffer, not what was painted on a real terminal — so cursor
 *   drift from out-of-band writes is invisible to it. Verifying that
 *   condition needs a PTY-based harness (e.g. `node-pty`) that tracks
 *   cursor state, which is out of scope for this test surface.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComposerStatus } from '../src/components/composer-status-chip.js';
import { Input } from '../src/components/input.js';

afterEach(() => {
  // Each test mounts/unmounts its own view; nothing to clean.
});

/** Strip ANSI SGR sequences so assertions can inspect the raw glyphs. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

interface MountInputOptions {
  value: string;
  cursor: number;
  status?: ComposerStatus | undefined;
  title?: string | undefined;
}

/** Render <Input> with the given value and return the frame split into lines. */
function renderInput(opts: MountInputOptions): string[] {
  const { lastFrame, unmount } = render(
    React.createElement(Input, {
      value: opts.value,
      cursor: opts.cursor,
      status: opts.status ?? { kind: 'idle', fleetRunning: 0 },
      title: opts.title ?? 'ASK WRONGSTACK',
      onKey: () => {},
    }),
  );
  const frame = lastFrame() ?? '';
  unmount();
  return stripAnsi(frame).split('\n');
}

describe('<Input> top border anchoring', () => {
  it('places the top border on the first line of the rendered frame', () => {
    const lines = renderInput({ value: '', cursor: 0 });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const top = lines[0] ?? '';
    expect(top.trimEnd().startsWith('╭')).toBe(true);
    expect(top.trimEnd().endsWith('╮')).toBe(true);
  });

  it('places the bottom frame on the last line of the rendered frame', () => {
    const lines = renderInput({ value: '', cursor: 0 });
    const bottom = lines[lines.length - 1] ?? '';
    expect(bottom.trimEnd().startsWith('╰')).toBe(true);
    expect(bottom.trimEnd().endsWith('╯')).toBe(true);
  });

  it('keeps the top border on line 0 even when the value wraps to multiple rows', () => {
    // A long value that wraps past the content width — the natural content
    // height grows, and the top border must stay anchored to the first line.
    const long = 'x'.repeat(200);
    const lines = renderInput({ value: long, cursor: long.length });
    const top = lines[0] ?? '';
    expect(top.trimEnd().startsWith('╭')).toBe(true);
    expect(top.trimEnd().endsWith('╮')).toBe(true);
    // The bottom frame is anchored to the last line.
    const bottom = lines[lines.length - 1] ?? '';
    expect(bottom.trimEnd().startsWith('╰')).toBe(true);
    expect(bottom.trimEnd().endsWith('╯')).toBe(true);
  });

  it('keeps the top border on line 0 across a re-render with a changed value', () => {
    // Render once, then re-render with a different value via a fresh render
    // — simulating the re-render that a REPL flash would trigger.
    const first = renderInput({ value: 'one', cursor: 3 });
    expect((first[0] ?? '').trimEnd().startsWith('╭')).toBe(true);
    expect((first[first.length - 1] ?? '').trimEnd().startsWith('╰')).toBe(true);

    const second = renderInput({ value: 'two longer message', cursor: 18 });
    expect((second[0] ?? '').trimEnd().startsWith('╭')).toBe(true);
    expect((second[0] ?? '').trimEnd().endsWith('╮')).toBe(true);
    // The second frame is anchored: top border on line 0, bottom frame on
    // the last line. (Whether the frame is taller than the first depends on
    // whether the new value wraps past the content width — that is an
    // orthogonal concern covered by the wrap test above.)
    const bottom = second[second.length - 1] ?? '';
    expect(bottom.trimEnd().startsWith('╰')).toBe(true);
    expect(bottom.trimEnd().endsWith('╯')).toBe(true);
  });

  it('does not contain input content on the top border line', () => {
    // The user's symptom: a single line of input was drawn as the top border
    // line. With the fix in place, the top border row contains only border
    // glyphs and the title — never the prompt or any input character.
    const lines = renderInput({ value: 'hello world', cursor: 11 });
    const top = lines[0] ?? '';
    // Prompt `› ` and any value characters must NOT appear on the top line.
    expect(top).not.toContain('›');
    expect(top).not.toContain('hello');
    expect(top).not.toContain('world');
  });
});
