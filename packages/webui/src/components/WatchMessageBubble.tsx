/**
 * WatchMessageBubble — renders a session watch entry with the same visual
 * style as the main ChatView MessageBubble.
 *
 * Mirrors the ChatView bubble aesthetic:
 * - Avatar circle with role-specific icon
 * - Rounded bubble with role-specific background
 * - Full markdown rendering (ReactMarkdown + remarkGfm)
 * - Error styling for error-role entries
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, Bot, Terminal, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CopyButton } from './MessageBubble/CopyButton.js';
import { ToolInputView } from './MessageBubble/ToolInputView.js';
import { ErrorBodyWithStack } from './MessageBubble/ErrorBody.js';

interface WatchEntry {
  ts: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
  text: string;
  tool?: string;
}

interface WatchMessageBubbleProps {
  entry: WatchEntry;
  isContinuation?: boolean;
}

const ROLE_CONFIG: Record<
  WatchEntry['role'],
  {
    Icon: typeof User;
    label: string;
    avatarBg: string;
    avatarColor: string;
    avatarRing: string;
    bubbleBg: string;
    bubbleBorder: string;
    textColor: string;
  }
> = {
  user: {
    Icon: User,
    label: 'You',
    avatarBg: 'bg-blue-500/10',
    avatarColor: 'text-blue-600 dark:text-blue-400',
    avatarRing: 'ring-2 ring-offset-2 ring-offset-background ring-blue-500/20',
    bubbleBg: 'bg-blue-500/[0.06]',
    bubbleBorder: 'border-blue-500/15',
    textColor: 'text-blue-900 dark:text-blue-100',
  },
  assistant: {
    Icon: Bot,
    label: 'Claude',
    avatarBg: 'bg-violet-500/10',
    avatarColor: 'text-violet-600 dark:text-violet-400',
    avatarRing: 'ring-2 ring-offset-2 ring-offset-background ring-violet-500/20',
    bubbleBg: 'bg-violet-500/[0.06]',
    bubbleBorder: 'border-violet-500/15',
    textColor: 'text-violet-900 dark:text-violet-100',
  },
  tool: {
    Icon: Terminal,
    label: 'Tool',
    avatarBg: 'bg-amber-500/10',
    avatarColor: 'text-amber-600 dark:text-amber-400',
    avatarRing: 'ring-2 ring-offset-2 ring-offset-background ring-amber-500/20',
    bubbleBg: 'bg-amber-500/[0.06]',
    bubbleBorder: 'border-amber-500/15',
    textColor: 'text-amber-900 dark:text-amber-100',
  },
  system: {
    Icon: Bot,
    label: 'System',
    avatarBg: 'bg-gray-500/10',
    avatarColor: 'text-gray-500',
    avatarRing: 'ring-2 ring-offset-2 ring-offset-background ring-gray-500/10',
    bubbleBg: 'bg-gray-500/[0.06]',
    bubbleBorder: 'border-gray-500/15',
    textColor: 'text-gray-600 dark:text-gray-300',
  },
  error: {
    Icon: AlertCircle,
    label: 'Error',
    avatarBg: 'bg-red-500/10',
    avatarColor: 'text-red-600 dark:text-red-400',
    avatarRing: 'ring-2 ring-offset-2 ring-offset-background ring-red-500/20',
    bubbleBg: 'bg-red-500/[0.06]',
    bubbleBorder: 'border-red-500/15',
    textColor: 'text-red-900 dark:text-red-100',
  },
};

function WatchBubbleContent({ entry }: { entry: WatchEntry }) {
  if (!entry.text) return null;

  if (entry.role === 'error') {
    return <ErrorBodyWithStack text={entry.text} />;
  }

  if (entry.role === 'tool') {
    // Try to parse tool input from text (format: "toolName\n{json}")
    const lines = entry.text.split('\n');
    let toolName = entry.tool || 'tool';
    let inputText: string | null = null;

    // If text contains a JSON object, try to parse it
    if (lines.length > 1) {
      const maybeJson = lines.slice(1).join('\n');
      try {
        JSON.parse(maybeJson);
        toolName = lines[0] || entry.tool || 'tool';
        inputText = maybeJson;
      } catch {
        // Not JSON, render as plain text
      }
    }

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          <Terminal className="h-3 w-3" />
          {toolName}
        </div>
        {inputText ? (
          <div className="rounded-lg bg-black/20 dark:bg-white/5 border border-amber-500/20 p-2">
            <ToolInputView input={JSON.parse(inputText)} />
          </div>
        ) : (
          <div className="prose-sm dark:prose-invert prose-p:my-1 prose-pre:m-0 max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.text}</ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="prose-sm dark:prose-invert prose-p:my-1 prose-pre:m-0 max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1">{children}</p>,
          pre: ({ children }) => <pre className="m-0 rounded-lg bg-muted">{children}</pre>,
          code: ({ children }) => (
            <code className="text-sm bg-muted rounded px-1 py-0.5">{children}</code>
          ),
        }}
      >
        {entry.text}
      </ReactMarkdown>
    </div>
  );
}

export function WatchMessageBubble({
  entry,
  isContinuation = false,
}: WatchMessageBubbleProps) {
  const cfg = ROLE_CONFIG[entry.role];
  const Icon = cfg.Icon;

  return (
    <div className="group flex gap-3 animate-message msg-bubble rounded-lg transition-shadow">
      {/* Avatar — blank spacer for continuation, matching ChatView continuation pattern */}
      {isContinuation ? (
        <div className="flex-shrink-0 w-8" />
      ) : (
        <div
          className={cn(
            'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
            cfg.avatarBg,
            cfg.avatarColor,
            cfg.avatarRing,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      )}

      {/* Content */}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        {/* Role label + timestamp — only shown on first message of a chain */}
        {!isContinuation && (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-[11px] font-semibold',
                entry.role === 'user' && 'text-blue-600 dark:text-blue-400',
                entry.role === 'assistant' && 'text-violet-600 dark:text-violet-400',
                entry.role === 'tool' && 'text-amber-600 dark:text-amber-400',
                entry.role === 'system' && 'text-gray-500',
                entry.role === 'error' && 'text-red-600 dark:text-red-400',
              )}
            >
              {entry.role === 'tool' && entry.tool ? entry.tool : cfg.label}
            </span>
            <span className="text-[10px] text-gray-500">
              {new Date(entry.ts).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'rounded-2xl px-3 py-2 border',
            entry.role === 'user' && 'rounded-bl-md bg-blue-500/[0.06] border-blue-500/15',
            entry.role === 'assistant' && 'rounded-bl-md bg-violet-500/[0.06] border-violet-500/15',
            entry.role === 'tool' && 'rounded-bl-sm bg-amber-500/[0.06] border-amber-500/15',
            entry.role === 'system' && 'rounded-bl-sm bg-gray-500/[0.06] border-gray-500/15 opacity-70',
            entry.role === 'error' && 'rounded-bl-sm bg-red-500/[0.06] border-red-500/30',
          )}
        >
          <div
            className={cn(
              'text-sm leading-relaxed',
              entry.role === 'user' && 'text-blue-900 dark:text-blue-100',
              entry.role === 'assistant' && 'text-violet-900 dark:text-violet-100',
              entry.role === 'tool' && 'text-amber-900 dark:text-amber-100',
              entry.role === 'system' && 'text-gray-600 dark:text-gray-300',
              entry.role === 'error' && 'text-red-900 dark:text-red-100',
            )}
          >
            <WatchBubbleContent entry={entry} />
          </div>
        </div>

        {/* Copy button — group-hover for hover visibility, matching ChatView */}
        {entry.text && entry.role !== 'error' && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton text={entry.text} label="Copy" />
          </div>
        )}
      </div>
    </div>
  );
}
