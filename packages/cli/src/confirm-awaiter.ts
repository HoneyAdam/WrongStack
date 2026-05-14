import type { InputReader } from '@wrongstack/core';
import { makePromptDelegate, type PromptDecision } from './permission-prompt.js';
import type { ConfirmAwaiter } from '@wrongstack/core';

/**
 * Create a ConfirmAwaiter for the CLI path. This wraps the existing
 * makePromptDelegate so it matches the ConfirmAwaiter type signature.
 */
export function makeConfirmAwaiter(reader: InputReader): ConfirmAwaiter {
  const delegate = makePromptDelegate(reader);
  return async (tool, input, _toolUseId, suggestedPattern): Promise<'yes' | 'no' | 'always' | 'deny'> => {
    const result = await delegate(tool, input, suggestedPattern);
    return result as 'yes' | 'no' | 'always' | 'deny';
  };
}