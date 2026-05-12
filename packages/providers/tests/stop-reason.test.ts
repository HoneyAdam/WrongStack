import { describe, it, expect } from 'vitest';
import {
  normalizeAnthropic,
  normalizeOpenAI,
} from '../src/stop-reason.js';

describe('stop-reason', () => {
  describe('normalizeAnthropic', () => {
    it('maps end_turn', () => expect(normalizeAnthropic('end_turn')).toBe('end_turn'));
    it('maps tool_use', () => expect(normalizeAnthropic('tool_use')).toBe('tool_use'));
    it('maps max_tokens', () => expect(normalizeAnthropic('max_tokens')).toBe('max_tokens'));
    it('maps stop_sequence', () => expect(normalizeAnthropic('stop_sequence')).toBe('stop_sequence'));
    it('maps refusal', () => expect(normalizeAnthropic('refusal')).toBe('refusal'));
    it('unknown value falls back to end_turn', () => {
      expect(normalizeAnthropic('bogus')).toBe('end_turn');
      expect(normalizeAnthropic(null)).toBe('end_turn');
      expect(normalizeAnthropic(undefined)).toBe('end_turn');
    });
  });

  describe('normalizeOpenAI', () => {
    it('maps stop to end_turn', () => expect(normalizeOpenAI('stop')).toBe('end_turn'));
    it('maps tool_calls to tool_use', () => expect(normalizeOpenAI('tool_calls')).toBe('tool_use'));
    it('maps function_call to tool_use', () => expect(normalizeOpenAI('function_call')).toBe('tool_use'));
    it('maps length to max_tokens', () => expect(normalizeOpenAI('length')).toBe('max_tokens'));
    it('maps content_filter to refusal', () => expect(normalizeOpenAI('content_filter')).toBe('refusal'));
    it('unknown value falls back to end_turn', () => {
      expect(normalizeOpenAI('unknown')).toBe('end_turn');
      expect(normalizeOpenAI(null)).toBe('end_turn');
      expect(normalizeOpenAI(undefined)).toBe('end_turn');
    });
  });
});