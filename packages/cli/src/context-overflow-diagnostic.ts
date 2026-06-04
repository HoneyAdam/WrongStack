import { ERROR_CODES, type WrongStackError } from '@wrongstack/core';

const CONTEXT_OVERFLOW_RE = /context window|exceeds the context|too many tokens|context.*tokens/i;

export function contextOverflowHint(err: WrongStackError): string | null {
  const structured =
    err.code === ERROR_CODES.PROVIDER_CONTEXT_OVERFLOW ||
    err.code === ERROR_CODES.AGENT_CONTEXT_OVERFLOW;
  const textual = CONTEXT_OVERFLOW_RE.test(`${err.message}\n${err.describe()}`);
  if (!structured && !textual) return null;

  return [
    'Provider rejected the request as over its effective context window.',
    'If you use a custom baseUrl/proxy, the real limit may be lower than models.dev reports.',
    'Try: /context limit 220k',
    'Then, if needed: /context thresholds 50% 70% 85%',
    'Persistent config: set context.effectiveMaxContext.',
  ].join('\n');
}
