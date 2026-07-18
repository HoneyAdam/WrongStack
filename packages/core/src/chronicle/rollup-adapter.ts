import { createHash } from 'node:crypto';
import type { EventBus } from '../kernel/events.js';
import type { ChronicleContext } from './context.js';
import type { ChronicleJournal } from './journal.js';
import type { ChronicleEventInput } from './types.js';

export interface ChronicleRollupAdapterOptions {
  events: EventBus; journal: ChronicleJournal; context: ChronicleContext | (() => ChronicleContext);
  windowMs?: number; onPersistError?: ((error: unknown, event: ChronicleEventInput) => void) | undefined;
}
interface Bucket { signal: string; sessionId?: string; agentId?: string; toolCallId?: string;
  dimensions: Record<string, string>; startedAt: number; updatedAt: number; count: number;
  metrics: Record<string, { sum: number; min: number; max: number; last: number }>;
  categories: Record<string, number>; digest: ReturnType<typeof createHash> }

/** Converts high-frequency ephemeral signals into bounded window aggregates before persistence. */
export function wireRollupsToChronicle(options: ChronicleRollupAdapterOptions): () => void {
  const buckets = new Map<string, Bucket>(); const windowMs = Math.max(1_000, options.windowMs ?? 10_000);
  const bucket = (key: string, seed: Omit<Bucket, 'startedAt'|'updatedAt'|'count'|'metrics'|'categories'|'digest'>) => {
    let value = buckets.get(key); if (!value) { const now = Date.now(); value = { ...seed, startedAt: now, updatedAt: now,
      count: 0, metrics: {}, categories: {}, digest: createHash('sha256') }; buckets.set(key, value); } return value;
  };
  const sample = (target: Bucket, values: Record<string, number>, category?: string, digest?: string) => {
    target.count++; target.updatedAt = Date.now();
    for (const [name, value] of Object.entries(values)) { const metric = target.metrics[name];
      target.metrics[name] = metric ? { sum: metric.sum + value, min: Math.min(metric.min, value), max: Math.max(metric.max, value), last: value }
        : { sum: value, min: value, max: value, last: value }; }
    if (category) target.categories[category] = (target.categories[category] ?? 0) + 1;
    if (digest) target.digest.update(digest);
  };
  const flush = (key: string) => { const value = buckets.get(key); if (!value || value.count === 0) return; buckets.delete(key);
    const context = typeof options.context === 'function' ? options.context() : options.context;
    const stats = Object.fromEntries(Object.entries(value.metrics).map(([name, metric]) => [name, { ...metric, avg: metric.sum / value.count }]));
    const input: ChronicleEventInput = { eventType: 'metrics.rollup', outcome: 'success', occurredAt: new Date(value.updatedAt).toISOString(),
      scope: { ...context.scope, ...(value.sessionId ? { sessionId: value.sessionId } : {}), ...(value.agentId ? { agentId: value.agentId } : {}) },
      correlation: { ...context.correlation, ...(value.toolCallId ? { toolCallId: value.toolCallId } : {}) },
      durationNs: String(Math.max(0, value.updatedAt - value.startedAt) * 1_000_000),
      attributes: { signal: value.signal, windowStart: new Date(value.startedAt).toISOString(), windowEnd: new Date(value.updatedAt).toISOString(),
        samples: value.count, dimensions: value.dimensions, stats, categories: value.categories, digest: value.digest.digest('hex'), rawEventsRetained: false } };
    void options.journal.append(input).catch((error) => options.onPersistError?.(error, input));
  };
  const gauge = (signal: string, event: Record<string, unknown>, dimension?: string) => { const sessionId = text(event.sessionId);
    const dimensionValue = dimension ? text(event[dimension]) : undefined; const key = `${signal}\0${sessionId ?? ''}\0${dimensionValue ?? ''}`;
    const target = bucket(key, { signal, ...(sessionId ? { sessionId } : {}), ...(dimensionValue ? { agentId: dimensionValue } : {}), dimensions: dimensionValue && dimension ? { [dimension]: dimensionValue } : {} });
    sample(target, Object.fromEntries(Object.entries(event).filter(([, value]) => typeof value === 'number')) as Record<string, number>); };
  const offs = [
    options.events.on('process.output', (event) => { const key = `process.output\0${event.sessionId}\0${event.toolCallId}\0${event.pid ?? ''}\0${event.stream}`;
      const target = bucket(key, { signal: 'process.output', sessionId: event.sessionId, ...(event.agentId ? { agentId: event.agentId } : {}), toolCallId: event.toolCallId,
        dimensions: { stream: event.stream, toolName: event.toolName, pid: String(event.pid ?? '') } }); sample(target, { bytes: event.bytes }, event.stream, event.chunkHash); }),
    options.events.on('process.completed', (event) => { for (const key of [...buckets.keys()]) if (key.startsWith(`process.output\0${event.sessionId}\0${event.toolCallId}\0`)) flush(key); }),
    options.events.on('tool.progress', (event) => { if (event.event.type === 'file_changed') return; const key = `tool.progress\0${event.sessionId ?? ''}\0${event.id}`;
      const target = bucket(key, { signal: 'tool.progress', ...(event.sessionId ? { sessionId: event.sessionId } : {}), ...(event.agentId ? { agentId: event.agentId } : {}), toolCallId: event.id, dimensions: { toolName: event.name } });
      sample(target, { textBytes: Buffer.byteLength(event.event.text ?? '') }, event.event.type, safeDigest(event.event)); }),
    options.events.on('tool.executed', (event) => flush(`tool.progress\0${event.sessionId ?? ''}\0${event.id ?? ''}`)),
    options.events.on('tool.failed', (event) => flush(`tool.progress\0${event.sessionId}\0${event.id}`)),
    options.events.on('ctx.pct', (event) => gauge('ctx.pct', event)),
    options.events.on('subagent.ctx_pct', (event) => gauge('subagent.ctx_pct', event, 'subagentId')),
    options.events.on('countdown.tick', (event) => gauge('countdown.tick', event)),
    options.events.on('coordinator.stats', (event) => gauge('coordinator.stats', event)),
  ];
  const timer = setInterval(() => { const cutoff = Date.now() - windowMs; for (const [key, value] of buckets) if (value.updatedAt <= cutoff) flush(key); }, windowMs);
  timer.unref?.();
  return () => { clearInterval(timer); for (const key of [...buckets.keys()]) flush(key); offs.forEach((off) => off()); };
}
function text(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function safeDigest(value: unknown): string { try { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); } catch { return 'unhashable'; } }
