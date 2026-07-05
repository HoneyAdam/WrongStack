import { useChatStore } from '@/stores';
import { useAppTranslation } from '@/i18n';
import { Brain } from 'lucide-react';
import './thinking-bubble.css';

/**
 * Soft, ephemeral chip rendered while the model is mid-reasoning. Reads the
 * thinking buffer straight from the chat store so it stays in sync with the
 * stream without re-rendering the full message list.
 */
export function ThinkingBubble() {
  const { t } = useAppTranslation();
  const buf = useChatStore((s) => s.thinkingBuffer);
  if (!buf) return null;
  const tailLines = buf.split('\n').slice(-6);
  const tail = tailLines.join('\n').trim();
  return (
    <div className="flex gap-3 animate-message thinking-bubble" aria-live="polite">
      <div className="thinking-orb flex-shrink-0" aria-hidden>
        <span className="thinking-orb__ring" />
        <span className="thinking-orb__ring thinking-orb__ring--delay" />
        <span className="thinking-orb__spark thinking-orb__spark--one" />
        <span className="thinking-orb__spark thinking-orb__spark--two" />
        <Brain className="thinking-orb__icon h-4 w-4" />
      </div>
      <div className="flex flex-col gap-1 max-w-[85%] min-w-0">
        <span className="thinking-label text-xs font-medium text-primary px-1">
          <span>{t('chat:thinking')}</span>
          <span className="thinking-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </span>
        <div className="thinking-panel rounded-2xl rounded-bl-md px-3 py-2 border text-foreground/80">
          <div className="thinking-wave" aria-hidden>
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <pre className="thinking-text whitespace-pre-wrap break-words font-sans text-xs leading-relaxed italic max-h-32 overflow-hidden">
            {tail || '…'}
          </pre>
        </div>
      </div>
    </div>
  );
}
