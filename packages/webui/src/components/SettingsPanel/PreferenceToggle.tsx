import { playCompletionChime } from '@/lib/chime';
import { cn } from '@/lib/utils';
import { useConfigStore, useUIStore } from '@/stores';

/**
 * One row in the Preferences section. Renders a label / hint pair on the
 * left and a small switch on the right.
 */
export function PreferenceToggle({
  label,
  hint,
  selector,
  onChange,
  configKey,
}: {
  label: string;
  hint?: string | undefined;
  selector: ((s: ReturnType<typeof useUIStore.getState>) => boolean) | null;
  onChange?: (() => void) | undefined;
  configKey?: 'soundOnComplete' | undefined;
}) {
  const uiVal = useUIStore((s) => (selector ? selector(s) : false));
  const cfgVal = useConfigStore((s) => (configKey ? (s[configKey] as boolean) : false));
  const on = selector ? uiVal : cfgVal;
  const handleToggle = () => {
    if (selector) onChange?.();
    else if (configKey === 'soundOnComplete') {
      const next = !useConfigStore.getState().soundOnComplete;
      useConfigStore.getState().setSoundOnComplete(next);
      if (next) {
        playCompletionChime();
      }
    }
  };
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={handleToggle}
        className={cn(
          'shrink-0 relative inline-flex h-5 w-9 rounded-full border transition-colors',
          on ? 'bg-primary border-primary' : 'bg-muted border-input hover:bg-muted/80',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-background shadow transition-transform',
            on && 'translate-x-4',
          )}
        />
      </button>
    </div>
  );
}
