import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { ChronicleContext } from './context.js';
import type { ChronicleJournal } from './journal.js';

export interface ChronicleHealthMonitorOptions {
  journal: ChronicleJournal;
  context: ChronicleContext | (() => ChronicleContext);
  intervalMs?: number | undefined;
  onPersistError?: ((error: unknown) => void) | undefined;
}

/** Low-frequency self-observation proving that telemetry is not starving the runtime. */
export function startChronicleHealthMonitor(options: ChronicleHealthMonitorOptions): () => void {
  const intervalMs = Math.max(5_000, options.intervalMs ?? 30_000);
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previousCpu = process.cpuUsage();
  let previousElu = performance.eventLoopUtilization();

  const sample = (): void => {
    const context = typeof options.context === 'function' ? options.context() : options.context;
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(previousCpu);
    previousCpu = process.cpuUsage();
    const elu = performance.eventLoopUtilization(previousElu);
    previousElu = performance.eventLoopUtilization();
    const journalBeforeSample = options.journal.stats();
    void options.journal.append({
      eventType: 'runtime.health.sampled', scope: context.scope, correlation: context.correlation,
      runtime: { processId: process.pid, parentProcessId: process.ppid }, outcome: 'success',
      resource: { kind: 'process', id: `process:${process.pid}` },
      attributes: {
        uptimeSeconds: process.uptime(),
        eventLoop: { utilization: elu.utilization, activeMs: elu.active, idleMs: elu.idle,
          delayMeanMs: Number(delay.mean) / 1e6, delayP95Ms: Number(delay.percentile(95)) / 1e6,
          delayMaxMs: Number(delay.max) / 1e6 },
        cpu: { userMicros: cpu.user, systemMicros: cpu.system },
        memory: { rssBytes: memory.rss, heapTotalBytes: memory.heapTotal,
          heapUsedBytes: memory.heapUsed, externalBytes: memory.external, arrayBuffersBytes: memory.arrayBuffers },
        chronicle: journalBeforeSample,
      },
    }).catch((error) => options.onPersistError?.(error));
    delay.reset();
  };

  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  return () => { clearInterval(timer); delay.disable(); };
}
