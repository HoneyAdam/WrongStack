import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  type ExitConfirmationKey,
  ExitConfirmPanel,
  exitConfirmationDecision,
} from '../src/components/exit-confirm-panel.js';

describe('exitConfirmationDecision', () => {
  it('returns false on Escape', () => {
    expect(exitConfirmationDecision('', { escape: true } as ExitConfirmationKey)).toBe(false);
  });

  it('returns true on Enter (return)', () => {
    expect(exitConfirmationDecision('', { return: true } as ExitConfirmationKey)).toBe(true);
  });

  it('returns null for any printable input (no modifier)', () => {
    expect(exitConfirmationDecision('y', {} as ExitConfirmationKey)).toBeNull();
    expect(exitConfirmationDecision('x', {} as ExitConfirmationKey)).toBeNull();
  });

  it('returns null when keys carry Ctrl/Meta modifiers (still requires Enter/Esc)', () => {
    expect(exitConfirmationDecision('c', { ctrl: true } as ExitConfirmationKey)).toBeNull();
    expect(exitConfirmationDecision('c', { meta: true } as ExitConfirmationKey)).toBeNull();
  });

  it('returns null when no key and no input', () => {
    expect(exitConfirmationDecision('', {})).toBeNull();
  });

  it('returns null for arrow keys and other navigation keys not in the interface', () => {
    expect(
      exitConfirmationDecision('', {
        upArrow: true,
        downArrow: true,
        leftArrow: true,
        rightArrow: true,
      } as unknown as ExitConfirmationKey),
    ).toBeNull();
  });
});

describe('ExitConfirmPanel', () => {
  it('renders the leader-only summary when no subagents are running', () => {
    const view = render(
      React.createElement(ExitConfirmPanel, { leaderActive: true, subagentCount: 0 }),
    );
    const frame = view.lastFrame();
    expect(frame).toContain('EXIT BLOCKED');
    expect(frame).toContain('leader run');
    expect(frame).not.toContain('sub-agent');
    view.unmount();
  });

  it('renders the subagent-only summary when the leader is idle', () => {
    const view = render(
      React.createElement(ExitConfirmPanel, { leaderActive: false, subagentCount: 3 }),
    );
    const frame = view.lastFrame();
    expect(frame).toContain('3 sub-agents');
    expect(frame).not.toContain('leader run');
    view.unmount();
  });

  it('renders both leader and subagent counts together', () => {
    const view = render(
      React.createElement(ExitConfirmPanel, { leaderActive: true, subagentCount: 2 }),
    );
    const frame = view.lastFrame();
    expect(frame).toContain('leader run');
    expect(frame).toContain('2 sub-agents');
    expect(frame).toContain('leader run + 2 sub-agents');
    view.unmount();
  });

  it('pluralizes the subagent count correctly (singular vs plural)', () => {
    const single = render(
      React.createElement(ExitConfirmPanel, { leaderActive: false, subagentCount: 1 }),
    );
    expect(single.lastFrame()).toContain('1 sub-agent');
    expect(single.lastFrame()).not.toContain('1 sub-agents');
    single.unmount();

    const plural = render(
      React.createElement(ExitConfirmPanel, { leaderActive: false, subagentCount: 5 }),
    );
    expect(plural.lastFrame()).toContain('5 sub-agents');
    plural.unmount();
  });

  it('mentions Enter to confirm and Esc to cancel', () => {
    const view = render(
      React.createElement(ExitConfirmPanel, { leaderActive: true, subagentCount: 1 }),
    );
    const frame = view.lastFrame();
    expect(frame).toContain('Enter');
    expect(frame).toContain('Esc');
    view.unmount();
  });
});
