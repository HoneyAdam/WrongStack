import { cn } from '@/lib/utils';
import { CopyButton } from './CopyButton.js';
import type React from 'react';

export { copyToClipboard };

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

export function downloadTextFile(filename: string, text: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileExtensionFor(toolName: string | undefined): string {
  const t = (toolName ?? '').toLowerCase();
  if (/bash|shell|exec|run/.test(t)) return 'log';
  if (/grep|search|find/.test(t)) return 'txt';
  return 'txt';
}

export function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export const markdownComponents = {
  code({
    inline,
    className,
    children,
    ...props
  }: {
    inline?: boolean;
    className?: string;
    children?: React.ReactNode;
  }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const codeText = String(children ?? '').replace(/\n$/, '');
    if (inline || !match) {
      return (
        <code className={cn('rounded bg-muted/60 px-1.5 py-0.5 text-[0.85em] font-mono', className)} {...props}>
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
