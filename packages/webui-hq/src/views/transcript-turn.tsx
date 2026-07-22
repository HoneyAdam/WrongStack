/**
 * Rich transcript turn renderers for the HQ Live Console — the WebUI-grade
 * chat surface. Each `HqTranscriptEntry` becomes one of:
 *   - a user bubble (right-aligned),
 *   - an assistant bubble (full GFM markdown + syntax-highlighted code),
 *   - a collapsed-by-default thinking card (model reasoning),
 *   - a collapsible tool card with a real result view (diff / terminal /
 *     numbered read / JSON / todo checklist), lucide icon + status, or
 *   - a subtle system / error line.
 *
 * @module views/transcript-turn
 */

import type { HqTranscriptEntry } from '@wrongstack/core/hq';
import { Brain, CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import type React from 'react';
import { memo, useState } from 'react';
import { CopyButton } from '../lib/copy-button.js';
import { Markdown } from '../lib/markdown.js';
import { getToolVisual } from '../lib/tool-visual.js';
import {
  classifyTool,
  extractTodos,
  formatClock,
  formatDuration,
  prettyInput,
  summarizeToolInput,
  type TodoItem,
  toolDisplayName,
} from '../lib/transcript-format.js';
import { isToolRunning } from '../lib/transcript-store.js';
import { hasToolDiff, ToolDiffView } from './diff-view.js';
import { ToolResultView } from './tool-result.js';

// ── Todo checklist ───────────────────────────────────────────────────────────

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

// ── Tool card ────────────────────────────────────────────────────────────────

/** Render the body of an expanded tool card: input view + result view. */
function ToolBody({ entry }: { entry: HqTranscriptEntry }): React.ReactElement {
  const kind = classifyTool(entry.tool);
  const diff = hasToolDiff(entry.tool, entry.toolInput);
  const todos = kind === 'todo' ? extractTodos(entry.toolInput) : null;
  const result = entry.text ?? '';
  const hasResult = result.trim() !== '';

  return (
    <div className="hq-tool-body">
      {diff ? (
        <div className="hq-tool-section">
          <div className="hq-tool-section-label">changes</div>
          <ToolDiffView toolName={entry.tool} toolInput={entry.toolInput} />
          {hasResult && !entry.isError && (
            <div className="hq-tool-result-note">{result.split('\n')[0]}</div>
          )}
        </div>
      ) : todos ? (
        <TodoList todos={todos} />
      ) : (
        entry.toolInput !== undefined &&
        entry.toolInput !== '{}' && (
          <div className="hq-tool-section">
            <div className="hq-tool-section-label">input</div>
            <pre className="hq-tool-pre">{prettyInput(entry.toolInput)}</pre>
          </div>
        )
      )}
      {!diff && hasResult && (
        <div className="hq-tool-section">
          <div className="hq-tool-section-head">
            <span className="hq-tool-section-label">{entry.isError ? 'error' : 'output'}</span>
            <CopyButton text={result} label="copy" />
          </div>
          <ToolResultView toolName={entry.tool} result={result} isError={entry.isError} />
        </div>
      )}
      {!hasResult && !entry.isError && !todos && !diff && (
        <div className="hq-tool-empty">(no output)</div>
      )}
    </div>
  );
}

function ToolTurn({
  entry,
  running,
}: {
  entry: HqTranscriptEntry;
  running: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(entry.tool, entry.toolInput);
  const duration = formatDuration(entry.durationMs);
  const name = toolDisplayName(entry.tool);
  const { Icon, color } = getToolVisual(entry.tool);

  return (
    <div className={`hq-chat-turn tool ${entry.isError ? 'err' : ''}`}>
      <button type="button" className="hq-tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="hq-tool-caret">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="hq-tool-icon" style={{ color }}>
          <Icon size={14} />
        </span>
        <span className="hq-tool-name">{name}</span>
        {summary !== '' && <span className="hq-tool-summary">{summary}</span>}
        {duration !== '' && <span className="hq-tool-dur">{duration}</span>}
        <span className="hq-tool-status" aria-hidden>
          {running ? (
            <span className="hq-tool-running-dot" title="running" />
          ) : entry.isError ? (
            <XCircle size={14} className="hq-status-err" />
          ) : (
            <CheckCircle2 size={14} className="hq-status-ok" />
          )}
        </span>
      </button>
      {open && <ToolBody entry={entry} />}
    </div>
  );
}

// ── Thinking card ────────────────────────────────────────────────────────────

function ThinkingTurn({ entry }: { entry: HqTranscriptEntry }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const firstLine = entry.text.split('\n')[0] ?? '';
  return (
    <div className="hq-chat-turn thinking">
      <button type="button" className="hq-thinking-head" onClick={() => setOpen((v) => !v)}>
        <span className="hq-tool-caret">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <Brain size={13} className="hq-thinking-icon" />
        <span className="hq-thinking-label">thinking</span>
        {!open && <span className="hq-thinking-peek">{firstLine}</span>}
      </button>
      {open && (
        <div className="hq-thinking-body">
          <Markdown text={entry.text} />
        </div>
      )}
    </div>
  );
}

// ── Public turn dispatcher ───────────────────────────────────────────────────

export const TranscriptTurn = memo(function TranscriptTurn({
  entry,
  running,
}: {
  entry: HqTranscriptEntry;
  /**
   * Whether a result-less tool card should show the running pulse. Callers
   * that know the entry's position pass `isToolRunning(e) && nearTail` so an
   * old call that never recorded a result doesn't pulse forever; standalone
   * rendering falls back to the shape check alone.
   */
  running?: boolean;
}): React.ReactElement | null {
  const clock = formatClock(entry.ts);

  // A failed tool call is merged into its args entry with role 'error' — it
  // still carries the tool name + input, so render it as an (error) tool card
  // rather than a bare error bubble.
  if (entry.role === 'tool' || (entry.role === 'error' && entry.toolInput !== undefined)) {
    return <ToolTurn entry={entry} running={running ?? isToolRunning(entry)} />;
  }
  if (entry.role === 'thinking') return <ThinkingTurn entry={entry} />;

  if (entry.role === 'user') {
    return (
      <div className="hq-chat-turn user">
        <div className="hq-chat-bubble user">
          <div className="hq-chat-role">
            you{entry.agentId !== undefined ? ` · ${entry.agentId}` : ''}
            {clock !== '' && <span className="hq-chat-clock">{clock}</span>}
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
            agent{entry.agentId !== undefined ? ` · ${entry.agentId}` : ''}
            {clock !== '' && <span className="hq-chat-clock">{clock}</span>}
          </div>
          <Markdown text={entry.text} />
        </div>
      </div>
    );
  }

  if (entry.role === 'error') {
    return (
      <div className="hq-chat-turn error">
        <div className="hq-chat-bubble error">
          <div className="hq-chat-role err">
            error{clock !== '' && <span className="hq-chat-clock">{clock}</span>}
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
        {clock !== '' && <span className="hq-chat-clock">{clock}</span>}
      </span>
    </div>
  );
});
