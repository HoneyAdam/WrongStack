import { describe, expect, it } from 'vitest';
import {
  displayWidth,
  frameRule,
  padDisplayEnd,
  stripAnsi,
  truncateDisplay,
} from '../src/terminal-width.js';

describe('terminal column helpers', () => {
  it('measures ANSI, combining marks, CJK, emoji clusters, and Nerd Font PUA glyphs', () => {
    expect(displayWidth('\x1b[31mred\x1b[0m')).toBe(3);
    expect(displayWidth('e\u0301')).toBe(1);
    expect(displayWidth('界')).toBe(2);
    expect(displayWidth('👨‍👩‍👧‍👦')).toBe(2);
    expect(displayWidth('')).toBe(1);
  });

  it('truncates and pads by display columns instead of UTF-16 length', () => {
    expect(truncateDisplay('ab界cd', 5)).toBe('ab界…');
    expect(displayWidth(truncateDisplay('hello world', 6))).toBe(6);
    expect(displayWidth(padDisplayEnd('界', 5))).toBe(5);
  });

  it('builds exact-width labeled frame rails', () => {
    const top = frameRule(48, '◆ ASK WRONGSTACK', 'READY', 'top');
    const bottom = frameRule(48, 'Enter send · / commands', '', 'bottom');
    expect(displayWidth(top)).toBe(48);
    expect(displayWidth(bottom)).toBe(48);
    expect(stripAnsi(top)).toMatch(/^╭─ ◆ ASK WRONGSTACK .* READY ─╮$/);
    expect(bottom).toMatch(/^╰─ Enter send · \/ commands .*╯$/);
  });
});
