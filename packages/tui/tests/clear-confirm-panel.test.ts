import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  clearConfirmationKeyResult,
  ClearConfirmPanel,
  isClearConfirmation,
} from '../src/components/clear-confirm-panel.js';

describe('clear confirmation token', () => {
  it('accepts only the exact uppercase YES token', () => {
    expect(isClearConfirmation('YES')).toBe(true);
    expect(isClearConfirmation('yes')).toBe(false);
    expect(isClearConfirmation('Y')).toBe(false);
    expect(isClearConfirmation('YES ')).toBe(false);
    expect(isClearConfirmation('')).toBe(false);
  });

  it('renders active leader/sub-agent details and explicit YES instructions', () => {
    const view = render(
      React.createElement(ClearConfirmPanel, {
        leaderActive: true,
        subagentCount: 2,
        value: 'YE',
      }),
    );

    expect(view.lastFrame() ?? '').toContain('CLEAR BLOCKED — ACTIVE WORK');
    expect(view.lastFrame() ?? '').toContain('leader run + 2 sub-agents');
    expect(view.lastFrame() ?? '').toContain('Type YES');

    expect(view.lastFrame() ?? '').toContain('Confirmation: YE');

    view.unmount();
  });

  it('keeps an invalid Enter pending and preserves the visible input', () => {
    let result = clearConfirmationKeyResult('', 'yes', {});
    expect(result).toEqual({ decision: null, value: 'yes' });

    result = clearConfirmationKeyResult(result.value, '', { return: true });
    expect(result).toEqual({ decision: null, value: 'yes' });
  });

  it('supports correction and confirms only after the exact YES token', () => {
    let result = clearConfirmationKeyResult('YEX', '', { backspace: true });
    expect(result.value).toBe('YE');

    result = clearConfirmationKeyResult(result.value, 'S', {});
    expect(result.value).toBe('YES');

    result = clearConfirmationKeyResult(result.value, '', { return: true });
    expect(result).toEqual({ decision: true, value: 'YES' });
  });

  it('cancels on Esc without changing the typed input', () => {
    expect(clearConfirmationKeyResult('YE', '', { escape: true })).toEqual({
      decision: false,
      value: 'YE',
    });
  });
});
