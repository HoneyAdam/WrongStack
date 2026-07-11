import type { Middleware } from '@wrongstack/core/kernel';
import type { Message, Request } from '@wrongstack/core';
import { formatMemoryHints } from '../retrieval/format.js';
import type { SuperMemoryRetrieverLike } from './tool-call-memory.js';

export interface SuperMemoryTurnMiddlewareOptions {
  memory: SuperMemoryRetrieverLike;
  maxMemories?: number | undefined;
  maxChars?: number | undefined;
  minScore?: number | undefined;
}

export function createSuperMemoryTurnMiddleware(
  opts: SuperMemoryTurnMiddlewareOptions,
): Middleware<Request> {
  return {
    name: 'super-memory.turn-context',
    owner: 'super-memory',
    async handler(request, next) {
      const query = lastUserText(request.messages);
      if (!query) return next(request);
      const memories = await opts.memory.searchSuper(query, { limit: opts.maxMemories ?? 8 });
      const minScore = opts.minScore ?? 0.65;
      const eligible = memories.filter((memory) => {
        const score = (memory.importance * 3 + memory.confidence * 2 + memory.freshness) / 6;
        return score >= minScore || memory.importance >= 0.95;
      });
      const block = formatMemoryHints(eligible, { maxChars: opts.maxChars ?? 2_400 });
      if (!block) return next(request);
      opts.memory.recordInjection?.(eligible.map((memory) => memory.id), 'turn_context');
      return next({
        ...request,
        system: [...(request.system ?? []), { type: 'text', text: block }],
      });
    },
  };
}

function lastUserText(messages: Message[]): string {
  const message = [...messages].reverse().find((item) => item.role === 'user');
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim();
}
