import type { VizEvent } from '@/stores/viz-store';

export type OfficeToolKind =
  | 'read'
  | 'write'
  | 'edit'
  | 'terminal'
  | 'web'
  | 'search'
  | 'memory'
  | 'other';

export interface OfficeFileTarget {
  filePath: string;
  operation?: string | undefined;
  line?: number | undefined;
  endLine?: number | undefined;
}

export interface OfficeToolCall {
  id: string;
  agentId: string;
  agentName?: string | undefined;
  sessionId?: string | undefined;
  toolName: string;
  kind: OfficeToolKind;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  completedAt?: number | undefined;
  durationMs?: number | undefined;
  target?: string | undefined;
  summary: string;
  lineLabel?: string | undefined;
  outputLines?: number | undefined;
  outputBytes?: number | undefined;
  outputTokens?: number | undefined;
  input?: unknown | undefined;
  output?: string | undefined;
  fileTargets: OfficeFileTarget[];
  raw?: unknown;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstText(source: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return undefined;
}

function firstNumber(source: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}

function patchDelta(value: string): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  for (const line of value.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    if (line.startsWith('-')) removed += 1;
  }
  return added || removed ? { added, removed } : null;
}

function compactCommand(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? value;
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}

export function classifyOfficeTool(toolName: string): OfficeToolKind {
  const name = toolName.toLowerCase().replace(/[.:/-]+/g, '_');
  if (/^(read|view|open_file|read_file)|file_read/.test(name)) return 'read';
  if (/^(write|create|save)|file_write/.test(name)) return 'write';
  if (/edit|update|patch|replace|apply_patch/.test(name)) return 'edit';
  if (/bash|shell|terminal|exec|command|powershell|cmd/.test(name)) return 'terminal';
  if (/fetch|browser|browse|http|url|web/.test(name)) return 'web';
  if (/search|grep|find|glob|query/.test(name)) return 'search';
  if (/memory|recall|remember/.test(name)) return 'memory';
  return 'other';
}

function fileTargetsFrom(data: UnknownRecord, input: UnknownRecord): OfficeFileTarget[] {
  const rawTargets = Array.isArray(data['fileTargets']) ? data['fileTargets'] : [];
  const targets = rawTargets.flatMap((value): OfficeFileTarget[] => {
    const target = record(value);
    const filePath = firstText(target, ['filePath', 'file_path', 'path']);
    if (!filePath) return [];
    return [{
      filePath,
      operation: text(target['operation']),
      line: firstNumber(target, ['line', 'startLine', 'start_line']),
      endLine: firstNumber(target, ['endLine', 'end_line']),
    }];
  });
  if (targets.length > 0) return targets;

  const filePath = firstText(input, [
    'file_path',
    'filePath',
    'path',
    'filename',
    'target_file',
    'targetFile',
  ]);
  if (!filePath) return [];
  return [{
    filePath,
    line: firstNumber(input, ['line', 'start_line', 'startLine', 'offset']),
    endLine: firstNumber(input, ['end_line', 'endLine']),
  }];
}

function lineRange(
  target: OfficeFileTarget | undefined,
  input: UnknownRecord,
): { start?: number | undefined; end?: number | undefined; label?: string | undefined } {
  const start = target?.line ?? firstNumber(input, ['line', 'start_line', 'startLine', 'offset']);
  let end = target?.endLine ?? firstNumber(input, ['end_line', 'endLine']);
  const limit = firstNumber(input, ['limit', 'line_count', 'lineCount']);
  if (end === undefined && start !== undefined && limit !== undefined && limit > 0) {
    end = start + limit - 1;
  }
  if (start !== undefined && end !== undefined) return { start, end, label: `L${start}–${end}` };
  if (start !== undefined) return { start, label: `L${start}` };
  return {};
}

function describeTool(
  kind: OfficeToolKind,
  toolName: string,
  input: UnknownRecord,
  outputLines: number | undefined,
  target: OfficeFileTarget | undefined,
): { target?: string | undefined; summary: string; lineLabel?: string | undefined } {
  const range = lineRange(target, input);
  const path = target?.filePath ?? firstText(input, ['file_path', 'filePath', 'path', 'filename']);
  const shortTarget = path ? basename(path) : undefined;

  if (kind === 'read') {
    return {
      target: path,
      summary: outputLines !== undefined
        ? `${outputLines.toLocaleString()} lines read`
        : range.label
          ? `${range.label} queued to read`
          : 'Reading file',
      lineLabel: range.label,
    };
  }

  if (kind === 'write') {
    const content = firstText(input, ['content', 'text', 'data']);
    const writtenLines = content ? lineCount(content) : undefined;
    return {
      target: path,
      summary: writtenLines !== undefined
        ? `${writtenLines.toLocaleString()} lines written`
        : 'Writing file',
      lineLabel: range.label,
    };
  }

  if (kind === 'edit') {
    const patch = firstText(input, ['patch', 'diff']);
    const delta = patch ? patchDelta(patch) : null;
    const oldText = firstText(input, ['old_string', 'oldString', 'search']);
    const newText = firstText(input, ['new_string', 'newString', 'replacement']);
    const summary = delta
      ? `+${delta.added} / −${delta.removed} lines`
      : oldText !== undefined || newText !== undefined
        ? `${oldText ? lineCount(oldText) : 0} → ${newText ? lineCount(newText) : 0} lines`
        : range.label
          ? `${range.label} updated`
          : 'Updating file';
    return { target: path, summary, lineLabel: range.label };
  }

  if (kind === 'terminal') {
    const command = firstText(input, ['command', 'cmd', 'script', 'shell']) ?? toolName;
    return { summary: compactCommand(command), target: command };
  }

  if (kind === 'web') {
    const url = firstText(input, ['url', 'href', 'uri']);
    const query = firstText(input, ['query', 'q', 'search']);
    return {
      target: url ?? query,
      summary: url ? `Fetched ${url}` : query ? `Looked up “${query}”` : 'Went online',
    };
  }

  if (kind === 'search') {
    const query = firstText(input, ['query', 'pattern', 'q', 'search']) ?? shortTarget;
    return { target: path ?? query, summary: query ? `Searched “${query}”` : 'Searching project' };
  }

  if (kind === 'memory') {
    const query = firstText(input, ['query', 'text', 'key']);
    return { target: query, summary: query ? `Recalled “${query}”` : 'Checking memory' };
  }

  return { target: path, summary: shortTarget ? `${toolName} · ${shortTarget}` : toolName };
}

function toolNameFor(event: VizEvent, data: UnknownRecord): string | undefined {
  const named = text(data['name']) ?? text(data['toolName']);
  if (named) return named;
  if (event.kind === 'agent:tool') return event.target ?? undefined;
  if (event.kind.startsWith('tool:')) return event.source;
  return undefined;
}

function agentIdFor(event: VizEvent, data: UnknownRecord, toolName: string): string {
  return text(data['agentId'])
    ?? text(data['subagentId'])
    ?? (event.kind === 'agent:tool' ? event.source : undefined)
    ?? (event.source !== toolName && event.source !== 'filesystem' ? event.source : undefined)
    ?? 'leader';
}

function sessionIdFor(data: UnknownRecord): string | undefined {
  return text(data['parentSessionId']) ?? text(data['sessionId']);
}

function toolEventStatus(event: VizEvent, data: UnknownRecord): OfficeToolCall['status'] {
  if (event.kind === 'tool:started' || event.kind === 'tool:progress') return 'running';
  return data['ok'] === false ? 'failed' : 'succeeded';
}

function normalizeToolEvent(event: VizEvent): OfficeToolCall | null {
  if (!['tool:started', 'tool:progress', 'tool:executed', 'agent:tool'].includes(event.kind)) {
    return null;
  }
  const data = record(event.data);
  const toolName = toolNameFor(event, data);
  if (!toolName) return null;
  const agentId = agentIdFor(event, data, toolName);
  const input = data['input'];
  const inputRecord = record(input);
  const fileTargets = fileTargetsFrom(data, inputRecord);
  const outputLines = finiteNumber(data['outputLines']);
  const kind = classifyOfficeTool(toolName);
  const description = describeTool(kind, toolName, inputRecord, outputLines, fileTargets[0]);
  const rawId = text(data['id']);
  const fallbackBucket = Math.floor(event.timestamp / 2000);
  const status = toolEventStatus(event, data);

  return {
    id: rawId ? `${agentId}:${rawId}` : `${agentId}:${toolName}:${fallbackBucket}`,
    agentId,
    agentName: text(data['agentName']) ?? text(data['name']),
    sessionId: sessionIdFor(data),
    toolName,
    kind,
    status,
    startedAt: event.timestamp,
    ...(status === 'running' ? {} : { completedAt: event.timestamp }),
    durationMs: finiteNumber(data['durationMs']),
    target: description.target,
    summary: description.summary,
    lineLabel: description.lineLabel,
    outputLines,
    outputBytes: finiteNumber(data['outputBytes']),
    outputTokens: finiteNumber(data['outputTokens']),
    input,
    output: text(data['output']),
    fileTargets,
    raw: event.raw ?? data,
  };
}

function sameAgent(candidate: string, wanted: string): boolean {
  return candidate.toLowerCase() === wanted.toLowerCase();
}

/**
 * Merge start/progress/completion envelopes into one compact action per tool call.
 * The viz ring buffer is newest-first; processing it oldest-first preserves the
 * original start timestamp while letting the completion payload win.
 */
export function buildAgentToolCalls(
  events: VizEvent[],
  agentId: string,
  sessionId?: string,
): OfficeToolCall[] {
  const merged = new Map<string, OfficeToolCall>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    const call = normalizeToolEvent(event);
    if (!call || !sameAgent(call.agentId, agentId)) continue;
    if (sessionId && call.sessionId && call.sessionId !== sessionId) continue;
    const previous = merged.get(call.id);
    merged.set(call.id, previous
      ? {
          ...previous,
          ...call,
          startedAt: Math.min(previous.startedAt, call.startedAt),
          fileTargets: call.fileTargets.length > 0 ? call.fileTargets : previous.fileTargets,
          input: call.input ?? previous.input,
          output: call.output ?? previous.output,
          raw: call.raw ?? previous.raw,
        }
      : call);
  }

  const calls = [...merged.values()].sort(
    (left, right) => (right.completedAt ?? right.startedAt) - (left.completedAt ?? left.startedAt),
  );

  // `subagent.event` is a deliberately compact duplicate of the richer
  // `codemap.tool_executed` envelope. Drop the compact twin when both arrive.
  return calls.filter((call, index) => {
    if (call.input !== undefined || call.fileTargets.length > 0 || call.output !== undefined) return true;
    return !calls.some((candidate, candidateIndex) =>
      candidateIndex !== index
      && candidate.toolName === call.toolName
      && (candidate.input !== undefined || candidate.fileTargets.length > 0 || candidate.output !== undefined)
      && Math.abs(
        (candidate.completedAt ?? candidate.startedAt) - (call.completedAt ?? call.startedAt),
      ) < 2500,
    );
  });
}

export function synthesizeCurrentTool(
  agentId: string,
  toolName: string,
  sessionId?: string,
): OfficeToolCall {
  const kind = classifyOfficeTool(toolName);
  const summaryByKind: Record<OfficeToolKind, string> = {
    read: 'Reading a file',
    write: 'Writing a file',
    edit: 'Updating code',
    terminal: 'Running a command',
    web: 'Working online',
    search: 'Searching project',
    memory: 'Checking memory',
    other: toolName,
  };
  return {
    id: `${agentId}:live:${toolName}`,
    agentId,
    sessionId,
    toolName,
    kind,
    status: 'running',
    startedAt: Date.now(),
    summary: summaryByKind[kind],
    fileTargets: [],
  };
}

