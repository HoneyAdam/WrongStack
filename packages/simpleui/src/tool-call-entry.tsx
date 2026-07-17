import { Check, ChevronDown, ChevronRight, Clock, FileEdit, LoaderCircle, X } from 'lucide-react';
import { memo, useState } from 'react';
import { extractFileEditMeta } from './lib/timeline-model.js';
import type { FileEditMeta, ToolCallInfo } from './types.js';

interface ToolCallEntryProps {
  toolCall: ToolCallInfo;
  onOpenDiff?: ((meta: FileEditMeta) => void) | undefined;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const STATUS_ICON: Record<ToolCallInfo['status'], typeof Check> = {
  running: LoaderCircle,
  done: Check,
  error: X,
};

const STATUS_LABEL: Record<ToolCallInfo['status'], string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
};

/** Format an ISO timestamp into a readable short form (HH:MM:SS). */
function formatTimestamp(ts: string | undefined): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

/** Human-readable label for file-operation tool names. */
function toolLabel(name: string): string {
  switch (name) {
    case 'read': return 'Read file';
    case 'edit': return 'Edit file';
    case 'write': return 'Write file';
    case 'patch': return 'Apply patch';
    case 'replace': return 'Replace in files';
    case 'glob': return 'Find files';
    case 'grep': return 'Search files';
    default: return `Run \`${name}\``;
  }
}

export const ToolCallEntry = memo(function ToolCallEntry({
  toolCall,
  onOpenDiff,
}: ToolCallEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = STATUS_ICON[toolCall.status];
  const fileEdit = extractFileEditMeta(toolCall);
  const label = toolLabel(toolCall.name);
  const time = formatTimestamp(toolCall.ts);
  const isFileEdit = fileEdit !== null;

  return (
    <article className={`message tool-message ${toolCall.status}`}>
      <div className="message-label">
        <span>{label.toUpperCase()}</span>
        {isFileEdit && onOpenDiff && toolCall.status === 'done' && (
          <button
            type="button"
            className="message-copy"
            aria-label={`View diff for ${fileEdit.path}`}
            title={`View diff for ${fileEdit.path}`}
            onClick={() => onOpenDiff(fileEdit)}
          >
            <FileEdit size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="message-body">
        <button
          type="button"
          className="timeline-tool-trigger"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )}
          {isFileEdit ? (
            <span className="timeline-tool-path" title={fileEdit.path}>
              {fileEdit.path.split(/[\\/]/).pop() ?? fileEdit.path}
            </span>
          ) : (
            <code>{toolCall.name}</code>
          )}
          {isFileEdit && fileEdit.replacements != null && fileEdit.replacements > 0 && (
            <span className="timeline-diff-added">+{fileEdit.replacements}</span>
          )}
          <span className="timeline-tool-meta">
            <Icon
              size={12}
              className={toolCall.status === 'running' ? 'spin' : toolCall.status === 'done' ? 'timeline-tool-ok' : 'timeline-tool-error'}
              aria-label={STATUS_LABEL[toolCall.status]}
            />
            <span className="timeline-tool-status">
              {STATUS_LABEL[toolCall.status]}
              {toolCall.durationMs != null && toolCall.status === 'done'
                ? ` · ${toolCall.durationMs}ms`
                : ''}
            </span>
            {time && (
              <span className="timeline-tool-time">
                <Clock size={10} aria-hidden="true" />
                <span>{time}</span>
              </span>
            )}
          </span>
        </button>

        {expanded && (
          <div className="timeline-tool-detail">
            {toolCall.input !== undefined && (
              <section>
                <span>INPUT</span>
                <pre>{displayValue(toolCall.input)}</pre>
              </section>
            )}
            {toolCall.output !== undefined && (
              <section>
                <span>OUTPUT</span>
                <pre>{displayValue(toolCall.output)}</pre>
              </section>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
