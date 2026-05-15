import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Pill-shaped mode chip in the topbar. Click to drop a small picker with
 * the available modes (fetched lazily on first open from the backend's
 * modes.list handler). Selecting a mode broadcasts a session.start update
 * so the chip and the system-prompt context reflect the change without a
 * page reload.
 */
export function ModePicker() {
  const mode = useSessionStore((s) => s.mode);
  const modes = useSessionStore((s) => s.modes);
  const { listModes, switchMode } = useWebSocket();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Lazy-fetch the modes list the first time the user clicks the chip
    // (and refresh on every open in case the user installed a new mode
    // through some other surface).
    if (open) listModes();
  }, [open, listModes]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items =
    modes.length > 0
      ? modes
      : [{ id: 'default', name: 'Default', description: 'Standard agent behaviour' }];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
          'bg-accent/40 text-foreground hover:bg-accent transition-colors border border-transparent hover:border-primary/30',
        )}
        title="Active mode"
      >
        mode: <span className="font-mono">{mode || 'default'}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 rounded-md border bg-popover shadow-lg z-30 py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b">
            Mode
          </div>
          {items.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                switchMode(m.id);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-2 hover:bg-accent/40 flex items-start gap-2',
                m.id === mode && 'bg-accent/30',
              )}
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5 mt-0.5 shrink-0',
                  m.id === mode ? 'opacity-100 text-primary' : 'opacity-0',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono">{m.id}</div>
                {m.description && (
                  <div className="text-[11px] text-muted-foreground leading-snug">
                    {m.description}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
