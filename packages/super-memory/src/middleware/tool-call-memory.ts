import type { Middleware } from '@wrongstack/core/kernel';
import type { ToolCallPipelinePayload } from '@wrongstack/core';
import { formatMemoryHints } from '../retrieval/format.js';
import type { SuperMemory } from '../types.js';

export interface SuperMemoryToolCallMiddlewareOptions {
  memory: SuperMemoryRetrieverLike;
  enabled?: boolean | undefined;
  maxHintsPerTool?: number | undefined;
  maxCharsPerTool?: number | undefined;
  minScore?: number | undefined;
  repeatCooldownMs?: number | undefined;
  triggers?: Partial<Record<MemoryToolTrigger, boolean>> | undefined;
}

export interface SuperMemoryRetrieverLike {
  retrieveForPath(opts: { path: string; limit?: number; includeAncestors?: boolean }): Promise<SuperMemory[]>;
  searchSuper(query: string, opts?: { limit?: number }): Promise<SuperMemory[]>;
  verifyForPaths?(paths: string[]): Promise<unknown>;
  recordInjection?(memoryIds: string[], trigger: string, sessionId?: string): void;
}

export type MemoryToolTrigger =
  | 'read'
  | 'tree'
  | 'grep'
  | 'glob'
  | 'codebase_search'
  | 'bash'
  | 'write'
  | 'edit'
  | 'patch';

interface ExtractedTriggerContext {
  trigger: MemoryToolTrigger;
  paths: string[];
  queryText: string;
}

const DEFAULT_MAX_HINTS = 4;
const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_REPEAT_COOLDOWN_MS = 30 * 60_000;

export function createSuperMemoryToolCallMiddleware(
  opts: SuperMemoryToolCallMiddlewareOptions,
): Middleware<ToolCallPipelinePayload> {
  const seen = new Map<string, number>();
  return {
    name: 'super-memory.tool-result-injection',
    owner: 'super-memory',
    async handler(payload, next) {
      const nextPayload = await next(payload);
      if (opts.enabled === false) return nextPayload;
      if (nextPayload.result.is_error && nextPayload.toolUse.name !== 'bash') return nextPayload;

      const trigger = extractTrigger(nextPayload.toolUse.name, nextPayload.toolUse.input);
      if (!trigger) return nextPayload;
      if (opts.triggers?.[trigger.trigger] === false) return nextPayload;

      if (isMutationTrigger(trigger.trigger) && trigger.paths.length > 0) {
        await opts.memory.verifyForPaths?.(trigger.paths);
      }

      if (trigger.trigger === 'bash' && nextPayload.result.content) {
        trigger.queryText = `${trigger.queryText} ${nextPayload.result.content.slice(-2_000)}`;
      }

      const memories = await retrieveTriggeredMemories(opts.memory, trigger, opts.maxHintsPerTool ?? DEFAULT_MAX_HINTS);
      const minScore = opts.minScore ?? 0.65;
      const eligible = memories.filter((memory) => normalizedInjectionScore(memory) >= minScore || memory.importance >= 0.95);
      const fresh = applyCooldown(eligible, seen, opts.repeatCooldownMs ?? DEFAULT_REPEAT_COOLDOWN_MS);
      if (fresh.length === 0) return nextPayload;

      const block = formatMemoryHints(fresh.slice(0, opts.maxHintsPerTool ?? DEFAULT_MAX_HINTS), {
        maxChars: opts.maxCharsPerTool ?? DEFAULT_MAX_CHARS,
      });
      if (!block) return nextPayload;

      nextPayload.result.content = `${nextPayload.result.content.replace(/\s+$/, '')}\n\n${block}`;
      const now = Date.now();
      for (const memory of fresh) seen.set(memory.id, now);
      opts.memory.recordInjection?.(
        fresh.map((memory) => memory.id),
        trigger.trigger,
        (nextPayload.ctx.session as { id?: string } | undefined)?.id,
      );
      return nextPayload;
    },
  };
}

async function retrieveTriggeredMemories(
  memory: SuperMemoryRetrieverLike,
  trigger: ExtractedTriggerContext,
  limit: number,
): Promise<SuperMemory[]> {
  const byId = new Map<string, SuperMemory>();
  for (const p of trigger.paths) {
    const pathMatches = await memory.retrieveForPath({
      path: p,
      limit,
      includeAncestors: true,
    });
    for (const item of pathMatches) byId.set(item.id, item);
  }

  if (trigger.queryText.trim()) {
    const queryMatches = await memory.searchSuper(trigger.queryText, { limit });
    for (const item of queryMatches) byId.set(item.id, item);
  }

  return [...byId.values()]
    .filter((item) => item.status === 'active' || item.status === 'stale')
    .sort((a, b) => scoreForInjection(b) - scoreForInjection(a));
}

function applyCooldown(
  memories: SuperMemory[],
  seen: Map<string, number>,
  cooldownMs: number,
): SuperMemory[] {
  const now = Date.now();
  return memories.filter((memory) => {
    const last = seen.get(memory.id);
    if (!last) return true;
    if (now - last >= cooldownMs) return true;
    return memory.importance >= 0.95 && now - last >= Math.min(cooldownMs, 5 * 60_000);
  });
}

function scoreForInjection(memory: SuperMemory): number {
  return memory.importance * 3 + memory.confidence * 2 + memory.freshness;
}

function normalizedInjectionScore(memory: SuperMemory): number {
  return scoreForInjection(memory) / 6;
}

function isMutationTrigger(trigger: MemoryToolTrigger): boolean {
  return trigger === 'write' || trigger === 'edit' || trigger === 'patch';
}

function extractTrigger(toolName: string, input: Record<string, unknown>): ExtractedTriggerContext | undefined {
  switch (toolName) {
    case 'read':
      return {
        trigger: 'read',
        paths: stringValues(input.path),
        queryText: stringValues(input.path).join(' '),
      };
    case 'tree':
      return {
        trigger: 'tree',
        paths: stringValues(input.path ?? '.'),
        queryText: stringValues(input.path ?? '.').join(' '),
      };
    case 'grep':
      return {
        trigger: 'grep',
        paths: stringValues(input.path),
        queryText: [input.pattern, input.glob, input.path].filter(isString).join(' '),
      };
    case 'glob':
      return {
        trigger: 'glob',
        paths: stringValues(input.path),
        queryText: [input.pattern, input.glob, input.path].filter(isString).join(' '),
      };
    case 'codebase_search':
    case 'codebase-search':
      return {
        trigger: 'codebase_search',
        paths: [],
        queryText: [input.query, input.q, input.path].filter(isString).join(' '),
      };
    case 'bash':
    case 'exec':
      return {
        trigger: 'bash',
        paths: [],
        queryText: stringValues(input.command ?? input.cmd).join(' '),
      };
    case 'write':
      return {
        trigger: 'write',
        paths: stringValues(input.path),
        queryText: stringValues(input.path).join(' '),
      };
    case 'edit':
    case 'replace':
      return {
        trigger: 'edit',
        paths: stringValues(input.path),
        queryText: stringValues(input.path).join(' '),
      };
    case 'patch':
      return {
        trigger: 'patch',
        paths: stringValues(input.path ?? input.file),
        queryText: [input.path, input.file].filter(isString).join(' '),
      };
    default:
      return undefined;
  }
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.filter(isString).map((v) => v.trim()).filter(Boolean);
  return [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
