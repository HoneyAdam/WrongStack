import { Activity, Anchor, CheckCircle2, ChevronDown, Tag, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMemoryInjectorTraceStore } from '@/stores/memory-injector-store';
import { cn } from '@/lib/utils';

export function MemoryInjectorTrace() {
  const traces = useMemoryInjectorTraceStore((state) => state.traces);
  const clear = useMemoryInjectorTraceStore((state) => state.clear);

  return (
    <section className="shrink-0 border-b border-border/70 bg-violet-500/[0.035]" aria-label="Memory Injector live trace">
      <div className="flex h-8 items-center gap-2 px-4">
        <Activity className="size-3.5 text-violet-400" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-violet-300">
          Context injection trace
        </span>
        <span className="text-[10px] text-muted-foreground">
          {traces.length === 0 ? 'waiting' : `live · ${Math.min(traces.length, 50)}/50 · details on demand`}
        </span>
        {traces.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[10px]" onClick={clear}>
            <Trash2 className="size-3" /> Clear
          </Button>
        )}
      </div>
      {traces.length > 0 ? (
        <div className="max-h-20 overflow-y-auto border-t border-border/50">
          {traces.slice(0, 3).map((trace) => {
            const rejected = Object.entries(trace.rejected).filter(([, count]) => count > 0);
            const injectedIds = new Set(trace.injected.map((memory) => memory.id));
            return (
              <details key={trace.runId} className="group border-b border-border/40 last:border-b-0">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-1 text-[10px] hover:bg-muted/25">
                  <ChevronDown className="size-3 shrink-0 transition-transform group-open:rotate-180" />
                  <span className={cn(
                    'font-mono font-bold uppercase',
                    trace.outcome === 'error' ? 'text-destructive' : trace.injected.length > 0 ? 'text-success' : 'text-muted-foreground',
                  )}>
                    {trace.trigger}
                  </span>
                  <span className="font-mono">{trace.activated.length} activated → {trace.injected.length} injected</span>
                  <span className="text-muted-foreground">/{trace.candidates} candidates</span>
                  <span className="text-muted-foreground">{trace.injectedChars} chars</span>
                  <span className="text-muted-foreground">ctx {Math.round(trace.contextPressure * 100)}%</span>
                  <span className="ml-auto text-muted-foreground">
                    {new Date(trace.at).toLocaleTimeString()}
                  </span>
                </summary>
                <div className="space-y-1 bg-background/45 px-8 py-2 text-[10px]">
                  {trace.error && <p className="text-destructive">error: {trace.error}</p>}
                  {trace.activated.map((memory) => {
                    const injected = injectedIds.has(memory.id);
                    return (
                      <article key={memory.id} className="border border-violet-400/25 bg-violet-400/[0.045] p-2.5 shadow-[inset_3px_0_0_hsl(265_80%_65%/.65)]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Zap className="size-3 text-violet-300" />
                          <span className="font-mono font-bold text-violet-200">{memory.id}</span>
                          <span className="border border-violet-400/30 px-1.5 py-0.5 font-mono uppercase text-violet-300">
                            {memory.kind}
                          </span>
                          <span className="border border-violet-400/35 bg-violet-400/10 px-1.5 py-0.5 font-bold uppercase text-violet-200">
                            activated
                          </span>
                          <span className={cn(
                            'flex items-center gap-1 border px-1.5 py-0.5 font-bold uppercase',
                            injected
                              ? 'border-success/35 bg-success/10 text-success'
                              : 'border-warning/35 bg-warning/10 text-warning',
                          )}>
                            {injected && <CheckCircle2 className="size-2.5" />}
                            {injected ? 'injected to context' : 'not injected'}
                          </span>
                          <span className="ml-auto font-mono text-muted-foreground">{memory.persistence}</span>
                        </div>
                        <p className="mt-2 break-words text-[11px] leading-5 text-foreground">{memory.text}</p>

                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                          <MemoryMetric label="score" value={memory.score} />
                          <MemoryMetric label="confidence" value={memory.confidence} />
                          <MemoryMetric label="freshness" value={memory.freshness} />
                          <MemoryMetric label="importance" value={memory.importance} />
                        </div>

                        {memory.activationReasons.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <Zap className="mr-0.5 size-3 text-violet-300" />
                            <span className="mr-1 font-bold text-violet-200">Why activated</span>
                            {memory.activationReasons.map((reason) => (
                              <span key={reason} className="border border-violet-400/20 bg-violet-400/[0.07] px-1.5 py-0.5 font-mono text-violet-200">
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                        {memory.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-muted-foreground">
                            <Tag className="mr-0.5 size-3" />
                            {memory.tags.map((tag) => <span key={tag} className="font-mono">#{tag}</span>)}
                          </div>
                        )}
                        {memory.anchors.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                            <Anchor className="size-3" />
                            {memory.anchors.map((anchorName) => (
                              <span key={anchorName} className="break-all font-mono">{anchorName}</span>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  {trace.activated.length === 0 && (
                    <p className="border border-dashed border-border/60 px-2 py-1.5 text-muted-foreground">
                      No memory crossed the activation gates in this run.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    − filtered: {rejected.length > 0
                      ? rejected.map(([reason, count]) => `${reason} ${count}`).join(' · ')
                      : 'none'}
                  </p>
                  <p className="truncate text-muted-foreground" title={trace.queryPreview}>
                    query: {trace.queryPreview || '—'} · budget {trace.budget.maxHints} memories/{trace.budget.maxChars} chars
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function MemoryMetric({ label, value }: { label: string; value: number }) {
  const safe = Math.max(0, Math.min(1, value));
  return (
    <div className="border border-border/50 bg-background/50 px-1.5 py-1">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase text-muted-foreground">
        <span>{label}</span><span>{safe.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-1 bg-muted">
        <div className="h-full bg-violet-400" style={{ width: `${Math.round(safe * 100)}%` }} />
      </div>
    </div>
  );
}
