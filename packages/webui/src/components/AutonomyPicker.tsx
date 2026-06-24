import { cn } from '@/lib/utils';
import {
  Activity,
  ArrowRightLeft,
  ChevronDown,
  Pause,
  Play,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export type AutonomyMode = 'off' | 'suggest' | 'auto' | 'eternal' | 'eternal-parallel';

export interface AutonomyOption {
  mode: AutonomyMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const AUTONOMY_OPTIONS: AutonomyOption[] = [
  {
    mode: 'off',
    label: 'Off',
    description: 'Full manual control — agent waits for your input.',
    icon: <Pause className="h-3.5 w-3.5" />,
  },
  {
    mode: 'suggest',
    label: 'Suggest',
    description: 'Agent suggests next steps but waits for approval.',
    icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
  },
  {
    mode: 'auto',
    label: 'Auto',
    description: 'Agent auto-proceeds after brief confirmation delay.',
    icon: <Play className="h-3.5 w-3.5" />,
  },
  {
    mode: 'eternal',
    label: 'Eternal',
    description: 'Agent runs autonomously until goal is complete.',
    icon: <Activity className="h-3.5 w-3.5" />,
  },
  {
    mode: 'eternal-parallel',
    label: 'Eternal Parallel',
    description: 'Multi-agent autonomous execution — fleet mode.',
    icon: <Activity className="h-3.5 w-3.5" />,
  },
];

// ── Component ──────────────────────────────────────────────────────────────

export interface AutonomyPickerProps {
  /** Current autonomy mode. */
  value: AutonomyMode;
  /** Called when the user picks a new mode. */
  onChange: (mode: AutonomyMode) => void;
  /** Extra class for the trigger button. */
  className?: string | undefined;
  /** If true, render as a compact chip instead of full button. */
  compact?: boolean | undefined;
}

export function AutonomyPicker({
  value,
  onChange,
  className,
  compact = false,
}: AutonomyPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const current = AUTONOMY_OPTIONS.find((o) => o.mode === value);

  const tone =
    value === 'eternal' || value === 'eternal-parallel'
      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
      : value === 'auto'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
        : value === 'suggest'
          ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30'
          : 'bg-muted text-muted-foreground border-transparent';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors hover:opacity-80',
          tone,
          className,
        )}
        title={`Autonomy: ${current?.label ?? value}`}
      >
        {current?.icon}
        {!compact && <span className="truncate max-w-[7rem]">{current?.label ?? value}</span>}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 w-56 rounded-lg border bg-popover shadow-lg p-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b mb-1">
            Autonomy Mode
          </div>
          {AUTONOMY_OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              onClick={() => {
                onChange(opt.mode);
                setOpen(false);
              }}
              className={cn(
                'w-full flex items-start gap-2 px-3 py-2 rounded text-left transition-colors',
                value === opt.mode
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/40',
              )}
            >
              <span className="mt-0.5 text-muted-foreground">{opt.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{opt.label}</span>
                <p className="text-[10px] text-muted-foreground leading-snug">{opt.description}</p>
              </div>
              {value === opt.mode && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
