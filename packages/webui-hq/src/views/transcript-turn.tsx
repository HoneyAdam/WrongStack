/**
 * Rich transcript turn renderers for the HQ Live Console — the WebUI-grade
 * chat surface. Each `HqTranscriptEntry` becomes one of:
 *   - a user bubble (right-aligned),
 *   - an assistant bubble (left-aligned, fenced-code aware),
 *   - a collapsible tool card with a "real" result view (diff / terminal /
 *     file / JSON), or
 *   - a subtle system / error line.
 *
 * Kept dependency-free (no markdown/icon libs) to match the webui-hq stack.
 *
 * @module views/transcript-turn
 */

import type { HqTranscriptEntry } from '@wrongstack/core';
import type React from 'react';
import { useState } from 'react';
import {
  classifyTool,
  computeDiffLines,
  diffFromToolInput,
  extractTodos,
  formatClock,
  formatDuration,
  prettyInput,
  summarizeToolInput,
  type TodoItem,
  toolDisplayName,
} from '../lib/transcript-format.js';

// ── Copy affordance ──────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }): React.ReactElement {
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      },
      () => {},
    );
  };
  return (
    <button type="button" className="hq-copy-btn" onClick={copy} title="Copy to clipboard">
      {done ? 'copied' : 'copy'}
    </button>
  );
}

// ── Assistant text (lightweight fenced-code renderer) ────────────────────────

interface Segment {
  code: boolean;
  lang?: string;
  text: string;
}

/** Split assistant text into code / prose segments on ``` fences. */
export function splitFences(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ code: false, text: text.slice(last, m.index) });
    out.push({
      code: true,
      lang: (m[1] ?? '').trim() || undefined,
      text: (m[2] ?? '').replace(/\n$/, ''),
    });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last) });
  return out.length > 0 ? out : [{ code: false, text }];
}

function AssistantText({ text }: { text: string }): React.ReactElement {
  const segments = splitFences(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.code ? (
          <pre key={i} className="hq-chat-code">
            <span className="hq-chat-code-bar">
              {seg.lang && <span className="hq-chat-code-lang">{seg.lang}</span>}
              <span className="hq-chat-code-copy">
                <CopyButton text={seg.text} />
              </span>
            </span>
            <code>{seg.text}</code>
          </pre>
        ) : (
          seg.text.trim() !== '' && (
            <div key={i} className="hq-chat-prose">
              {seg.text.replace(/^\n+|\n+$/g, '')}
            </div>
          )
        ),
      )}
    </>
  );
}

// ── Tool result views ────────────────────────────────────────────────────────

function DiffBody({
  oldText,
  newText,
  path,
}: {
  oldText: string;
  newText: string;
  path?: string;
}): React.ReactElement {
  const lines = computeDiffLines(oldText, newText);
  const adds = lines.filter((l) => l.kind === 'add').length;
  const dels = lines.filter((l) => l.kind === 'del').length;
  return (
    <div className="hq-diff">
      <div className="hq-diff-stat">
        {path && (
          <span className="hq-diff-path" title={path}>
            {path}
          </span>
        )}
        <span className="hq-diff-add-count">+{adds}</span>
        <span className="hq-diff-del-count">-{dels}</span>
      </div>
      <pre className="hq-diff-body">
        {lines.map((l, i) => (
          <span key={i} className={`hq-diff-line ${l.kind}`}>
            <span className="hq-diff-gutter">
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
            </span>
            {l.text || ' '}
          </span>
        ))}
      </pre>
    </div>
  );
}

const TODO_MARK: Record<TodoItem['status'], string> = {
  completed: '✔',
  in_progress: '▶',
  pending: '○',
};

function TodoList({ todos }: { todos: TodoItem[] }): React.ReactElement {
  const done = todos.filter((t) => t.status === 'completed').length;
  return (
    <div className="hq-tool-section">
      <div className="hq-tool-section-label">
        todos · {done}/{todos.length} done
      </div>
      <ul className="hq-todo-list">
        {todos.map((t, i) => (
          <li key={i} className={`hq-todo ${t.status}`}>
            <span className="hq-todo-mark">{TODO_MARK[t.status]}</span>
            <span className="hq-todo-text">{t.content || '(empty)'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Render the "real" result view for a tool, chosen by tool family. */
function ToolResultView({ entry }: { entry: HqTranscriptEntry }): React.ReactElement | null {
  const kind = classifyTool(entry.tool);
  const diff = diffFromToolInput(entry.tool, entry.toolInput);

  // For edit/write the args ARE the change — show the diff regardless of result.
  if (diff) {
    return (
      <div className="hq-tool-section">
        <div className="hq-tool-section-label">changes</div>
        <DiffBody oldText={diff.oldText} newText={diff.newText} path={diff.path} />
        {entry.text.trim() !== '' && !entry.isError && (
          <div className="hq-tool-result-note">{entry.text.split('\n')[0]}</div>
        )}
      </div>
    );
  }

  // TodoWrite → a real checklist instead of raw JSON.
  const todos = kind === 'todo' ? extractTodos(entry.toolInput) : null;

  const result = entry.text ?? '';
  const hasResult = result.trim() !== '';

  return (
    <>
      {todos ? (
        <TodoList todos={todos} />
      ) : (
        entry.toolInput &&
        entry.toolInput !== '{}' && (
          <div className="hq-tool-section">
            <div className="hq-tool-section-label">input</div>
            <pre className="hq-tool-pre">{prettyInput(entry.toolInput)}</pre>
          </div>
        )
      )}
      {hasResult && (
        <div className="hq-tool-section">
          <div className="hq-tool-section-head">
            <span className="hq-tool-section-label">{entry.isError ? 'error' : 'output'}</span>
            <CopyButton text={result} />
          </div>
          <pre
            className={`hq-tool-pre ${entry.isError ? 'err' : ''} ${kind === 'bash' ? 'term' : ''}`}
          >
            {result}
          </pre>
        </div>
      )}
      {!hasResult && !entry.isError && !todos && <div className="hq-tool-empty">(no output)</div>}
    </>
  );
}

function ToolTurn({ entry }: { entry: HqTranscriptEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(entry.tool, entry.toolInput);
  const duration = formatDuration(entry.durationMs);
  const name = toolDisplayName(entry.tool);
  const status = entry.isError ? 'err' : 'ok';

  return (
    <div className={`hq-chat-turn tool ${entry.isError ? 'err' : ''}`}>
      <button type="button" className="hq-tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="hq-tool-caret">{open ? '▾' : '▸'}</span>
        <span className={`hq-tool-dot ${status}`} aria-hidden />
        <span className="hq-tool-name">{name}</span>
        {summary && <span className="hq-tool-summary">{summary}</span>}
        {duration && <span className="hq-tool-dur">{duration}</span>}
      </button>
      {open && (
        <div className="hq-tool-body">
          <ToolResultView entry={entry} />
        </div>
      )}
    </div>
  );
}

// ── Public turn dispatcher ───────────────────────────────────────────────────

export function TranscriptTurn({ entry }: { entry: HqTranscriptEntry }): React.ReactElement | null {
  const clock = formatClock(entry.ts);

  if (entry.role === 'tool') return <ToolTurn entry={entry} />;

  if (entry.role === 'user') {
    return (
      <div className="hq-chat-turn user">
        <div className="hq-chat-bubble user">
          <div className="hq-chat-role">
            you{entry.agentId ? ` · ${entry.agentId}` : ''}
            {clock && <span className="hq-chat-clock">{clock}</span>}
          </div>
          <div className="hq-chat-prose">{entry.text}</div>
        </div>
      </div>
    );
  }

  if (entry.role === 'assistant') {
    return (
      <div className="hq-chat-turn assistant">
        <div className="hq-chat-bubble assistant">
          <div className="hq-chat-role">
            agent{entry.agentId ? ` · ${entry.agentId}` : ''}
            {clock && <span className="hq-chat-clock">{clock}</span>}
          </div>
          <AssistantText text={entry.text} />
        </div>
      </div>
    );
  }

  if (entry.role === 'error') {
    return (
      <div className="hq-chat-turn error">
        <div className="hq-chat-bubble error">
          <div className="hq-chat-role err">
            error{clock && <span className="hq-chat-clock">{clock}</span>}
          </div>
          <pre className="hq-tool-pre err">{entry.text}</pre>
        </div>
      </div>
    );
  }

  // system
  if (entry.text.trim() === '') return null;
  return (
    <div className="hq-chat-turn system">
      <span className="hq-chat-system-line">
        {entry.text}
        {clock && <span className="hq-chat-clock">{clock}</span>}
      </span>
    </div>
  );
}
