import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { ModelCandidate } from '@/hooks/useProviderModels';
import { ModelPicker } from './ModelPicker';

/**
 * FallbackEditor — ordered model fallback chain editor (add / remove / reorder).
 * Entries are stored as `provider/model` strings (parseable by the core fallback
 * extension). Reused by the run-config wizard, the board header, and global
 * settings. Inline only; no native dialogs.
 */
export function FallbackEditor({
  value,
  candidates,
  onChange,
}: {
  value: string[];
  candidates: ModelCandidate[];
  onChange: (next: string[]) => void;
}): React.ReactElement {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, k) => k !== i));
  const add = (model: string, provider: string) => {
    const ref = `${provider}/${model}`;
    if (!value.includes(ref)) onChange([...value, ref]);
  };

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <ol className="space-y-1">
          {value.map((ref, i) => (
            <li
              key={`${ref}-${i}`}
              className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs"
            >
              <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">{ref}</span>
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-muted-foreground hover:text-red-400"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <ModelPicker candidates={candidates} placeholder="Add a fallback model…" onPick={add} />
      {value.length === 0 && (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Plus className="h-2.5 w-2.5" /> Tried in order when the primary model rate-limits or
          stalls.
        </p>
      )}
    </div>
  );
}
