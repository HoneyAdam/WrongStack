import type { EventBus } from '../kernel/events.js';
import { PhaseGraphBuilder } from './phase-graph-builder.js';
import { PhaseOrchestrator } from './phase-orchestrator.js';
import type {
  AutoPhaseOptions,
  PhaseExecutionContext,
  PhaseGraph,
  PhaseNode,
  PhaseProgress,
  PhaseTemplate,
} from './types.js';

export interface AutoPhaseRunnerOptions extends AutoPhaseOptions {
  /** Proje başlığı */
  title: string;
  description?: string | undefined;
  /** Faz şablonları */
  phases: PhaseTemplate[];
  /** Task çalıştırma fonksiyonu */
  executeTask: PhaseExecutionContext['executeTask'];
  /** Opsiyonel doğrulama kapısı */
  verifyPhase?: PhaseExecutionContext['verifyPhase'] | undefined;
  /** Doğrulama başarısız olduğunda opsiyonel onarım geçişi */
  repairPhase?: PhaseExecutionContext['repairPhase'] | undefined;
  /** Worktree merge çakışmaları için opsiyonel çözücü */
  resolveConflict?: PhaseExecutionContext['resolveConflict'] | undefined;
  /** Opsiyonel Brain arbiter */
  brain?: PhaseExecutionContext['brain'] | undefined;
  /** Faz tamamlandığında */
  onPhaseComplete?: ((phase: PhaseNode) => void) | undefined;
  /** Faz başarısız olduğunda */
  onPhaseFail?: (phase: PhaseNode, error: Error) => void;
  /** Her tick'te */
  onTick?: (ctx: { activePhases: PhaseNode[]; readyPhases: PhaseNode[] }) => void;
  /** Progress değiştiğinde */
  onProgress?: ((progress: PhaseProgress) => void) | undefined;
  /** Safety net that stops a phase graph if cleanup is bypassed. Default: 24h. */
  maxRunDurationMs?: number | undefined;
  /** Graph tamamlandığında */
  onComplete?: ((graph: PhaseGraph) => void) | undefined;
  /** Graph başarısız olduğunda */
  onFail?: (graph: PhaseGraph, failedPhase: PhaseNode, error: Error) => void;
}

/**
 * AutoPhaseRunner — Tek bir entry point'ten tüm otonom faz akışını yöneten üst seviye API.
 *
 * Kullanım:
 *   const runner = new AutoPhaseRunner({
 *     title: 'Auth Refactor',
 *     phases: [...],
 *     executeTask: async (task, phaseId) => { ... },
 *     onProgress: (p) => console.log(`${p.percentComplete}% done`),
 *   });
 *   await runner.start();
 */
export class AutoPhaseRunner {
  private graph: PhaseGraph | null = null;
  private orchestrator: PhaseOrchestrator | null = null;
  private opts: AutoPhaseRunnerOptions;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private maxRunTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly graphCompletedHandler = (payload: unknown) => {
    const p = payload as { graphId: string; durationMs: number };
    if (this.graph && p.graphId === this.graph.id) {
      this.opts.onComplete?.(this.graph);
      this.cleanup();
    }
  };

  private readonly graphFailedHandler = (payload: unknown) => {
    const p = payload as { graphId: string; failedPhaseId: string; error: string };
    if (this.graph && p.graphId === this.graph.id) {
      const failedPhase = this.graph.phases.get(p.failedPhaseId);
      if (failedPhase) {
        this.opts.onFail?.(this.graph, failedPhase, new Error(p.error));
      }
      this.cleanup();
    }
  };

  /** Stores the unsubscribe function returned by EventBus.on() */
  private unsubscribeCompleted: (() => void) | null = null;
  private unsubscribeFailed: (() => void) | null = null;

  constructor(opts: AutoPhaseRunnerOptions) {
    this.opts = opts;
  }

  async start(): Promise<PhaseGraph> {
    // Phase graph oluştur
    const builder = new PhaseGraphBuilder({
      title: this.opts.title,
      description: this.opts.description,
      phases: this.opts.phases,
      autonomous: this.opts.autonomous,
      stopOnFailure: this.opts.stopOnFailure,
    });

    this.graph = await builder.build();

    // Execution context
    const ctx: PhaseExecutionContext = {
      executeTask: this.opts.executeTask,
      brain: this.opts.brain,
      onPhaseComplete: (phase) => {
        this.opts.onPhaseComplete?.(phase);
      },
      onPhaseFail: (phase, error) => {
        this.opts.onPhaseFail?.(phase, error);
      },
      onTick: (tickCtx) => {
        this.opts.onTick?.(tickCtx);
      },
    };
    if (this.opts.verifyPhase !== undefined) ctx.verifyPhase = this.opts.verifyPhase;
    if (this.opts.repairPhase !== undefined) ctx.repairPhase = this.opts.repairPhase;
    if (this.opts.resolveConflict !== undefined) ctx.resolveConflict = this.opts.resolveConflict;

    // Orchestrator oluştur ve başlat
    this.orchestrator = new PhaseOrchestrator({
      graph: this.graph,
      ctx,
      maxConcurrentPhases: this.opts.maxConcurrentPhases,
      maxConcurrentTasks: this.opts.maxConcurrentTasks,
      maxRetries: this.opts.maxRetries,
      maxVerifyAttempts: this.opts.maxVerifyAttempts,
      autonomous: this.opts.autonomous,
      phaseDelayMs: this.opts.phaseDelayMs,
      stopOnFailure: this.opts.stopOnFailure,
      events: this.opts.events,
      worktrees: this.opts.worktrees,
    });

    // Progress reporting
    if (this.opts.onProgress) {
      this.progressInterval = setInterval(() => {
        const progress = this.orchestrator?.getProgress();
        if (progress) this.opts.onProgress?.(progress);
      }, 2000);
    }

    this.maxRunTimer = setTimeout(
      () => this.stop(),
      this.opts.maxRunDurationMs ?? 24 * 60 * 60_000,
    );
    this.maxRunTimer.unref?.();

    // Register event listeners using the untyped surface to handle custom events
    if (this.opts.events) {
      const events = this.opts.events as EventBus;
      const onUntyped = events.on as unknown as (
        event: string,
        handler: (payload: unknown) => void,
      ) => () => void;
      // Store the unsubscribe functions for proper cleanup
      this.unsubscribeCompleted = onUntyped('graph.completed', this.graphCompletedHandler);
      this.unsubscribeFailed = onUntyped('graph.failed', this.graphFailedHandler);
    }

    await this.orchestrator.start();

    return this.graph;
  }

  pause(): void {
    this.orchestrator?.pause();
  }

  resume(): void {
    this.orchestrator?.resume();
  }

  stop(): void {
    this.orchestrator?.stop();
    this.cleanup();
  }

  getProgress(): PhaseProgress | null {
    return this.orchestrator?.getProgress() ?? null;
  }

  getGraph(): PhaseGraph | null {
    return this.graph;
  }

  isRunning(): boolean {
    return this.orchestrator?.isRunning() ?? false;
  }

  isPaused(): boolean {
    return this.orchestrator?.isPaused() ?? false;
  }

  assignAgent(phaseId: string, agentId: string): void {
    this.orchestrator?.assignAgent(phaseId, agentId);
  }

  releaseAgent(phaseId: string, agentId: string): void {
    this.orchestrator?.releaseAgent(phaseId, agentId);
  }

  private cleanup(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
    if (this.maxRunTimer) {
      clearTimeout(this.maxRunTimer);
      this.maxRunTimer = null;
    }
    // Use the unsubscribe functions returned by EventBus.on() instead of .off()
    this.unsubscribeCompleted?.();
    this.unsubscribeCompleted = null;
    this.unsubscribeFailed?.();
    this.unsubscribeFailed = null;
  }
}

/**
 * Quick-start helper: Var olan bir TaskGraph'tan AutoPhaseRunner oluştur.
 */
export async function createAutoPhaseFromTaskGraph(
  taskGraph: import('../types/task-graph.js').TaskGraph,
  options: Omit<AutoPhaseRunnerOptions, 'phases' | 'title'> & {
    title?: string | undefined;
    tasksPerPhase?: number | undefined;
  },
): Promise<AutoPhaseRunner> {
  const graph = await PhaseGraphBuilder.fromTaskGraph(taskGraph, {
    title: options.title ?? taskGraph.title,
    tasksPerPhase: options.tasksPerPhase,
  });

  // PhaseGraph'tan phase template'leri çıkar
  const phases: PhaseTemplate[] = Array.from(graph.phases.values()).map((p) => ({
    name: p.name,
    description: p.description,
    priority: p.priority,
    estimateHours: p.estimateHours,
    parallelizable: p.parallelizable,
  }));

  return new AutoPhaseRunner({
    ...options,
    title: options.title ?? taskGraph.title,
    phases,
  });
}
