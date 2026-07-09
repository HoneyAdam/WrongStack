/**
 * Tiny copy-to-clipboard affordance shared by code blocks, tool results and
 * diff views. Flashes a check for a moment after a successful copy.
 *
 * @module lib/copy-button
 */
import { Check, Copy } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

export function CopyButton({ text, label }: { text: string; label?: string }): React.ReactElement {
  const [done, setDone] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      },
      () => {},
    );
  };
  return (
    <button type="button" className="hq-copy-btn" onClick={copy} title="Copy to clipboard">
      {done ? <Check size={12} /> : <Copy size={12} />}
      {label !== undefined && <span>{done ? 'copied' : label}</span>}
    </button>
  );
}
