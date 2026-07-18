import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChronicleEvent, ChronicleOutcome, ChronicleResourceRef } from './types.js';

export interface ChronicleQuery {
  eventId?: string;
  eventTypes?: string[]; outcomes?: ChronicleOutcome[]; from?: string; to?: string;
  projectId?: string; sessionId?: string; agentId?: string; taskId?: string;
  providerId?: string; modelId?: string; traceId?: string; logicalRequestId?: string;
  attemptId?: string; toolCallId?: string; resourceKind?: ChronicleResourceRef['kind'];
  resourceId?: string; path?: string; line?: number; tags?: Record<string, string>;
  attributes?: Record<string, unknown>; text?: string; order?: 'asc' | 'desc';
  limit?: number; cursor?: string;
}

export interface ChronicleQueryResult {
  events: ChronicleEvent[]; total: number; nextCursor?: string;
  scannedEvents: number; sourceFiles: number; invalidLines: number;
  summary: ChronicleSummary;
}

/** Derived once from all matching events; never from the paginated UI sample. */
export interface ChronicleSummary {
  logicalRequests: number; modelAttempts: number; completedAttempts: number; failedAttempts: number;
  scheduledRetries: number; fallbacks: number; providers: number; models: number;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  estimatedCostUsd: number;
  providerAvgDurationMs: number; providerP95DurationMs: number;
  toolCalls: number; completedTools: number; failedTools: number; toolAvgDurationMs: number;
  processes: number; failedProcesses: number; fileEvents: number; uniqueFiles: number;
  agentEvents: number; uniqueAgents: number; decisions: number; escalations: number;
  failures: number; cancellations: number;
  families: Record<ChronicleSignalFamily, number>;
  failuresByFamily: Record<ChronicleSignalFamily, number>;
}
export type ChronicleSignalFamily = 'llm'|'agent'|'tool'|'file'|'memory'|'task'|'decision'|'runtime';

export type ChronicleFacet = 'eventType' | 'outcome' | 'projectId' | 'sessionId' |
  'agentId' | 'taskId' | 'providerId' | 'modelId' | 'resourceKind' | 'resourcePath' | 'toolCallId';
export interface ChronicleFacetValue { value: string; count: number }
export type ChronicleRelationKind = 'parent_span' | 'trace' | 'tool_call' | 'logical_request' |
  'attempt' | 'decision' | 'network_request' | 'prompt_manifest' | 'resource_lineage';
export interface ChronicleGraphEdge { from: string; to: string; kind: ChronicleRelationKind; confidence: 'explicit' | 'correlated' | 'inferred' }
export interface ChronicleGraphResult { nodes: ChronicleEvent[]; edges: ChronicleGraphEdge[]; truncated: boolean }

/** Queryable projection over one or many immutable Chronicle JSONL partitions. */
export class ChronicleQueryEngine {
  private constructor(
    private readonly events: ChronicleEvent[],
    readonly diagnostics: { sourceFiles: number; invalidLines: number },
  ) {}

  static async fromDirectory(directory: string): Promise<ChronicleQueryEngine> {
    return ChronicleQueryEngine.fromFiles(await findPartitions(path.resolve(directory)));
  }

  static async fromFiles(files: string[]): Promise<ChronicleQueryEngine> {
    const events: ChronicleEvent[] = [];
    let invalidLines = 0;
    for (const file of files) {
      let raw: string;
      try { raw = await fs.readFile(file, 'utf8'); } catch { continue; }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as ChronicleEvent;
          if (isChronicleEvent(parsed)) events.push(parsed); else invalidLines++;
        } catch { invalidLines++; }
      }
    }
    return new ChronicleQueryEngine(events, { sourceFiles: files.length, invalidLines });
  }

  query(query: ChronicleQuery = {}): ChronicleQueryResult {
    const order = query.order ?? 'desc';
    const found = this.events.filter((event) => matches(event, query));
    found.sort((a, b) => compareEvents(a, b) * (order === 'asc' ? 1 : -1));
    const offset = decodeCursor(query.cursor);
    const limit = Math.max(1, Math.min(query.limit ?? 100, 10_000));
    const events = found.slice(offset, offset + limit);
    const nextOffset = offset + events.length;
    return { events, total: found.length, summary: summarize(found),
      ...(nextOffset < found.length ? { nextCursor: encodeCursor(nextOffset) } : {}),
      scannedEvents: this.events.length, sourceFiles: this.diagnostics.sourceFiles,
      invalidLines: this.diagnostics.invalidLines };
  }

  facet(field: ChronicleFacet, query: ChronicleQuery = {}, limit = 100): ChronicleFacetValue[] {
    const counts = new Map<string, number>();
    for (const event of this.events) {
      if (!matches(event, query)) continue;
      const value = facetValue(event, field);
      if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, Math.max(0, limit));
  }

  /** Expand explicit and typed correlation edges; temporal proximity alone never creates causality. */
  graph(seed: ChronicleQuery, hops = 2, maxNodes = 1_000): ChronicleGraphResult {
    const seeds = this.events.filter((event) => matches(event, seed));
    const byKey = new Map<string, ChronicleEvent[]>();
    for (const event of this.events) for (const key of relationKeys(event)) {
      const values = byKey.get(key.key) ?? []; values.push(event); byKey.set(key.key, values);
    }
    const selected = new Map(seeds.slice(0, maxNodes).map((event) => [event.eventId, event]));
    let frontier = [...selected.values()];
    for (let depth = 0; depth < Math.max(0, Math.min(hops, 10)) && frontier.length > 0 && selected.size < maxNodes; depth++) {
      const next: ChronicleEvent[] = [];
      for (const event of frontier) for (const relation of relationKeys(event)) for (const candidate of byKey.get(relation.key) ?? []) {
        if (!selected.has(candidate.eventId) && selected.size < maxNodes) { selected.set(candidate.eventId, candidate); next.push(candidate); }
      }
      frontier = next;
    }
    const nodes = [...selected.values()].sort(compareEvents);
    const edges: ChronicleGraphEdge[] = [];
    const seen = new Set<string>();
    for (const node of nodes) for (const relation of relationKeys(node)) for (const candidate of byKey.get(relation.key) ?? []) {
      if (!selected.has(candidate.eventId) || candidate.eventId === node.eventId) continue;
      const [from, to] = compareEvents(node, candidate) <= 0 ? [node, candidate] : [candidate, node];
      const id = `${from.eventId}:${to.eventId}:${relation.kind}`;
      if (!seen.has(id)) { seen.add(id); edges.push({ from: from.eventId, to: to.eventId, kind: relation.kind, confidence: relation.confidence }); }
    }
    return { nodes, edges, truncated: seeds.length > maxNodes || selected.size >= maxNodes };
  }
}

function summarize(events: ChronicleEvent[]): ChronicleSummary {
  const ofType = (type: string) => events.filter((event) => event.eventType === type);
  const unique = (values: Array<string | undefined>) => new Set(values.filter((value): value is string => Boolean(value))).size;
  const numberAt = (event: ChronicleEvent, path: string): number => {
    const value = readPath(event.attributes ?? {}, path);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  const completedAttempts = ofType('provider.attempt.completed');
  const failedAttempts = ofType('provider.attempt.failed');
  const completedTools = ofType('tool.executed');
  const failedTools = ofType('tool.failed');
  const providerDurations = [...completedAttempts, ...failedAttempts].map(durationMs).filter((value) => value > 0).sort((a,b) => a-b);
  const toolDurations = [...completedTools, ...failedTools].map(durationMs).filter((value) => value > 0);
  const files = events.filter((event) => event.resource?.kind === 'file' || event.eventType.startsWith('file.'));
  const failedProcesses = ofType('process.completed').filter((event) => event.outcome === 'failure').length;
  const latestAccounted = latestByScope(ofType('token.accounted'));
  const families = familyCounts(events);
  const terminalFailures = events.filter(isTerminalFailure);
  return {
    logicalRequests: unique(events.map((event) => event.correlation.logicalRequestId)),
    modelAttempts: ofType('provider.attempt.started').length,
    completedAttempts: completedAttempts.length,
    failedAttempts: failedAttempts.length,
    scheduledRetries: failedAttempts.filter((event) => event.attributes?.retryScheduled === true).length,
    fallbacks: ofType('provider.fallback').length,
    providers: unique(events.map((event) => event.runtime?.providerId)), models: unique(events.map((event) => event.runtime?.modelId)),
    inputTokens: completedAttempts.reduce((sum,event) => sum + numberAt(event,'usage.input'),0),
    outputTokens: completedAttempts.reduce((sum,event) => sum + numberAt(event,'usage.output'),0),
    cacheReadTokens: completedAttempts.reduce((sum,event) => sum + numberAt(event,'usage.cacheRead'),0),
    cacheWriteTokens: completedAttempts.reduce((sum,event) => sum + numberAt(event,'usage.cacheWrite'),0),
    estimatedCostUsd: latestAccounted.reduce((sum,event) => sum + numberAt(event,'cost.total'),0),
    providerAvgDurationMs: average(providerDurations), providerP95DurationMs: percentile(providerDurations,0.95),
    toolCalls: ofType('tool.started').length, completedTools: completedTools.length, failedTools: failedTools.length,
    toolAvgDurationMs: average(toolDurations), processes: ofType('process.started').length,
    failedProcesses,
    fileEvents: files.length, uniqueFiles: unique(files.map((event) => event.resource?.path)),
    agentEvents: families.agent,
    uniqueAgents: unique(events.map((event) => event.scope.agentId)), decisions: ofType('decision.requested').length,
    escalations: ofType('decision.escalated').length,
    failures: terminalFailures.length,
    cancellations: events.filter((event) => event.outcome === 'cancelled' || event.outcome === 'abandoned').length,
    families, failuresByFamily: familyCounts(terminalFailures),
  };
}
function durationMs(event: ChronicleEvent): number { const value=Number(event.durationNs??0)/1_000_000; return Number.isFinite(value)?value:0; }
function average(values: number[]): number { return values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : 0; }
function percentile(sorted: number[], quantile: number): number { return sorted.length ? sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*quantile)-1))]! : 0; }
function latestByScope(events: ChronicleEvent[]): ChronicleEvent[] {
  const latest = new Map<string,ChronicleEvent>();
  for (const event of events) {
    const key = `${event.scope.projectId??''}\0${event.scope.sessionId??''}\0${event.scope.agentId??''}`;
    const current=latest.get(key);
    if (!current || compareEvents(current,event)<0) latest.set(key,event);
  }
  return [...latest.values()];
}
function familyCounts(events: ChronicleEvent[]): Record<ChronicleSignalFamily,number> {
  const counts: Record<ChronicleSignalFamily,number> = { llm:0,agent:0,tool:0,file:0,memory:0,task:0,decision:0,runtime:0 };
  for (const event of events) counts[signalFamily(event)]++;
  return counts;
}
function signalFamily(event: ChronicleEvent): ChronicleSignalFamily {
  if (event.eventType.startsWith('decision.') || event.eventType.startsWith('brain.')) return 'decision';
  if (event.resource?.kind === 'file' || event.resource?.kind === 'symbol' || /^(?:file|worktree)\./.test(event.eventType)) return 'file';
  if (/^(?:provider|token|context|ctx|compaction)\./.test(event.eventType)) return 'llm';
  if (/^(?:agent|subagent|delegate|fleet|concurrency)\./.test(event.eventType)) return 'agent';
  if (/^(?:tool|process|mcp|network)\./.test(event.eventType)) return 'tool';
  if (/^(?:memory|storage|trust)\./.test(event.eventType)) return 'memory';
  if (/^(?:sdd|task|kanban|checkpoint|session|iteration|in_flight)\./.test(event.eventType)) return 'task';
  return 'runtime';
}
function isTerminalFailure(event: ChronicleEvent): boolean {
  if (event.eventType === 'provider.attempt.failed') return event.attributes?.retryScheduled !== true;
  return event.eventType === 'tool.failed' ||
    (event.eventType === 'process.completed' && event.outcome === 'failure') ||
    /^(?:agent\.run\.error|sdd\.task\.failed|compaction\.failed|network\.request\.failed)$/.test(event.eventType);
}

function relationKeys(event: ChronicleEvent): Array<{ key: string; kind: ChronicleRelationKind; confidence: ChronicleGraphEdge['confidence'] }> {
  const result: Array<{ key: string; kind: ChronicleRelationKind; confidence: ChronicleGraphEdge['confidence'] }> = [];
  const add = (kind: ChronicleRelationKind, value: unknown, confidence: ChronicleGraphEdge['confidence']) => {
    if (typeof value === 'string' && value) result.push({ key: `${kind}:${value}`, kind, confidence });
  };
  add('trace', event.correlation.traceId, 'correlated');
  add('tool_call', event.correlation.toolCallId, 'explicit');
  add('logical_request', event.correlation.logicalRequestId, 'explicit');
  add('attempt', event.correlation.attemptId, 'explicit');
  add('decision', event.attributes?.decisionId, 'explicit');
  add('network_request', event.attributes?.requestId, 'explicit');
  add('prompt_manifest', (event.attributes?.promptManifest as Record<string, unknown> | undefined)?.manifestId, 'explicit');
  add('resource_lineage', event.resource?.id, 'inferred');
  if (event.correlation.parentSpanId) add('parent_span', event.correlation.parentSpanId, 'explicit');
  add('parent_span', event.correlation.spanId, 'explicit');
  return result;
}

async function findPartitions(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.endsWith('.events.jsonl')) result.push(full);
    }
  };
  await visit(root);
  return result.sort();
}

function matches(event: ChronicleEvent, query: ChronicleQuery): boolean {
  if (query.eventId && event.eventId !== query.eventId) return false;
  if (query.eventTypes && !query.eventTypes.includes(event.eventType)) return false;
  if (query.outcomes && (!event.outcome || !query.outcomes.includes(event.outcome))) return false;
  const occurredAt = event.occurredAt ?? event.observedAt;
  if (query.from && occurredAt < query.from || query.to && occurredAt > query.to) return false;
  if (!equal(query.projectId, event.scope.projectId) || !equal(query.sessionId, event.scope.sessionId)) return false;
  if (!equal(query.agentId, event.scope.agentId) || !equal(query.taskId, event.scope.taskId)) return false;
  if (!equal(query.providerId, event.runtime?.providerId) || !equal(query.modelId, event.runtime?.modelId)) return false;
  if (!equal(query.traceId, event.correlation.traceId) || !equal(query.logicalRequestId, event.correlation.logicalRequestId)) return false;
  if (!equal(query.attemptId, event.correlation.attemptId) || !equal(query.toolCallId, event.correlation.toolCallId)) return false;
  if (!equal(query.resourceKind, event.resource?.kind) || !equal(query.resourceId, event.resource?.id)) return false;
  if (query.path && normalize(event.resource?.path) !== normalize(query.path)) return false;
  if (query.line !== undefined && !lineContains(event, query.line)) return false;
  if (query.tags && !objectContains(event.tags, query.tags)) return false;
  if (query.attributes && !objectContains(event.attributes, query.attributes)) return false;
  if (query.text && !JSON.stringify(event).toLocaleLowerCase().includes(query.text.toLocaleLowerCase())) return false;
  return true;
}

function equal<T>(expected: T | undefined, actual: T | undefined): boolean { return expected === undefined || expected === actual; }
function normalize(value: string | undefined): string | undefined { return value?.replaceAll('\\', '/').toLocaleLowerCase(); }
function lineContains(event: ChronicleEvent, line: number): boolean {
  const start = event.resource?.lineStart, end = event.resource?.lineEnd ?? start;
  return start !== undefined && end !== undefined && line >= start && line <= end;
}
function objectContains(actual: Record<string, unknown> | undefined, expected: Record<string, unknown>): boolean {
  return Boolean(actual && Object.entries(expected).every(([key, value]) => deepEqual(readPath(actual, key), value)));
}
function readPath(value: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => current && typeof current === 'object'
    ? (current as Record<string, unknown>)[part] : undefined, value);
}
function deepEqual(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function compareEvents(a: ChronicleEvent, b: ChronicleEvent): number {
  return (a.occurredAt ?? a.observedAt).localeCompare(b.occurredAt ?? b.observedAt) ||
    a.persistedAt.localeCompare(b.persistedAt) || a.sequence - b.sequence;
}
function encodeCursor(offset: number): string { return Buffer.from(String(offset)).toString('base64url'); }
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function isChronicleEvent(value: ChronicleEvent): boolean {
  return Boolean(value && typeof value.eventId === 'string' && typeof value.eventType === 'string' && typeof value.occurredAt === 'string');
}
function facetValue(event: ChronicleEvent, field: ChronicleFacet): string | undefined {
  const values: Record<ChronicleFacet, string | undefined> = {
    eventType: event.eventType, outcome: event.outcome, projectId: event.scope.projectId,
    sessionId: event.scope.sessionId, agentId: event.scope.agentId, taskId: event.scope.taskId,
    providerId: event.runtime?.providerId, modelId: event.runtime?.modelId,
    resourceKind: event.resource?.kind, resourcePath: event.resource?.path,
    toolCallId: event.correlation.toolCallId,
  };
  return values[field];
}
