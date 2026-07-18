import { createHash } from 'node:crypto';
import type { EventBus } from '../kernel/events.js';
import type { ChronicleContext } from './context.js';
import type { ChronicleJournal } from './journal.js';
import type { ChronicleEventInput, ChronicleOutcome, ChronicleResourceRef } from './types.js';

export interface ChronicleDomainAdapterOptions {
  events: EventBus; journal: ChronicleJournal; context: ChronicleContext | (() => ChronicleContext);
  onPersistError?: ((error: unknown, event: ChronicleEventInput) => void) | undefined;
}

const SPECIALIZED = [
  /^provider\.attempt\./, /^tool\./, /^process\./, /^brain\.decision_/,
  /^brain\.human_answered$/, /^brain\.outcome$/, /^file\.activity$/,
  /^provider\.(?:text_delta|thinking_delta)$/,
  /^(?:ctx\.pct|subagent\.ctx_pct|countdown\.tick|coordinator\.stats)$/,
];
/**
 * Only domains that can improve coding decisions, provenance, reliability or
 * resource/cost control belong in Chronicle. UI presence, navigation and other
 * product-engagement events are intentionally not captured by this bridge.
 */
const CODING_SIGNAL = [
  /^(?:agent|subagent|delegate|fleet)\./,
  /^(?:session|iteration|context|compaction|checkpoint|in_flight)\./,
  /^(?:memory|storage|trust)\./,
  /^(?:sdd|worktree)\./,
  /^(?:brain|token|budget|concurrency)\./,
  /^(?:provider|mcp|network)\./,
  /^error$/,
];
const SENSITIVE_KEY = /(content|text|prompt|question|rationale|reason|detail|summary|description|context|input|output|error|message|secret|token|password|key)$/i;
const PRESERVE_STRING_KEY = /(^|_)(id|status|state|kind|type|source|model|provider|phase|risk|fallback|path|name|role|sha|branch|mode)$/i;

/** Allowlisted coding-signal bridge for domains not owned by a richer adapter. */
export function wireDomainEventsToChronicle(options: ChronicleDomainAdapterOptions): () => void {
  return options.events.onAny((eventName, payload) => {
    if (SPECIALIZED.some((pattern) => pattern.test(eventName))) return;
    if (!CODING_SIGNAL.some((pattern) => pattern.test(eventName))) return;
    const context = typeof options.context === 'function' ? options.context() : options.context;
    const record = objectPayload(payload);
    const sessionId = stringField(record, 'sessionId');
    const agentId = stringField(record, 'agentId') ?? stringField(record, 'subagentId');
    const taskId = stringField(record, 'taskId');
    const input: ChronicleEventInput = {
      eventType: eventName,
      occurredAt: eventTime(record),
      scope: { ...context.scope, ...(sessionId ? { sessionId } : {}), ...(agentId ? { agentId } : {}), ...(taskId ? { taskId } : {}) },
      correlation: {
        ...context.correlation,
        ...(stringField(record, 'traceId') ? { traceId: stringField(record, 'traceId')! } : {}),
        ...(stringField(record, 'toolCallId') ? { toolCallId: stringField(record, 'toolCallId') } : {}),
        ...(stringField(record, 'attemptId') ? { attemptId: stringField(record, 'attemptId') } : {}),
        ...(stringField(record, 'logicalRequestId') ? { logicalRequestId: stringField(record, 'logicalRequestId') } : {}),
      },
      outcome: inferOutcome(eventName, record),
      runtime: {
        ...(stringField(record, 'providerId') ?? stringField(record, 'provider') ? { providerId: stringField(record, 'providerId') ?? stringField(record, 'provider') } : {}),
        ...(stringField(record, 'modelId') ?? stringField(record, 'model') ? { modelId: stringField(record, 'modelId') ?? stringField(record, 'model') } : {}),
      },
      resource: inferResource(record),
      attributes: sanitize(record) as Record<string, unknown>,
      tags: { collector: 'eventbus-domain', family: eventName.split('.')[0] ?? 'unknown' },
    };
    void options.journal.append(input).catch((error) => options.onPersistError?.(error, input));
  });
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : { value };
}
function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] as string : undefined;
}
function eventTime(value: Record<string, unknown>): string | undefined {
  const raw = value.at ?? value.ts ?? value.timestamp;
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw).toISOString();
  if (typeof raw === 'string' && Number.isFinite(Date.parse(raw))) return new Date(raw).toISOString();
  return undefined;
}
function inferOutcome(name: string, payload: Record<string, unknown>): ChronicleOutcome {
  if (payload.ok === false || /(?:failed|error|damaged|conflict|deadlock|denied|rejected|blocked)$/.test(name)) return 'failure';
  if (/(?:started|starting|retrying|threshold_reached)$/.test(name)) return 'started';
  if (/(?:cancelled|aborted)$/.test(name)) return 'cancelled';
  if (/(?:completed|finished|committed|merged|written|persisted|accepted|recovered|verified|connected|success)$/.test(name) || payload.ok === true) return 'success';
  return 'unknown';
}
function inferResource(payload: Record<string, unknown>): ChronicleResourceRef | undefined {
  const candidates: Array<[ChronicleResourceRef['kind'], string, unknown]> = [
    ['memory', 'memoryId', payload.memoryId], ['task', 'taskId', payload.taskId],
    ['kanban', 'boardId', payload.boardId ?? payload.runId], ['artifact', 'worktreeId', payload.worktreeId ?? payload.handleId],
    ['file', 'path', payload.filePath ?? payload.path], ['other', 'agentId', payload.agentId ?? payload.subagentId],
    ['network', 'serverAddress', payload.serverAddress],
    ['other', 'sessionId', payload.sessionId],
  ];
  const found = candidates.find(([, , value]) => typeof value === 'string' && value.length > 0);
  if (!found) return undefined;
  const [kind, label, value] = found as [ChronicleResourceRef['kind'], string, string];
  return { kind, id: `${label}:${value}`, ...(kind === 'file' ? { path: value } : {}) };
}

function sanitize(value: unknown, key = '', depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return { type: 'function' };
  if (typeof value === 'string') {
    if (PRESERVE_STRING_KEY.test(key) && !SENSITIVE_KEY.test(key)) return value.slice(0, 512);
    if (SENSITIVE_KEY.test(key)) return { hash: digest(value), length: value.length, redacted: true };
    return value.length <= 256 ? value : { hash: digest(value), length: value.length, truncated: true };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return { circular: true };
  if (depth >= 5) return { hash: digest(safeString(value)), depthLimited: true };
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => sanitize(item, key, depth + 1, seen));
    return value.length > 100 ? { items, total: value.length, truncated: true } : items;
  }
  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [childKey, child] of entries.slice(0, 100)) {
    if (childKey === 'ctx' || childKey === 'provider' || childKey === 'resolve' || childKey === 'extend' || childKey === 'deny') continue;
    output[childKey] = sanitize(child, childKey, depth + 1, seen);
  }
  if (entries.length > 100) output._truncatedKeys = entries.length - 100;
  return output;
}
function safeString(value: unknown): string { try { return JSON.stringify(value) ?? String(value); } catch { return String(value); } }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
