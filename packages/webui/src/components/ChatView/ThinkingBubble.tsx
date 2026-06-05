import { useChatStore } from '@/stores';
import { Brain } from 'lucide-react';

/**
 * Soft, ephemeral chip rendered while the model is mid-reasoning. Reads the
 * thinking buffer straight from the chat store so it stays in sync with the
 * stream without re-rendering the full message list.
 */
export function ThinkingBubble() {
  const buf = useChatStore((s) => s.thinkingBuffer);
  if (!buf) return null;
  const tailLines = buf.split('\n').slice(-6);
  const tail = tailLines.join('\n').trim();
  return (
    <div className="flex gap-3 animate-message">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-2 ring-offset-2 ring-offset-background ring-violet-500/20">
        <Brain className="h-4 w-4 animate-pulse" />
      </div>
      <div className="flex flex-col gap-1 max-w-[85%] min-w-0">
        <span className="text-xs font-medium text-violet-600 dark:text-violet-400 px-1">
          Thinking…
        </span>
        <div className="rounded-2xl rounded-bl-md px-3 py-2 bg-violet-500/[0.04] border border-violet-500/20 text-foreground/80">
          <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed italic max-h-32 overflow-hidden">
            {tail || '…'}
          </pre>
        </div>
      </div>
    </div>
  );
}
