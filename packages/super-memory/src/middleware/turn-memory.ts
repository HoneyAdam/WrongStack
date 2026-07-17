import type { Middleware } from '@wrongstack/core/kernel';
import type { Message, Request } from '@wrongstack/core';
import { formatMemoryHintsDetailed } from '../retrieval/format.js';
import { tokenize } from '../store-helpers.js';
import { InjectionTracker } from './injection-tracker.js';
import type { SuperMemorySearchLike } from './tool-call-memory.js';

// Re-exported to keep the public API stable: callers import `tokenize` from
// this module (or the package index). The single implementation lives in
// store-helpers.ts — see its docblock for the tokenizer invariants.
export { tokenize };

export interface SuperMemoryTurnMiddlewareOptions {
  memory: SuperMemorySearchLike;
  maxMemories?: number | undefined;
  maxChars?: number | undefined;
  minScore?: number | undefined;
  /**
   * Weight given to the metadata score floor (0–1).
   * The final score is `metadataScore * (metadataWeight + relevance * (1 - metadataWeight))`.
   * At 0.0, relevance fully gates injection. At 1.0, metadata alone decides (pre-relevance behavior).
   * Default: 0.3 — validated against 148 real query-memory pairs (see commit history).
   */
  metadataWeight?: number | undefined;
  /**
   * Registry of recently injected memories used to detect assistant
   * references and credit `recordUse`. Pass the same instance to the
   * tool-call middleware so tool-result injections are matchable too.
   * Defaults to a private tracker (turn-context injections only).
   */
  tracker?: InjectionTracker | undefined;
}

export function createSuperMemoryTurnMiddleware(
  opts: SuperMemoryTurnMiddlewareOptions,
): Middleware<Request> {
  const tracker = opts.tracker ?? new InjectionTracker();
  return {
    name: 'super-memory.turn-context',
    owner: 'super-memory',
    async handler(request, next) {
      let nextRequest = request;
      try {
        // Close the feedback loop first: if the previous assistant step
        // referenced a memory we injected earlier, credit the use before
        // registering this turn's injections.
        const assistantText = lastAssistantText(request.messages);
        if (assistantText) {
          const used = tracker.consumeMatches(assistantText);
          if (used.length > 0) await opts.memory.recordUse?.(used, 'assistant_reference');
        }
        const query = lastUserText(request.messages);
        if (query) {
          const memories = await opts.memory.searchSuper(query, {
            limit: opts.maxMemories ?? 8,
            includeAudienceScoped: false,
          });
          const minScore = opts.minScore ?? 0.65;
          const metadataWeight = opts.metadataWeight ?? 0.3;
          const existingSystem = (request.system ?? [])
            .map((block) => block.type === 'text' ? normalizeTextKey(block.text) : '')
            .join('\n');
          const seenText = new Set<string>();
          const eligible = memories.filter((memory) => {
            const textKey = normalizeTextKey(memory.text);
            if (seenText.has(textKey) || existingSystem.includes(textKey)) return false;
            const metadataScore = (memory.importance * 3 + memory.confidence * 2 + memory.freshness) / 6;
            const relevance = overlapCoefficient(query.toLowerCase(), textKey);
            const score = metadataScore * (metadataWeight + relevance * (1 - metadataWeight));
            const accepted = score >= minScore || memory.importance >= 0.95;
            if (accepted) seenText.add(textKey);
            return accepted;
          });
          const rendered = formatMemoryHintsDetailed(eligible, { maxChars: opts.maxChars ?? 2_400 });
          if (rendered.text) {
            await opts.memory.recordInjection?.(rendered.memoryIds, 'turn_context');
            const renderedIds = new Set(rendered.memoryIds);
            for (const memory of eligible) {
              if (renderedIds.has(memory.id)) tracker.record(memory.id, memory.text);
            }
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

function lastAssistantText(messages: Message[]): string {
  const message = [...messages].reverse().find((item) => item.role === 'assistant');
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim();
}

/**
 * Normalize text for deduplication and comparison.
 * Applies NFKC normalization, lowercasing, whitespace collapse, and trim
 * so that strings differing only in unicode form, case, or spacing compare equal.
 */
export function normalizeTextKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Compute the overlap coefficient (Szymkiewicz–Simpson) between two strings
 * based on their token sets. Returns 0..1 where 1 means every token in the
 * shorter string also appears in the longer one.
 *
 * Unlike Jaccard, this doesn't penalize the longer string for having extra
 * tokens — a memory with rich detail that fully covers the query scores high.
 */
export function overlapCoefficient(query: string, text: string): number {
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
