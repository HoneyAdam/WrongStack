import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { StatusBar, type StatusBarProps } from '../src/components/status-bar.js';

// Strip ANSI so we assert on the plain glyphs the user actually sees.
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function frameOf(props: Partial<StatusBarProps>): string {
  const { lastFrame, unmount } = render(
    React.createElement(StatusBar, {
      model: 'anthropic/claude',
      state: 'idle',
      ...props,
    } as StatusBarProps),
  );
  const out = strip(lastFrame() ?? '');
  unmount();
  return out;
}

/**
 * Regression tests for the segmented Powerline rail. The old
 * code recomputed "did any earlier chip render?" inline per chip by OR-ing every
 * preceding condition; those chains drifted and dropped separators in real
 * combinations. These tests pin the corrected behavior.
 */
describe('StatusBar chip separators', () => {
  it('line 1: separates the autonomy chip from subsequent runtime chips', () => {
    // Autonomy is now on line 1 (first chip). Project is on line 2.
    // Verify both appear in the output but not necessarily with a transition
    // between them since they're on different lines.
    const frame = frameOf({
      autonomy: 'auto',
      projectName: 'proj',
      hiddenItems: ['elapsed'],
      startedAt: undefined,
    });
    expect(frame).toContain('∞ AUTO');
    expect(frame).toContain('▣ proj');
    // Autonomy should have a transition to the next line-1 chip (state/idle)
    expect(frame).toMatch(/AUTO.*▶.*● idle/);
  });

  it('line 2: separates the task chip from the fleet chip without todos/plan present', () => {
    // On the combined secondary line, tasks and fleet chips appear with
    // Powerline transitions between all adjacent chips.
    const frame = frameOf({
      tasks: { pending: 1, inProgress: 0, completed: 0, blocked: 0, failed: 0 },
      fleet: { running: 1, idle: 0, pending: 0, completed: 0 },
    });
    // Both task and fleet glyphs appear on the same line with separators
    expect(frame).toContain('◆');
    expect(frame).toContain('◈');
    expect(frame).toMatch(/◆.*▶.*◈/);
  });

  it('renders todos on the active-work line (line 3)', () => {
    const frame = frameOf({
      todos: { pending: 2, inProgress: 1, completed: 0 },
    });
    // The todos chip now appears on line 3 (active work), not the secondary
    // line. Find the line that contains todos.
    const line = frame.split('\n').find((l) => l.includes('todos')) ?? '';
    expect(line).toContain('todos');
    // On line 3, todos is the first chip, so there is no transition before it.
    expect(line).toMatch(/^◖ todos/);
  });

  it('inserts a Powerline transition between every pair of visible chips on line 1', () => {
    const frame = frameOf({
      yolo: true,
      autonomy: 'eternal',
    });
    // YOLO is first on line 1, followed by autonomy, then state/idle, then model.
    // Every adjacent pair should have a Powerline transition.
    const line1 = frame.split('\n').find((l) => l.includes('YOLO')) ?? '';
    expect(line1).toMatch(/YOLO.*▶.*∞ ETERNAL/);
    expect(line1).toMatch(/∞ ETERNAL.*▶.*●/);
  });

  it('hides mailbox line content when mailbox is disabled', () => {
    const frame = frameOf({
      mailbox: {
        unread: 2,
        onlineAgents: 3,
        onlineClients: { tui: 1, webui: 1, repl: 0 },
        lastSubject: 'handoff',
        lastFrom: 'worker',
      },
      hiddenItems: ['mailbox'],
    });

    expect(frame).not.toContain('✉');
    expect(frame).not.toContain('handoff');
  });

  it('does not render an idle mailbox chip for the current TUI alone', () => {
    const frame = frameOf({
      mailbox: {
        unread: 0,
        onlineAgents: 1,
        onlineClients: { tui: 1, webui: 0, repl: 0 },
      },
    });

    expect(frame).not.toContain('✉');
    expect(frame).not.toContain('👥');
  });

  it('renders mailbox when a peer surface is online even with no unread mail', () => {
    const frame = frameOf({
      mailbox: {
        unread: 0,
        onlineAgents: 1,
        onlineClients: { tui: 1, webui: 1, repl: 0 },
      },
    });

    // The mailbox chip sits on line 3 (active work + connectivity). Mailbox
    // is the only chip on line 3 here, so it should render without overflow.
    expect(frame).toContain('✉');
    expect(frame).toContain('0');
  });
});
