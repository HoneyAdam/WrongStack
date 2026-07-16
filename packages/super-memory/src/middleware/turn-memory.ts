import type { Middleware } from '@wrongstack/core/kernel';
import type { Message, Request } from '@wrongstack/core';
import { formatMemoryHintsDetailed } from '../retrieval/format.js';
import type { SuperMemorySearchLike } from './tool-call-memory.js';

export interface SuperMemoryTurnMiddlewareOptions {
  memory: SuperMemorySearchLike;
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
          const memories = await opts.memory.searchSuper(query, {
            limit: opts.maxMemories ?? 8,
            includeAudienceScoped: false,
          });
          const minScore = opts.minScore ?? 0.65;
          const existingSystem = (request.system ?? [])
            .map((block) => block.type === 'text' ? block.text.toLowerCase() : '')
            .join('\n');
          const seenText = new Set<string>();
          const eligible = memories.filter((memory) => {
            const textKey = memory.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
            if (seenText.has(textKey) || existingSystem.includes(memory.text.toLowerCase())) return false;
            const metadataScore = (memory.importance * 3 + memory.confidence * 2 + memory.freshness) / 6;
            const relevance = overlapCoefficient(query.toLowerCase(), textKey);
            const score = metadataScore * (0.3 + relevance * 0.7);
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

/**
 * Compute the overlap coefficient (Szymkiewicz–Simpson) between two strings
 * based on their token sets. Returns 0..1 where 1 means every token in the
 * shorter string also appears in the longer one.
 *
 * Unlike Jaccard, this doesn't penalize the longer string for having extra
 * tokens — a memory with rich detail that fully covers the query scores high.
 */
function overlapCoefficient(query: string, text: string): number {
  const queryTokens = new Set(tokenize(query));
  const textTokens = new Set(tokenize(text));
  if (queryTokens.size === 0 || textTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) intersection++;
  }
  const smaller = Math.min(queryTokens.size, textTokens.size);
  return intersection / smaller;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}
