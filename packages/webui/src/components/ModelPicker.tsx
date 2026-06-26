import { Check, ChevronDown, Cpu, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelCandidate } from '@/hooks/useProviderModels';
import { cn } from '@/lib/utils';

/**
 * ModelPicker — a compact searchable {provider/model} combobox used across the
 * SDD surfaces (per-task drawer, run-config wizard, board header). Inline only;
 * no native dialogs. Emits the chosen model + provider, or `undefined` (via the
 * reset row) to fall back to the run/leader default.
 */
export function ModelPicker({
  value,
  provider,
  candidates,
  placeholder = 'Run default',
  resetLabel = 'Use run default',
  onPick,
  onReset,
  className,
}: {
  value?: string | undefined;
  provider?: string | undefined;
  candidates: ModelCandidate[];
  placeholder?: string;
  resetLabel?: string;
  onPick: (model: string, provider: string) => void;
  onReset?: (() => void) | undefined;
  className?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? candidates.filter((c) => `${c.provider}/${c.model} ${c.label}`.toLowerCase().includes(q))
      : candidates;
    return list.slice(0, 60);
  }, [candidates, query]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1.5 text-left text-xs hover:border-violet-500/50"
      >
        <Cpu className="h-3.5 w-3.5 shrink-0 text-violet-400" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            value ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {value ? (provider ? `${provider}/${value}` : value) : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="sdd-rise absolute z-50 mt-1 max-h-72 w-full min-w-[240px] overflow-hidden rounded-md border border-border bg-popover shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models…"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {onReset && (
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" /> {resetLabel}
              </button>
            )}
            {filtered.map((c) => {
              const selected = c.model === value && (!provider || c.provider === provider);
              return (
                <button
                  key={`${c.provider}/${c.model}`}
                  type="button"
                  onClick={() => {
                    onPick(c.model, c.provider);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-start gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-muted',
                    selected ? 'text-violet-700 dark:text-violet-200' : 'text-foreground',
                  )}
                >
                  {selected ? (
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.label}</span>
                    {c.description && (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {c.description}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 shrink-0 font-mono text-[9px] text-muted-foreground">
                    {c.provider}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                {candidates.length === 0 ? 'Loading models…' : 'No match'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
