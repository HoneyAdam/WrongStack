import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ShellCommandWarning,
  truncateShellCommandWarningCommand,
} from '../src/components/shell-command-warning.js';

describe('truncateShellCommandWarningCommand', () => {
  it('returns short text unchanged', () => {
    expect(truncateShellCommandWarningCommand('ls -la')).toBe('ls -la');
  });

  it('truncates and adds ellipsis for long text', () => {
    const long = 'a'.repeat(100);
    const result = truncateShellCommandWarningCommand(long);
    expect(result).toBe(`${'a'.repeat(79)}…`);
    expect(result.length).toBe(80);
  });

  it('handles exact max length', () => {
    const exact = 'a'.repeat(80);
    expect(truncateShellCommandWarningCommand(exact)).toBe(exact);
  });

  it('handles empty string', () => {
    expect(truncateShellCommandWarningCommand('')).toBe('');
  });

  it('handles string at boundary (max=80 specified)', () => {
    const eighty = 'a'.repeat(80);
    expect(truncateShellCommandWarningCommand(eighty, 80)).toBe(eighty);
  });

  it('truncates with custom max', () => {
    const text = 'hello world';
    expect(truncateShellCommandWarningCommand(text, 5)).toBe('hell…');
  });
});

describe('ShellCommandWarning', () => {
  it('renders the warning header and command', () => {
    const view = render(
      React.createElement(ShellCommandWarning, {
        command: 'rm -rf /',
        onDecision: () => {},
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('SHELL COMMAND');
    expect(frame).toContain('rm -rf /');
    view.unmount();
  });

  it('renders the y/n/d buttons', () => {
    const view = render(
      React.createElement(ShellCommandWarning, {
        command: 'echo hello',
        onDecision: () => {},
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('[y]');
    expect(frame).toContain('[n]');
    expect(frame).toContain('[d]');
    expect(frame).toContain('es');
    expect(frame).toContain('o');
    expect(frame).toContain('ont show again');
    view.unmount();
  });

  it('renders the warning description text', () => {
    const view = render(
      React.createElement(ShellCommandWarning, {
        command: 'curl http://example.com',
        onDecision: () => {},
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('execute in your shell');
    expect(frame).toContain('Only run commands you trust');
    view.unmount();
  });

  it('calls onDecision with "yes" on "y" keypress', () => {
    const onDecision = vi.fn();
    const { stdin, unmount } = render(
      React.createElement(ShellCommandWarning, {
        command: 'ls',
        onDecision,
      }),
    );
    stdin.write('y');
    expect(onDecision).toHaveBeenCalledWith('yes');
    unmount();
  });

  it('calls onDecision with "no" on "n" keypress', () => {
    const onDecision = vi.fn();
    const { stdin, unmount } = render(
      React.createElement(ShellCommandWarning, {
        command: 'ls',
        onDecision,
      }),
    );
    stdin.write('n');
    expect(onDecision).toHaveBeenCalledWith('no');
    unmount();
  });

  it('calls onDecision with "dont-show-again" on "d" keypress', () => {
    const onDecision = vi.fn();
    const { stdin, unmount } = render(
      React.createElement(ShellCommandWarning, {
        command: 'ls',
        onDecision,
      }),
    );
    stdin.write('d');
    expect(onDecision).toHaveBeenCalledWith('dont-show-again');
    unmount();
  });

  it('ignores Enter key press', () => {
    const onDecision = vi.fn();
    const { stdin, unmount } = render(
      React.createElement(ShellCommandWarning, {
        command: 'ls',
        onDecision,
      }),
    );
    stdin.write('\r');
    expect(onDecision).not.toHaveBeenCalled();
    stdin.write('\n');
    expect(onDecision).not.toHaveBeenCalled();
    unmount();
  });

  it('uppercase Y resolves to yes (due to toLowerCase)', () => {
    const onDecision = vi.fn();
    const { stdin, unmount } = render(
      React.createElement(ShellCommandWarning, {
        command: 'ls',
        onDecision,
      }),
    );
    stdin.write('Y');
    expect(onDecision).toHaveBeenCalledWith('yes');
    unmount();
  });

  it('ignores non-matching keys like "x"', () => {
    const onDecision = vi.fn();
    const { stdin, unmount } = render(
      React.createElement(ShellCommandWarning, {
        command: 'ls',
        onDecision,
      }),
    );
    stdin.write('x');
    expect(onDecision).not.toHaveBeenCalled();
    unmount();
  });

  it('handles long command with truncation', () => {
    const longCmd = 'a'.repeat(200);
    const view = render(
      React.createElement(ShellCommandWarning, {
        command: longCmd,
        onDecision: () => {},
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('…');
    expect(frame.length).toBeGreaterThan(0);
    view.unmount();
  });
});
