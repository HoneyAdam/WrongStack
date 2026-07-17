import { Check, Copy, ListChecks, LoaderCircle } from 'lucide-react';
import { memo, useMemo } from 'react';
import { MarkdownHooks as ReactMarkdown } from 'react-markdown';
import rehypePrettyCode from 'rehype-pretty-code';
import remarkGfm from 'remark-gfm';
import { FileEditEntry } from './file-edit-entry.js';
import { projectAssistantMessage } from './lib/message-projection.js';
import type { ChatMessage, FileEditMeta } from './types.js';

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** File edits to show as inline widgets in the chat timeline. */
  fileEdits?: Array<{ edit: FileEditMeta; ts?: string | undefined }> | undefined;
  latestAssistantId: string | undefined;
  copiedMessageId: string | null;
  running: boolean;
  activity: string;
  emptyState: React.ReactNode;
  onCopyMessage: (id: string, text: string) => void;
  onSelectNextStep: (text: string) => void;
  /** Open the file diff panel for a single file edit. */
  onOpenDiff?: ((meta: FileEditMeta) => void) | undefined;
}

// ── Memo'd sub-components ──────────────────────────────────────────

interface MessageItemProps {
  message: ChatMessage;
  isLatestAssistant: boolean;
  copiedMessageId: string | null;
  onCopyMessage: (id: string, text: string) => void;
  onSelectNextStep: (text: string) => void;
}

const MessageItem = memo(function MessageItem({
  message,
  isLatestAssistant,
  copiedMessageId,
  onCopyMessage,
  onSelectNextStep,
}: MessageItemProps) {
  const projection =
    message.role === 'assistant'
      ? projectAssistantMessage(message.text)
      : { text: message.text, nextSteps: [] };
  const nextSteps = isLatestAssistant && !message.streaming ? projection.nextSteps : [];

  return (
    <article className={`message ${message.role}`}>
      <div className="message-label">
        <span>
          {message.role === 'user'
            ? 'YOU'
            : message.role === 'thinking'
              ? 'MODEL REASONING'
              : message.role === 'assistant'
                ? 'WRONGSTACK'
                : 'SYSTEM'}
        </span>
        {message.role === 'assistant' && projection.text && !message.streaming && (
          <button
            type="button"
            className={`message-copy${copiedMessageId === message.id ? ' copied' : ''}`}
            aria-label={copiedMessageId === message.id ? 'Response copied' : 'Copy response'}
            title={copiedMessageId === message.id ? 'Copied' : 'Copy response'}
            onClick={() => onCopyMessage(message.id, projection.text)}
          >
            {copiedMessageId === message.id ? (
              <Check size={12} aria-hidden="true" />
            ) : (
              <Copy size={12} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      <div className="message-body">
        {message.images && message.images.length > 0 && (
          <div className="message-images">
            {message.images.map((img, i) => (
              <img key={i} src={img.data} className="message-image" alt={`Attached ${i + 1}`} />
            ))}
          </div>
        )}
        {projection.text && !message.streaming && (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[
              [rehypePrettyCode, { theme: 'github-dark-dimmed', keepBackground: false }],
            ]}
            components={{
              a: ({ children, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
            fallback={null}
          >
            {projection.text}
          </ReactMarkdown>
        )}
        {projection.text && message.streaming && (
          <span className="streaming-text">{projection.text}</span>
        )}
        {message.streaming && (
          <span className="stream-caret" role="status" aria-label="Streaming" aria-busy="true" />
        )}
        {nextSteps.length > 0 && (
          <section className="next-steps" aria-label="Suggested next steps">
            <div className="next-steps-heading">
              <ListChecks size={14} aria-hidden="true" />
              <span>NEXT STEPS</span>
            </div>
            <div className="next-steps-list">
              {nextSteps.map((step) => (
                <button
                  type="button"
                  className="next-step"
                  key={`${step.index}:${step.text}`}
                  onClick={() => onSelectNextStep(step.text)}
                >
                  <span className="next-step-index">{step.index}</span>
                  <span className="next-step-text">{step.text}</span>
                  {step.auto && <span className="next-step-auto">AUTO</span>}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </article>
  );
});

// ── Container ──────────────────────────────────────────────────────

/**
 * Renders the chat messages + inline file-edit widgets.
 * Tool calls (delegate, task, kanban, etc.) are NOT shown here —
 * they live in the tool sidebar. Only file operations get inline widgets.
 */
export function ChatMessageList({
  messages,
  fileEdits,
  latestAssistantId,
  copiedMessageId,
  running,
  activity,
  emptyState,
  onCopyMessage,
  onSelectNextStep,
  onOpenDiff,
}: ChatMessageListProps) {
  // Interleave file edits into the timeline by timestamp
  const timeline = useMemo(() => {
    const entries: Array<{ kind: 'message'; ts: string; message: ChatMessage } | { kind: 'file_edit'; ts: string; edit: FileEditMeta }> = [];

    for (const m of messages) {
      entries.push({ kind: 'message', ts: m.ts ?? '0', message: m });
    }

    if (fileEdits) {
      for (const fe of fileEdits) {
        entries.push({ kind: 'file_edit', ts: fe.ts ?? '0', edit: fe.edit });
      }
    }

    entries.sort((a, b) => {
      if (a.ts < b.ts) return -1;
      if (a.ts > b.ts) return 1;
      return 0;
    });

    return entries;
  }, [messages, fileEdits]);

  if (timeline.length === 0) {
    return <div className="conversation">{emptyState}</div>;
  }

  return (
    <div className="conversation">
      {timeline.map((entry) => {
        if (entry.kind === 'message') {
          return (
            <MessageItem
              key={entry.message.id}
              message={entry.message}
              isLatestAssistant={entry.message.id === latestAssistantId}
              copiedMessageId={copiedMessageId}
              onCopyMessage={onCopyMessage}
              onSelectNextStep={onSelectNextStep}
            />
          );
        }
        // file_edit
        return (
          <FileEditEntry
            key={`fe-${entry.edit.path}-${entry.ts}`}
            edit={entry.edit}
            ts={entry.ts}
            onOpenDiff={onOpenDiff ?? (() => undefined)}
          />
        );
      })}
      {running && activity && (
        <div className="activity-line" role="status" aria-live="polite">
          <LoaderCircle size={14} className="spin" />
          <span>{activity}</span>
        </div>
      )}
    </div>
  );
}
