'use client';

import { cn } from '@/lib/utils';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({
  value,
  className,
  label = 'Copy',
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      className={cn(
        'inline-grid size-8 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100',
        className,
      )}
    >
      {copied ? <Check className="size-4 text-term-green" /> : <Copy className="size-4" />}
    </button>
  );
}
