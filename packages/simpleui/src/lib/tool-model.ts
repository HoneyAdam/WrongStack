import type { AgentTranscriptEntry, ToolCallInfo } from '../types.js';

function toolName(entry: AgentTranscriptEntry): string {
  if (entry.toolName?.trim()) return entry.toolName.trim();
  const call = /^([^\s(]+)\s*\(/.exec(entry.content);
  return call?.[1] ?? 'tool';
}

/** Pair a worker's tool-use and tool-result transcript entries for the floating drawer. */
export function agentTranscriptToToolCalls(entries: AgentTranscriptEntry[]): ToolCallInfo[] {
  const calls: ToolCallInfo[] = [];
  for (const entry of entries) {
    if (entry.kind === 'tool_use') {
      calls.push({
        id: entry.id,
        name: toolName(entry),
        input: entry.content,
        status: 'running',
      });
      continue;
    }
    if (entry.kind !== 'tool_result') continue;

    const name = toolName(entry);
    let match = -1;
    for (let index = calls.length - 1; index >= 0; index--) {
      const candidate = calls[index];
      if (candidate?.name === name && candidate.status === 'running') {
        match = index;
        break;
      }
    }
    const failed = entry.toolOk === false;
    if (match >= 0) {
      const current = calls[match];
      if (!current) continue;
      calls[match] = {
        ...current,
        status: failed ? 'error' : 'done',
        output: entry.content,
        ok: !failed,
      };
      continue;
    }
    calls.push({
      id: entry.id,
      name,
      input: undefined,
      status: failed ? 'error' : 'done',
      output: entry.content,
      ok: !failed,
    });
  }
  return calls;
}
