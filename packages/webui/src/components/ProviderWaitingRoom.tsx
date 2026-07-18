import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { blockingCalendarRules, ruleTarget } from '@/lib/model-calendar';
import { useProviderStatusStore } from '@/stores';
import { useLocalPrefs } from '@/stores/local-prefs';

function remaining(expiresAt: number | undefined, now: number): string {
  if (!expiresAt) return 'reset time unknown';
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (seconds === 0) return 'rechecking now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ProviderWaitingRoom() {
  const entriesByKey = useProviderStatusStore((state) => state.entries);
  const calendarRules = useLocalPrefs((state) => state.modelAvailabilitySchedule);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const entries = useMemo(
    () => Object.values(entriesByKey).sort((a, b) => a.providerId.localeCompare(b.providerId)),
    [entriesByKey],
  );
  const activeRules = useMemo(
    () => blockingCalendarRules(calendarRules, new Date(now)),
    [calendarRules, now],
  );

  useEffect(() => {
    if (entries.length === 0 && calendarRules.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [calendarRules.length, entries.length]);

  if (entries.length === 0 && activeRules.length === 0) return null;
  const blocked = entries.filter((entry) => entry.state === 'blocked').length;

  return (
    <div className="mx-auto mb-2 max-w-6xl rounded-lg border border-amber-500/25 bg-amber-500/5 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-amber-500/5"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        <span className="font-medium text-foreground">Provider/model availability</span>
        <span className="text-muted-foreground">
          {blocked} blocked · {entries.length - blocked} degraded · {activeRules.length} scheduled
        </span>
        <span className="ml-auto text-muted-foreground">{expanded ? 'Hide' : 'Details'}</span>
      </button>
      {expanded && (
        <div className="border-t border-amber-500/15 px-3 py-2">
          {entries.map((entry) => (
            <div
              key={`${entry.providerId}/${entry.model}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5"
            >
              {entry.state === 'blocked' ? (
                <Clock3 className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-yellow-300" />
              )}
              <code className="text-foreground">
                {entry.providerId}/{entry.model}
              </code>
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
                {entry.state}
              </span>
              <span className="text-muted-foreground">{entry.reason.replaceAll('_', ' ')}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {remaining(entry.stateExpiresAt, now)}
              </span>
            </div>
          ))}
          {activeRules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
              <Clock3 className="h-3.5 w-3.5 text-sky-400" />
              <code className="text-foreground">{ruleTarget(rule)}</code>
              <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-300">scheduled</span>
              <span className="text-muted-foreground">{rule.label ?? 'calendar blackout'}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {rule.start}–{rule.end} · {rule.timezone ?? 'local time'}
              </span>
            </div>
          ))}
          <div className="mt-1 text-[11px] text-muted-foreground">
            WrongStack routes around active schedules and unhealthy models automatically, then
            restores recovered routes on their next eligible use.
          </div>
        </div>
      )}
    </div>
  );
}
