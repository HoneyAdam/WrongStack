import type { ChatMessage, FileEditMeta, TimelineEntry, ToolCallInfo } from '../types.js';

/** Interleave messages and tool calls into a single timeline ordered by timestamp. */
export function buildTimeline(
  messages: ChatMessage[],
  toolCalls: ToolCallInfo[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const m of messages) {
    entries.push({
      kind: 'message',
      ts: m.ts ?? '0',
      message: m,
    });
  }

  for (const tc of toolCalls) {
    entries.push({
      kind: 'tool_call',
      ts: tc.ts ?? '0',
      toolCall: tc,
    });
  }

  entries.sort((a, b) => {
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    return 0;
  });

  return entries;
}

/** Tool names that produce file-edit output we can show diff stats for. */
const FILE_EDIT_TOOLS = new Set(['edit', 'write', 'patch']);

/** Count lines added/removed from a unified diff string.
 *  Returns null if the string doesn't look like a diff. */
function countDiffLines(diff: string): { added: number; removed: number } | null {
  const start = diff.indexOf('@@');
  if (start === -1) return null;
  let added = 0;
  let removed = 0;
  for (const line of diff.slice(start).split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

/** Extract file edit metadata from a tool call's output, if this is a
 *  file-edit tool with a parseable result. */
export function extractFileEditMeta(toolCall: ToolCallInfo): FileEditMeta | null {
  if (!FILE_EDIT_TOOLS.has(toolCall.name)) return null;
  const output = toolCall.output;
  if (!output || typeof output !== 'string') return null;

  try {
    const parsed = JSON.parse(output);
    if (!parsed || typeof parsed !== 'object') return null;
    const path = typeof parsed['path'] === 'string' ? parsed['path'] : '';
    if (!path) return null;

    const meta: FileEditMeta = { path };

    if (typeof parsed['replacements'] === 'number') meta.replacements = parsed['replacements'];
    if (typeof parsed['bytes_written'] === 'number') meta.bytesWritten = parsed['bytes_written'];
    if (typeof parsed['created'] === 'boolean') meta.created = parsed['created'];

    // Extract diff with line counts for green/red stats
    if (typeof parsed['diff'] === 'string' && parsed['diff']) {
      meta.diff = parsed['diff'];
      const counts = countDiffLines(parsed['diff']);
      if (counts) {
        meta.replacements = meta.replacements ?? counts.added;
      }
    }

    return meta;
  } catch {
    return null;
  }
}

/** Aggregate file edit stats across all tool calls.
 *  Deduplicates by path (latest edit wins) and returns the list of unique
 *  file edits plus total added/removed line counts. */
export function aggregateFileEdits(toolCalls: ToolCallInfo[]): {
  files: FileEditMeta[];
  totalAdded: number;
  totalRemoved: number;
  fileCount: number;
} {
  const byPath = new Map<string, FileEditMeta>();

  for (const tc of toolCalls) {
    if (tc.status !== 'done') continue;
    const meta = extractFileEditMeta(tc);
    if (!meta) continue;
    // Later edits replace earlier ones for the same path
    byPath.set(meta.path, meta);
  }

  const files = [...byPath.values()];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const f of files) {
    if (f.diff) {
      const start = f.diff.indexOf('@@');
      if (start !== -1) {
        for (const line of f.diff.slice(start).split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) totalAdded++;
          else if (line.startsWith('-') && !line.startsWith('---')) totalRemoved++;
        }
      }
    }
  }

  return { files, totalAdded, totalRemoved, fileCount: files.length };
}
