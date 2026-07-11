import type { Middleware } from '@wrongstack/core/kernel';
import type { Message, Request } from '@wrongstack/core';
import { formatMemoryHintsDetailed } from '../retrieval/format.js';
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
      let nextRequest = request;
      try {
        const query = lastUserText(request.messages);
        if (query) {
          const memories = await opts.memory.searchSuper(query, { limit: opts.maxMemories ?? 8 });
          const minScore = opts.minScore ?? 0.65;
          const existingSystem = (request.system ?? [])
            .map((block) => block.type === 'text' ? block.text.toLowerCase() : '')
            .join('\n');
          const seenText = new Set<string>();
          const eligible = memories.filter((memory) => {
            const textKey = memory.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
            if (seenText.has(textKey) || existingSystem.includes(memory.text.toLowerCase())) return false;
            const score = (memory.importance * 3 + memory.confidence * 2 + memory.freshness) / 6;
            const accepted = score >= minScore || memory.importance >= 0.95;
            if (accepted) seenText.add(textKey);
            return accepted;
          });
          const rendered = formatMemoryHintsDetailed(eligible, { maxChars: opts.maxChars ?? 2_400 });
          if (rendered.text) {
            await opts.memory.recordInjection?.(rendered.memoryIds, 'turn_context');
            nextRequest = {
              ...request,
              system: [...(request.system ?? []), { type: 'text', text: rendered.text }],
            };
          }
        }
      } catch {
        nextRequest = request;
      }
      return next(nextRequest);
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
