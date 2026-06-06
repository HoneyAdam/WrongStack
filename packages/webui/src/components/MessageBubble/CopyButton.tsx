import { cn } from '@/lib/utils';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { copyToClipboard } from './utils.js';

export function CopyButton({
  text,
  className,
  label = 'Copy',
}: {
  text: string;
  className?: string | undefined;
  label?: string | undefined;
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
