import * as path from 'node:path';
import type { Middleware } from '@wrongstack/core/kernel';
import type { ToolCallPipelinePayload } from '@wrongstack/core';
import { formatMemoryHintsDetailed } from '../retrieval/format.js';
import { normalizeTextKey } from './turn-memory.js';
import type { SuperMemory } from '../types.js';
import type { InjectionTracker } from './injection-tracker.js';

export interface SuperMemoryToolCallMiddlewareOptions {
  memory: SuperMemoryRetrieverLike;
  enabled?: boolean | undefined;
  maxHintsPerTool?: number | undefined;
  maxCharsPerTool?: number | undefined;
  minScore?: number | undefined;
  repeatCooldownMs?: number | undefined;
  verifyOnMutation?: boolean | undefined;
  triggers?: Partial<Record<MemoryToolTrigger, boolean>> | undefined;
  /**
   * Shared registry of recently injected memories, used by the turn
   * middleware to detect assistant references and credit `recordUse`.
   * No default: a private tracker here would register injections the turn
   * middleware could never match, silently dropping use signals.
   */
  tracker?: InjectionTracker | undefined;
}

export interface SuperMemoryRetrieverLike {
  retrieveForPath(opts: {
    path: string;
    limit?: number;
    includeAncestors?: boolean;
    includeStatuses?: SuperMemory['status'][];
    includeAudienceScoped?: boolean;
  }): Promise<SuperMemory[]>;
  searchSuper(query: string, opts?: { limit?: number; includeAudienceScoped?: boolean }): Promise<SuperMemory[]>;
  verifyForPaths?(paths: string[], signal?: AbortSignal): Promise<unknown>;
  recordInjection?(memoryIds: string[], trigger: string, sessionId?: string): void | Promise<void>;
  recordUse?(memoryIds: string[], source: string, sessionId?: string): void | Promise<void>;
}

export type SuperMemorySearchLike = Pick<
  SuperMemoryRetrieverLike,
  'searchSuper' | 'recordInjection' | 'recordUse'
>;

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
      try {
        if (nextPayload.result.is_error && nextPayload.toolUse.name !== 'bash') return nextPayload;

        const trigger = extractTrigger(nextPayload.toolUse.name, nextPayload.toolUse.input);
        if (!trigger) return nextPayload;
        if (opts.triggers?.[trigger.trigger] === false) return nextPayload;
        trigger.paths = resolveTriggerPaths(
          [...trigger.paths, ...extractResultPaths(nextPayload.result.content)],
          nextPayload.ctx,
        );

        if (
          opts.verifyOnMutation !== false
          && isMutationTrigger(trigger.trigger)
          && trigger.paths.length > 0
          && didMutate(nextPayload.toolUse.name, nextPayload.toolUse.input)
        ) {
          await opts.memory.verifyForPaths?.(trigger.paths, nextPayload.ctx.signal);
        }

        if (trigger.trigger === 'bash' && nextPayload.result.content) {
          trigger.queryText = `${trigger.queryText} ${nextPayload.result.content.slice(-2_000)}`;
        }

        const memories = await retrieveTriggeredMemories(opts.memory, trigger, opts.maxHintsPerTool ?? DEFAULT_MAX_HINTS);
        const minScore = opts.minScore ?? 0.65;
        const alreadyVisible = visibleContextText(nextPayload);
        const eligible = dedupeByText(memories).filter((memory) =>
          (normalizedInjectionScore(memory) >= minScore || memory.importance >= 0.95)
          && !containsMemoryText(alreadyVisible, memory.text));
        const sessionId = (nextPayload.ctx.session as { id?: string } | undefined)?.id;
        const fresh = applyCooldown(
          eligible,
          seen,
          opts.repeatCooldownMs ?? DEFAULT_REPEAT_COOLDOWN_MS,
          sessionId,
        );
        if (fresh.length === 0) return nextPayload;

        const maxChars = availableHintChars(
          nextPayload,
          opts.maxCharsPerTool ?? DEFAULT_MAX_CHARS,
        );
        const rendered = formatMemoryHintsDetailed(fresh.slice(0, opts.maxHintsPerTool ?? DEFAULT_MAX_HINTS), {
          maxChars,
        });
        if (!rendered.text || rendered.memoryIds.length === 0) return nextPayload;

        const content = `${nextPayload.result.content.replace(/\s+$/, '')}\n\n${rendered.text}`;
        nextPayload.result.content = content;
        // The agent loop intentionally observes mutations on the original
        // ToolResultBlock and ignores a pipeline replacement return value.
        // Preserve injection even if a downstream plugin cloned the payload.
        payload.result.content = content;
        const now = Date.now();
        for (const memoryId of rendered.memoryIds) seen.set(cooldownKey(memoryId, sessionId), now);
        pruneCooldowns(seen, now, opts.repeatCooldownMs ?? DEFAULT_REPEAT_COOLDOWN_MS);
        if (opts.tracker) {
          const injectedById = new Map(fresh.map((memory) => [memory.id, memory]));
          for (const memoryId of rendered.memoryIds) {
            const memory = injectedById.get(memoryId);
            if (memory) opts.tracker.record(memoryId, memory.text, now);
          }
        }
        await opts.memory.recordInjection?.(
          rendered.memoryIds,
          trigger.trigger,
          sessionId,
        );
        return nextPayload;
      } catch {
        // Memory is advisory. Storage/retrieval failure must never turn a
        // successful filesystem or command tool call into an agent failure.
        return nextPayload;
      }
    },
  };
}

async function retrieveTriggeredMemories(
  memory: SuperMemoryRetrieverLike,
  trigger: ExtractedTriggerContext,
  limit: number,
): Promise<SuperMemory[]> {
  // Path lookups and the lexical query lookup are independent reads — run
  // them concurrently instead of serially awaiting each path in turn.
  // Promise.all preserves the previous failure mode: any rejection rejects
  // the whole retrieve, which the handler's outer try/catch turns into
  // "no injection" (memory is advisory).
  const pending: Array<Promise<SuperMemory[]>> = trigger.paths.map((p) =>
    memory.retrieveForPath({
      path: p,
      limit,
      includeAncestors: true,
      includeStatuses: isMutationTrigger(trigger.trigger) ? ['active', 'stale', 'deleted'] : ['active', 'deleted'],
      includeAudienceScoped: false,
    }),
  );
  if (trigger.queryText.trim()) {
    pending.push(memory.searchSuper(trigger.queryText, {
      limit,
      includeAudienceScoped: false,
    }));
  }
  const byId = new Map<string, SuperMemory>();
  for (const matches of await Promise.all(pending)) {
    for (const item of matches) byId.set(item.id, item);
  }

  return [...byId.values()]
    .filter((item) => (item.status === 'active' || item.status === 'stale' || item.status === 'deleted') && item.contextPolicy !== 'never')
    .sort((a, b) => scoreForInjection(b) - scoreForInjection(a));
}

function applyCooldown(
  memories: SuperMemory[],
  seen: Map<string, number>,
  cooldownMs: number,
  sessionId?: string,
): SuperMemory[] {
  const now = Date.now();
  return memories.filter((memory) => {
    const last = seen.get(cooldownKey(memory.id, sessionId));
    if (!last) return true;
    if (now - last >= cooldownMs) return true;
    return memory.importance >= 0.95 && now - last >= Math.min(cooldownMs, 5 * 60_000);
  });
}

function cooldownKey(memoryId: string, sessionId?: string): string {
  return `${sessionId ?? '<no-session>'}:${memoryId}`;
}

function pruneCooldowns(seen: Map<string, number>, now: number, cooldownMs: number): void {
  if (seen.size <= 10_000) return;
  const oldestUseful = now - Math.max(cooldownMs, 60 * 60_000);
  for (const [key, at] of seen) {
    if (at < oldestUseful) seen.delete(key);
  }
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

function didMutate(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'replace') return input['dry_run'] === false;
  if (toolName === 'patch') return input['dry_run'] !== true;
  return true;
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
        paths: stringValues(input.path ?? '.'),
        queryText: [input.pattern, input.glob, input.path].filter(isString).join(' '),
      };
    case 'glob':
      return {
        trigger: 'glob',
        paths: stringValues(input.path ?? '.'),
        queryText: [input.pattern, input.glob, input.path].filter(isString).join(' '),
      };
    case 'codebase_search':
    case 'codebase-search':
      return {
        trigger: 'codebase_search',
        paths: stringValues(input.path),
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
      return {
        trigger: 'edit',
        paths: stringValues(input.path),
        queryText: stringValues(input.path).join(' '),
      };
    case 'replace': {
      const files = stringValues(input.files).flatMap(splitFileList);
      return {
        trigger: 'edit',
        paths: files,
        queryText: [...files, ...stringValues(input.pattern), ...stringValues(input.glob)].join(' '),
      };
    }
    case 'patch':
      return {
        trigger: 'patch',
        paths: extractPatchPaths(input),
        queryText: [input.directory, ...extractPatchPaths(input)].filter(isString).join(' '),
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

function splitFileList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function extractPatchPaths(input: Record<string, unknown>): string[] {
  if (typeof input.patch !== 'string') return [];
  const strip = Math.max(1, Math.floor(typeof input.strip === 'number' ? input.strip : 1));
  const directory = typeof input.directory === 'string' ? input.directory.trim() : '';
  const result: string[] = [];
  for (const match of input.patch.matchAll(/^\+\+\+\s+([^\t\r\n]+)/gm)) {
    const raw = match[1]?.trim();
    if (!raw || raw === '/dev/null') continue;
    const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const stripped = normalized.split('/').filter(Boolean).slice(strip).join('/');
    if (!stripped) continue;
    result.push(directory ? path.join(directory, stripped) : stripped);
  }
  return [...new Set(result)];
}

function extractResultPaths(content: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return [];
  }
  const result: string[] = [];
  const visit = (current: unknown, key?: string): void => {
    if (typeof current === 'string') {
      if (key === 'path' || key === 'file' || key === 'file_path' || key === 'files') result.push(current);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, key);
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) {
      if (childKey === 'results' || childKey === 'files' || childKey === 'paths' || childKey === 'path' || childKey === 'file' || childKey === 'file_path') {
        visit(child, childKey === 'paths' ? 'path' : childKey);
      }
    }
  };
  visit(value);
  return result;
}

function resolveTriggerPaths(
  values: string[],
  ctx: ToolCallPipelinePayload['ctx'],
): string[] {
  const root = path.resolve(ctx.projectRoot);
  const base = path.resolve(ctx.workingDir ?? ctx.cwd ?? ctx.projectRoot);
  const result: string[] = [];
  for (const value of values) {
    // Glob patterns are useful lexical query text but cannot be mapped to one
    // concrete anchor safely.
    if (/[*?{}[\]]/.test(value)) continue;
    const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(base, value);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    result.push(absolute);
  }
  return [...new Set(result)];
}

function visibleContextText(payload: ToolCallPipelinePayload): string {
  const prompt = (payload.ctx as unknown as { systemPrompt?: Array<{ text?: string }> }).systemPrompt;
  return [
    payload.result.content,
    ...(prompt ?? []).map((block) => block.text ?? ''),
  ].join('\n').toLowerCase();
}

function containsMemoryText(haystack: string, memoryText: string): boolean {
  return haystack.includes(memoryText.toLowerCase());
}

function dedupeByText(memories: SuperMemory[]): SuperMemory[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    const key = normalizeTextKey(memory.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function availableHintChars(payload: ToolCallPipelinePayload, configured: number): number {
  const wanted = Math.max(0, Math.floor(configured));
  const cap = payload.tool?.maxOutputBytes;
  if (!cap) return wanted;
  const remainingBytes = cap - Buffer.byteLength(payload.result.content, 'utf8') - 2;
  // A conservative char budget keeps UTF-8 hints inside the tool's byte cap.
  return Math.max(0, Math.min(wanted, Math.floor(remainingBytes / 3)));
}
