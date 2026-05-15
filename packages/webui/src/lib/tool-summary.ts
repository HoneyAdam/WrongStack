/**
 * Tool-aware one-line summary for the collapsed bubble. The whole point is
 * that 8 parallel `read` calls should NOT look identical, and a TodoWrite
 * call with 8 todos shouldn't dump 800 chars of JSON when "8 todos · 3
 * done" tells the whole story.
 *
 * Cases that earn a custom branch:
 *   - TodoWrite          → "8 todos · 3 done · 2 in-progress"
 *   - edit / write       → "edit foo.ts (3 lines → 5 lines)" / "write …"
 *   - bash / shell       → "$ <command snippet>"
 *   - fetch / http       → "GET https://…"
 *   - grep / glob        → pattern + scope
 *   - batch_tool_use     → "N sub-tools"
 *   - read               → "path:N..M" if offset/limit present
 *
 * Everything else falls back to the head-field-or-JSON heuristic the
 * collapsed view used before.
 */

const FALLBACK_HEAD_FIELDS = ['path', 'file_path', 'pattern', 'command', 'cmd', 'url', 'query', 'description', 'content'];

export function summarizeToolInput(toolName: string | undefined, input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'object') return clip(String(input), 120);

  const obj = input as Record<string, unknown>;
  const name = (toolName ?? '').toLowerCase();

  // ---- TodoWrite ----------------------------------------------------
  if (/^todo(_?write)?$|^todos$/i.test(name) || Array.isArray(obj.todos)) {
    const todos = (obj.todos ?? []) as Array<{ status?: string; content?: string }>;
    if (Array.isArray(todos)) {
      const done = todos.filter((t) => t.status === 'completed').length;
      const wip = todos.filter((t) => t.status === 'in_progress').length;
      const parts = [`${todos.length} todo${todos.length === 1 ? '' : 's'}`];
      if (done > 0) parts.push(`${done} done`);
      if (wip > 0) parts.push(`${wip} in-progress`);
      return parts.join(' · ');
    }
  }

  // ---- batch_tool_use / parallel_tool_use ---------------------------
  if (/batch|parallel/.test(name) || Array.isArray(obj.tool_uses) || Array.isArray(obj.calls)) {
    const list = (obj.tool_uses ?? obj.calls ?? obj.batch) as unknown[];
    if (Array.isArray(list)) {
      const subNames = new Set<string>();
      for (const item of list) {
        if (item && typeof item === 'object' && 'name' in item) {
          subNames.add(String((item as { name: unknown }).name));
        }
      }
      const preview = [...subNames].slice(0, 3).join(', ');
      const more = subNames.size > 3 ? ` +${subNames.size - 3}` : '';
      return `${list.length} sub-tool${list.length === 1 ? '' : 's'}${preview ? ` · ${preview}${more}` : ''}`;
    }
  }

  // ---- edit / str_replace / patch -----------------------------------
  if (/^(edit|str_replace|edit_file|patch)$/.test(name)) {
    const fp = pickPath(obj);
    const oldS = typeof obj.old_string === 'string' ? obj.old_string : '';
    const newS = typeof obj.new_string === 'string' ? obj.new_string : '';
    const oldLines = oldS ? oldS.split('\n').length : 0;
    const newLines = newS ? newS.split('\n').length : 0;
    return `edit ${fp || '(file)'}${oldLines || newLines ? ` (${oldLines} → ${newLines} lines)` : ''}`;
  }

  // ---- write / write_file / create_file -----------------------------
  if (/^(write|write_file|create_file|new_file)$/.test(name)) {
    const fp = pickPath(obj);
    const c = typeof obj.content === 'string' ? obj.content : '';
    const lines = c ? c.split('\n').length : 0;
    return `write ${fp || '(file)'}${lines ? ` · ${lines} lines` : ''}`;
  }

  // ---- bash / shell / exec / run ------------------------------------
  if (/^(bash|shell|exec|run|run_command|run_shell)$/.test(name)) {
    const cmd = (obj.command ?? obj.cmd ?? obj.script) as string | undefined;
    if (typeof cmd === 'string') return `$ ${clip(cmd, 110)}`;
  }

  // ---- fetch / http / web -------------------------------------------
  if (/^(fetch|http|web|webfetch|curl|request)$/.test(name)) {
    const url = obj.url as string | undefined;
    if (typeof url === 'string') {
      const method = (obj.method as string | undefined) ?? 'GET';
      return `${method.toUpperCase()} ${clip(url, 100)}`;
    }
  }

  // ---- grep / search ------------------------------------------------
  if (/^(grep|search|ripgrep)$/.test(name)) {
    const pattern = obj.pattern as string | undefined;
    const scope = (obj.path ?? obj.glob ?? obj.type) as string | undefined;
    if (typeof pattern === 'string') {
      return scope ? `grep ${clip(pattern, 60)} in ${scope}` : `grep ${clip(pattern, 100)}`;
    }
  }

  // ---- glob / find --------------------------------------------------
  if (/^(glob|find)$/.test(name)) {
    const p = (obj.pattern ?? obj.glob) as string | undefined;
    if (typeof p === 'string') return `glob ${clip(p, 100)}`;
  }

  // ---- read with offset/limit --------------------------------------
  if (/^(read|read_file|cat)$/.test(name)) {
    const fp = pickPath(obj);
    const offset = obj.offset as number | undefined;
    const limit = obj.limit as number | undefined;
    if (fp && (typeof offset === 'number' || typeof limit === 'number')) {
      const start = offset ?? 0;
      const end = typeof limit === 'number' ? start + limit : '';
      return `read ${fp} (${start}…${end})`;
    }
    if (fp) return `read ${fp}`;
  }

  // ---- Fallback: pick the first non-empty "headline" string field --
  for (const k of FALLBACK_HEAD_FIELDS) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) {
      return `${k}: ${clip(v, 100)}`;
    }
  }
  // Last resort: compact JSON.
  const json = safeJson(input);
  return clip(json, 120);
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function pickPath(obj: Record<string, unknown>): string {
  const p = obj.file_path ?? obj.path ?? obj.filepath;
  return typeof p === 'string' ? p : '';
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
