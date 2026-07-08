/**
 * Transcript formatting helpers for the HQ Live Console.
 *
 * These are pure functions — no React, no DOM — so the chat view can lean on
 * them for a WebUI-grade rendering (tool-aware summaries, diff extraction,
 * pretty JSON, terminal output) while staying trivially unit-testable.
 *
 * The HQ transcript entry (`HqTranscriptEntry`) merges a tool call's args and
 * result into a single entry: `tool` is the name, `toolInput` is the
 * stringified arguments, and `text` is the stringified result. We classify the
 * tool by name to pick the right "real" result view.
 *
 * @module lib/transcript-format
 */

/** Broad tool family used to pick a result renderer. */
export type ToolKind = 'edit' | 'write' | 'bash' | 'read' | 'search' | 'fetch' | 'todo' | 'generic';

/** Classify a tool by name into a rendering family. Case-insensitive. */
export function classifyTool(toolName: string | undefined): ToolKind {
  const n = (toolName ?? '').toLowerCase().replace(/^mcp__[^_]+__/, '');
  if (/^(edit|str_replace|edit_file|patch|apply_patch|multiedit)$/.test(n)) return 'edit';
  if (/^(write|write_file|create_file|new_file)$/.test(n)) return 'write';
  if (/^(bash|shell|exec|run|run_command|run_shell|powershell|terminal)$/.test(n)) return 'bash';
  if (/^(read|read_file|cat|open)$/.test(n)) return 'read';
  if (/^(grep|search|ripgrep|glob|find)$/.test(n)) return 'search';
  if (/^(fetch|http|web|webfetch|websearch|curl|request)$/.test(n)) return 'fetch';
  if (/todo/.test(n)) return 'todo';
  return 'generic';
}

/** Parse a string that MIGHT be JSON; returns the value or `undefined`. */
export function tryParseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t === '' || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function pickPath(o: Record<string, unknown>): string {
  for (const k of ['file_path', 'path', 'filepath', 'file', 'notebook_path']) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

/**
 * One-line, tool-aware summary of a tool's input — the collapsed-card subtitle.
 * Mirrors the WebUI's `summarizeToolInput` at a smaller surface. `input` is the
 * stringified JSON args as stored on the transcript entry.
 */
export function summarizeToolInput(
  toolName: string | undefined,
  input: string | undefined,
): string {
  const parsed = tryParseJson(input);
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
    return input ? clip(input, 120) : '';
  }
  const obj = parsed as Record<string, unknown>;
  const kind = classifyTool(toolName);

  if (kind === 'todo' || Array.isArray(obj.todos)) {
    const todos = (obj.todos ?? []) as Array<{ status?: string }>;
    if (Array.isArray(todos)) {
      const done = todos.filter((t) => t.status === 'completed').length;
      const wip = todos.filter((t) => t.status === 'in_progress').length;
      const parts = [`${todos.length} todo${todos.length === 1 ? '' : 's'}`];
      if (done) parts.push(`${done} done`);
      if (wip) parts.push(`${wip} wip`);
      return parts.join(' · ');
    }
  }

  if (kind === 'edit') {
    const fp = pickPath(obj);
    const oldS = typeof obj.old_string === 'string' ? obj.old_string : '';
    const newS = typeof obj.new_string === 'string' ? obj.new_string : '';
    const oldLines = oldS ? oldS.split('\n').length : 0;
    const newLines = newS ? newS.split('\n').length : 0;
    return `${fp || '(file)'}${oldLines || newLines ? ` · ${oldLines} → ${newLines} lines` : ''}`;
  }

  if (kind === 'write') {
    const fp = pickPath(obj);
    const c = typeof obj.content === 'string' ? obj.content : '';
    const lines = c ? c.split('\n').length : 0;
    return `${fp || '(file)'}${lines ? ` · ${lines} lines` : ''}`;
  }

  if (kind === 'bash') {
    const cmd = (obj.command ?? obj.cmd ?? obj.script) as string | undefined;
    if (typeof cmd === 'string') return `$ ${clip(cmd, 110)}`;
  }

  if (kind === 'fetch') {
    const url = obj.url as string | undefined;
    if (typeof url === 'string') {
      const method = ((obj.method as string | undefined) ?? 'GET').toUpperCase();
      return `${method} ${clip(url, 100)}`;
    }
    const query = obj.query as string | undefined;
    if (typeof query === 'string') return clip(query, 110);
  }

  if (kind === 'search') {
    const pattern = (obj.pattern ?? obj.query ?? obj.glob) as string | undefined;
    const scope = (obj.path ?? obj.glob ?? obj.type) as string | undefined;
    if (typeof pattern === 'string') {
      return scope && scope !== pattern ? `${clip(pattern, 60)} in ${scope}` : clip(pattern, 100);
    }
  }

  if (kind === 'read') {
    const fp = pickPath(obj);
    const offset = obj.offset as number | undefined;
    const limit = obj.limit as number | undefined;
    if (fp)
      return offset || limit
        ? `${fp}:${offset ?? 0}${limit ? `..${(offset ?? 0) + limit}` : ''}`
        : fp;
  }

  // Generic fallback: first meaningful scalar field, else compact JSON.
  for (const k of [
    'file_path',
    'path',
    'command',
    'cmd',
    'url',
    'query',
    'pattern',
    'description',
    'name',
  ]) {
    const v = obj[k];
    if (typeof v === 'string' && v) return clip(v, 120);
  }
  return clip(JSON.stringify(obj), 120);
}

/** A pretty, human-readable rendering of a tool's stringified JSON input. */
export function prettyInput(input: string | undefined): string {
  const parsed = tryParseJson(input);
  if (parsed === undefined) return input ?? '';
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return input ?? '';
  }
}

export type TodoStatus = 'completed' | 'in_progress' | 'pending';
export interface TodoItem {
  status: TodoStatus;
  content: string;
}

/**
 * Extract the todo list from a TodoWrite tool's stringified input, normalized to
 * `{status, content}`. Returns `null` when the input isn't a todo write.
 */
export function extractTodos(input: string | undefined): TodoItem[] | null {
  const parsed = tryParseJson(input);
  if (parsed === null || typeof parsed !== 'object') return null;
  const raw = (parsed as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return null;
  const todos: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const status: TodoStatus =
      o.status === 'completed'
        ? 'completed'
        : o.status === 'in_progress'
          ? 'in_progress'
          : 'pending';
    const content =
      typeof o.content === 'string'
        ? o.content
        : typeof o.subject === 'string'
          ? o.subject
          : typeof o.title === 'string'
            ? o.title
            : '';
    todos.push({ status, content });
  }
  return todos.length > 0 ? todos : null;
}

export interface DiffParts {
  oldText: string;
  newText: string;
  path: string;
}

/**
 * Extract a before/after diff from an edit/write tool's stringified input.
 * Returns `null` when the input doesn't describe a file change.
 */
export function diffFromToolInput(
  toolName: string | undefined,
  input: string | undefined,
): DiffParts | null {
  const parsed = tryParseJson(input);
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const kind = classifyTool(toolName);
  const path = pickPath(obj);

  if (kind === 'edit') {
    const oldText = typeof obj.old_string === 'string' ? obj.old_string : '';
    const newText = typeof obj.new_string === 'string' ? obj.new_string : '';
    if (oldText === '' && newText === '') return null;
    return { oldText, newText, path };
  }
  if (kind === 'write') {
    const content = typeof obj.content === 'string' ? obj.content : '';
    if (content === '') return null;
    return { oldText: '', newText: content, path };
  }
  return null;
}

export type DiffLineKind = 'add' | 'del' | 'ctx';
export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Build a simple line-oriented diff for the before/after text. This is a
 * common-prefix / common-suffix diff (not full Myers) — cheap, dependency-free,
 * and more than adequate for the small hunks edit/write tools produce.
 */
export function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText === '' ? [] : oldText.split('\n');
  const newLines = newText === '' ? [] : newText.split('\n');

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start])
    start++;

  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: 'ctx', text: oldLines[i] ?? '' });
  for (let i = start; i < endOld; i++) out.push({ kind: 'del', text: oldLines[i] ?? '' });
  for (let i = start; i < endNew; i++) out.push({ kind: 'add', text: newLines[i] ?? '' });
  for (let i = endOld; i < oldLines.length; i++) out.push({ kind: 'ctx', text: oldLines[i] ?? '' });
  return out;
}

/** Human-friendly duration for a tool call (e.g. `820ms`, `2.4s`, `1m3s`). */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

/** Short display label for a tool name, stripping the `mcp__server__` prefix. */
export function toolDisplayName(toolName: string | undefined): string {
  if (!toolName) return 'tool';
  return toolName.replace(/^mcp__([^_]+)__/, '$1:');
}

/** Format a timestamp string as a local `HH:MM:SS`, or '' when unparseable. */
export function formatClock(ts: string | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
