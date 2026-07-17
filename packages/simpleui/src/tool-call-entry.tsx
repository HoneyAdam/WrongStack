import { Check, ChevronDown, ChevronRight, FileEdit, LoaderCircle, Wrench, X } from 'lucide-react';
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

export const ToolCallEntry = memo(function ToolCallEntry({
  toolCall,
  onOpenDiff,
}: ToolCallEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = STATUS_ICON[toolCall.status];
  const fileEdit = toolCall.status === 'done' ? extractFileEditMeta(toolCall) : null;
  const isFileEdit = fileEdit !== null;

  return (
    <article className={`timeline-tool ${toolCall.status}`}>
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
        {isFileEdit ? <FileEdit size={12} aria-hidden="true" /> : <Wrench size={12} aria-hidden="true" />}
        <code>{toolCall.name}</code>
        {isFileEdit && (
          <span className="timeline-tool-path" title={fileEdit.path}>
            {fileEdit.path.split(/[\\/]/).pop() ?? fileEdit.path}
          </span>
        )}
        {isFileEdit && fileEdit.replacements != null && fileEdit.replacements > 0 && (
          <span className="timeline-diff-added">+{fileEdit.replacements}</span>
        )}
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
        {isFileEdit && onOpenDiff && (
          <span className="timeline-tool-diff-link" onClick={(e) => { e.stopPropagation(); onOpenDiff(fileEdit); }}>
            View diff
          </span>
        )}
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
    </article>
  );
});
