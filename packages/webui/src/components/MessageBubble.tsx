import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores';
import {
  User,
  Bot,
  Terminal,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Check,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Tiny copy-to-clipboard helper used by the in-bubble copy buttons. Falls
 * back to the legacy `document.execCommand('copy')` path on insecure
 * (non-HTTPS, non-localhost) contexts where `navigator.clipboard` is
 * blocked — the WebUI is usually loaded from 127.0.0.1 over plain http so
 * we hit this fallback regularly.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * ReactMarkdown component overrides. Fenced code blocks render with a
 * header strip (language label + copy button) and an internally scrollable
 * body so a 200-line snippet doesn't blow up the chat. Inline `code` stays
 * styled simply. Kept at module scope so the components object reference is
 * stable across renders.
 */
const markdownComponents = {
  code({ inline, className, children, ...props }: {
    inline?: boolean;
    className?: string;
    children?: React.ReactNode;
  }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const codeText = String(children ?? '').replace(/\n$/, '');
    if (inline || !match) {
      return (
        <code
          className={cn(
            'rounded bg-muted/60 px-1.5 py-0.5 text-[0.85em] font-mono',
            className,
          )}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <div className="not-prose relative my-3 rounded-lg border bg-muted/30 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/40 text-xs">
          <span className="font-mono text-muted-foreground">{match[1]}</span>
          <CopyButton text={codeText} label="" />
        </div>
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed font-mono max-h-[40rem]">
          <code>{codeText}</code>
        </pre>
      </div>
    );
  },
};

function CopyButton({
  text,
  className,
  label = 'Copy',
}: {
  text: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (ev) => {
        ev.stopPropagation();
        const ok = await copyToClipboard(text);
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }
      }}
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors',
        className,
      )}
      title={label}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isFirst?: boolean;
}

function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * Render tool input as a tight one-liner for the collapsed view. We pick the
 * fields that matter most across our common tools (file path, pattern, cmd,
 * url) and fall back to a compact JSON. Used so eight parallel `tree` calls
 * with identical args don't look identical in the chat.
 */
function summarizeToolInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'object') return String(input).slice(0, 120);
  const o = input as Record<string, unknown>;
  const head = ['path', 'file_path', 'pattern', 'command', 'cmd', 'url', 'query'];
  for (const k of head) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) {
      const truncated = v.length > 100 ? `${v.slice(0, 97)}…` : v;
      return `${k}: ${truncated}`;
    }
  }
  // Fallback: compact JSON, truncated.
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 117)}…` : json;
}

export function MessageBubble({ message, isFirst = false }: MessageBubbleProps) {
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isAssistant = message.role === 'assistant';

  const toggleTool = (id: string) => {
    setExpandedTools((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div
      data-message-id={message.id}
      className={cn(
        'group flex gap-3 animate-message rounded-lg transition-shadow',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          'ring-2 ring-offset-2 ring-offset-background',
          isUser
            ? 'bg-primary text-primary-foreground ring-primary/20'
            : isTool
            ? 'bg-secondary text-secondary-foreground ring-secondary/20'
            : 'bg-accent text-accent-foreground ring-accent/20'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : isTool ? (
          <Terminal className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-col gap-1.5 max-w-[85%]',
          isUser && 'items-end'
        )}
      >
        {/* Role indicator for first message in a group */}
        {isFirst && (
          <span
            className={cn(
              'text-xs font-medium px-1',
              isUser
                ? 'text-primary'
                : isTool
                ? 'text-secondary'
                : 'text-muted-foreground'
            )}
          >
            {isUser ? 'You' : isTool ? 'Tool' : 'Assistant'}
          </span>
        )}

        {/* Tool header */}
        {isTool && message.toolName && (
          <button
            type="button"
            onClick={() => toggleTool(message.id)}
            className={cn(
              'flex items-center gap-2 text-sm font-medium cursor-pointer select-none',
              'hover:bg-muted/50 rounded-lg px-2 py-1 -mx-2 transition-colors',
              message.isError ? 'text-destructive' : 'text-foreground'
            )}
          >
            <span className="text-muted-foreground/50">
              {expandedTools[message.id] ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </span>
            <Terminal className="h-3 w-3" />
            <span className="font-mono">{message.toolName}</span>
            {message.toolResult === undefined ? (
              // Pulsing dot while still running (matches the inline indicator below).
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
            ) : message.isError ? (
              <XCircle className="h-3 w-3 text-destructive" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            )}
            {typeof message.toolDurationMs === 'number' && (
              <span className="text-xs text-muted-foreground tabular-nums font-normal">
                {formatToolDuration(message.toolDurationMs)}
              </span>
            )}
          </button>
        )}

        {/* Message content */}
        <div
          className={cn(
            'rounded-2xl px-4 py-3',
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : isTool
              ? message.isError
                ? 'bg-destructive/5 border border-destructive/20 text-destructive'
                : 'bg-muted/80 text-foreground'
              : 'bg-card border text-foreground',
            message.isError && !isTool && 'border-destructive/20'
          )}
        >
          {isTool ? (
            (() => {
              const expanded = !!expandedTools[message.id];
              const inputSummary = message.toolInput !== undefined ? summarizeToolInput(message.toolInput) : '';
              const lines = message.toolResult ? message.toolResult.split('\n').length : 0;
              return (
                <div className="space-y-1">
                  {/* Collapsed: just a one-line input summary so parallel calls
                      stay distinguishable. The output is hidden entirely —
                      click the header (or "Show details" link) to expand. */}
                  {inputSummary && !expanded && (
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {inputSummary}
                    </div>
                  )}
                  {/* Expanded: full JSON input + full output box. */}
                  {expanded && message.toolInput !== undefined && (
                    <div className="p-3 bg-muted/50 rounded-lg text-xs font-mono overflow-x-auto">
                      <div className="flex items-center gap-1 text-muted-foreground mb-2">
                        <Clock className="h-3 w-3" />
                        <span>Input</span>
                      </div>
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(message.toolInput, null, 2)}
                      </pre>
                    </div>
                  )}
                  {expanded && message.toolResult !== undefined && message.toolResult.length > 0 && (
                    <div className="relative group/tool">
                      <div
                        className={cn(
                          'text-xs font-mono whitespace-pre-wrap break-all rounded-md bg-background/40 border border-border/40 p-2 max-h-96 overflow-auto',
                          message.isError ? 'text-destructive' : 'text-foreground',
                        )}
                      >
                        {message.toolResult}
                      </div>
                      <CopyButton
                        text={message.toolResult}
                        label=""
                        className="absolute top-1.5 right-1.5 opacity-0 group-hover/tool:opacity-100 transition-opacity bg-background/80 border rounded px-1.5 py-0.5"
                      />
                    </div>
                  )}
                  {expanded && message.toolResult !== undefined && message.toolResult.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">(empty)</span>
                  )}
                  {/* Error case: keep the message inline even when collapsed,
                      since silently hiding a failure is worse than the noise. */}
                  {!expanded && message.isError && message.toolResult && (
                    <div className="text-xs font-mono text-destructive truncate">
                      {message.toolResult.split('\n')[0]}
                    </div>
                  )}
                  {/* "Show details" toggle — only when there's anything to reveal. */}
                  {((message.toolResult !== undefined && message.toolResult.length > 0) ||
                    (message.toolInput !== undefined && Object.keys((message.toolInput as object) ?? {}).length > 0)) && (
                    <button
                      type="button"
                      onClick={() => toggleTool(message.id)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {expanded
                        ? 'Hide details'
                        : `Show details${lines > 0 ? ` (${lines} line${lines === 1 ? '' : 's'})` : ''}`}
                    </button>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="text-sm leading-relaxed markdown-content">
              {message.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
              ) : message.streaming ? (
                <span className="inline-block animate-pulse text-muted-foreground">
                  Typing...
                </span>
              ) : (
                <span className="text-muted-foreground italic">No content</span>
              )}
            </div>
          )}
        </div>

        {/* Footer: timestamp + copy. Copy is hover-revealed so the chat
            stays clean by default. Tool bubbles get their own copy button
            on the output box, so we skip it here for them. */}
        <div
          className={cn(
            'flex items-center gap-2 px-1',
            isUser ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <span className="text-xs text-muted-foreground/50">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {!isTool && message.content && !message.streaming && (
            <CopyButton
              text={message.content}
              label=""
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
        </div>
      </div>
    </div>
  );
}
