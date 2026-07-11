/**
 * Tests for tui-thinking-word.ts — thinking word normalization.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUI_THINKING_WORD,
  MAX_TUI_THINKING_WORD_LENGTH,
  normalizeTuiThinkingWord,
} from '../src/tui-thinking-word.js';

describe('normalizeTuiThinkingWord', () => {
  it('returns default for non-string input', () => {
    expect(normalizeTuiThinkingWord(undefined)).toBe(DEFAULT_TUI_THINKING_WORD);
    expect(normalizeTuiThinkingWord(null)).toBe(DEFAULT_TUI_THINKING_WORD);
    expect(normalizeTuiThinkingWord(42)).toBe(DEFAULT_TUI_THINKING_WORD);
    expect(normalizeTuiThinkingWord(true)).toBe(DEFAULT_TUI_THINKING_WORD);
    expect(normalizeTuiThinkingWord({})).toBe(DEFAULT_TUI_THINKING_WORD);
  });

  it('returns default for empty string after trim', () => {
    expect(normalizeTuiThinkingWord('')).toBe(DEFAULT_TUI_THINKING_WORD);
    expect(normalizeTuiThinkingWord('   ')).toBe(DEFAULT_TUI_THINKING_WORD);
  });

  it('returns default for too-long words', () => {
    expect(normalizeTuiThinkingWord('a'.repeat(MAX_TUI_THINKING_WORD_LENGTH + 1))).toBe(
      DEFAULT_TUI_THINKING_WORD,
    );
  });

  it('accepts a word at the max length', () => {
    const word = 'a'.repeat(MAX_TUI_THINKING_WORD_LENGTH);
    expect(normalizeTuiThinkingWord(word)).toBe(word);
  });

  it('trims whitespace from input', () => {
    expect(normalizeTuiThinkingWord('  hello  ')).toBe('hello');
  });

  it('returns default for invalid characters (spaces in middle)', () => {
    expect(normalizeTuiThinkingWord('hello world')).toBe(DEFAULT_TUI_THINKING_WORD);
  });

  it('returns default for special characters', () => {
    expect(normalizeTuiThinkingWord('hello!')).toBe(DEFAULT_TUI_THINKING_WORD);
    expect(normalizeTuiThinkingWord('hello@world')).toBe(DEFAULT_TUI_THINKING_WORD);
    expect(normalizeTuiThinkingWord('test#')).toBe(DEFAULT_TUI_THINKING_WORD);
  });

  it('accepts unicode letters', () => {
    expect(normalizeTuiThinkingWord('café')).toBe('café');
    expect(normalizeTuiThinkingWord('über')).toBe('über');
  });

  it('accepts alphanumeric with underscores and hyphens', () => {
    expect(normalizeTuiThinkingWord('thinking')).toBe('thinking');
    expect(normalizeTuiThinkingWord('deep-thought')).toBe('deep-thought');
    expect(normalizeTuiThinkingWord('thinking_42')).toBe('thinking_42');
  });

  it('accepts single character word', () => {
    expect(normalizeTuiThinkingWord('a')).toBe('a');
  });

  it('exports DEFAULT_TUI_THINKING_WORD as thinking', () => {
    expect(DEFAULT_TUI_THINKING_WORD).toBe('thinking');
  });

  it('exports MAX_TUI_THINKING_WORD_LENGTH as 16', () => {
    expect(MAX_TUI_THINKING_WORD_LENGTH).toBe(16);
  });
});
