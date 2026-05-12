import type { StopReason } from '@wrongstack/core';

export function normalizeAnthropic(stop: string | null | undefined): StopReason {
  switch (stop) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'refusal':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

export function normalizeOpenAI(stop: string | null | undefined): StopReason {
  switch (stop) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}
