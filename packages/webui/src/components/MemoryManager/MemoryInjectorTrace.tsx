import { Activity, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMemoryInjectorTraceStore } from '@/stores/memory-injector-store';

/** Summary-only widget. Full evidence lives in Context Dashboard. */
export function MemoryInjectorTrace() {
  const latest = useMemoryInjectorTraceStore((state) => state.traces[0]);
  const contextMemories = useMemoryInjectorTraceStore((state) => state.contextMemories);
  const clear = useMemoryInjectorTraceStore((state) => state.clear);
  const records = Object.values(contextMemories);
  const active = records.filter((memory) => memory.state !== 'exited').length;
  const exited = records.filter((memory) => memory.state === 'exited').length;
  const filtered = latest
    ? Object.values(latest.rejected).reduce((sum, count) => sum + count, 0)
    : 0;

  return (
    <section
      className="shrink-0 border-b border-border/70 bg-violet-500/[0.035]"
      aria-label="Memory Injector summary"
    >
      <div className="flex h-8 items-center gap-2 px-4 text-[10px]">
        <Activity className="size-3.5 text-violet-400" />
        <span className="font-bold uppercase tracking-wide text-violet-300">Memory context</span>
        {latest ? (
          <>
            <span className="font-mono text-foreground">{latest.candidates} matched</span>
            <span className="font-mono text-success">{latest.injected.length} injected</span>
            <span className="font-mono text-warning">{filtered} filtered</span>
            <span className="font-mono text-sky-300">{active} active</span>
            {exited > 0 && <span className="font-mono text-muted-foreground">{exited} left</span>}
            <span className="ml-auto text-muted-foreground">
              {latest.trigger} · ctx {Math.round(latest.contextPressure * 100)}% · details in Context
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={clear}>
              <Trash2 className="size-3" /> Clear
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">waiting · details in Context</span>
        )}
      </div>
    </section>
  );
}
