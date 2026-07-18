import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  slashConfirmationDecision,
  SlashConfirmPanel,
} from '../src/components/slash-confirm-panel.js';

describe('slash confirmation panel', () => {
  it('renders the question and explicit key choices', () => {
    const view = render(
      React.createElement(SlashConfirmPanel, {
        question: 'Stop the running agents?',
        defaultYes: false,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('CONFIRM ACTION');
    expect(frame).toContain('Stop the running agents?');
    expect(frame).toContain('Enter = no');
    expect(frame).toContain('Esc/q = cancel');
    view.unmount();
  });

  it('resolves y/n, honors the Enter default, and cancels on Esc', () => {
    expect(slashConfirmationDecision('y', {}, false)).toBe(true);
    expect(slashConfirmationDecision('N', {}, true)).toBe(false);
    expect(slashConfirmationDecision('', { return: true }, true)).toBe(true);
    expect(slashConfirmationDecision('', { return: true }, false)).toBe(false);
    expect(slashConfirmationDecision('', { escape: true }, true)).toBe('cancel');
    expect(slashConfirmationDecision('q', {}, true)).toBe('cancel');
    expect(slashConfirmationDecision('x', {}, true)).toBeNull();
  });
});
