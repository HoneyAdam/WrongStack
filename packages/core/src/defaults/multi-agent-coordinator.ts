import { randomUUID } from 'node:crypto';
import type {
  MultiAgentCoordinator,
  CoordinatorStatus,
  SubagentConfig,
  SpawnResult,
  TaskSpec,
  TaskResult,
  MultiAgentConfig,
} from '../types/multi-agent.js';
import type { AgentBridge, BridgeMessage } from '../types/agent-bridge.js';
import { EventEmitter } from 'node:events';
import type { SubagentContext } from '../types/multi-agent.js';

export class DefaultMultiAgentCoordinator
  extends EventEmitter
  implements MultiAgentCoordinator
{
  readonly coordinatorId: string;
  readonly config: MultiAgentConfig;

  private subagents = new Map<string, {
    config: SubagentConfig;
    context: SubagentContext;
    status: 'running' | 'idle' | 'stopped' | 'error';
    currentTask?: string;
  }>();

  private pendingTasks: TaskSpec[] = [];
  private completedResults: TaskResult[] = [];
  private totalIterations = 0;

  constructor(config: MultiAgentConfig) {
    super();
    this.coordinatorId = config.coordinatorId;
    this.config = config;
  }

  async spawn(subagent: SubagentConfig): Promise<SpawnResult> {
    const id = subagent.id || randomUUID();
    const context: SubagentContext = {
      subagentId: id,
      tasks: [],
      parentBridge: null as unknown as AgentBridge,
      doneCondition: this.config.doneCondition,
      maxConcurrent: this.config.maxConcurrent ?? 4,
    };

    this.subagents.set(id, {
      config: subagent,
      context,
      status: 'idle',
    });

    this.emit('subagent.started', { subagent: { ...subagent, id } });

    return {
      subagentId: id,
      agentId: id,
    };
  }

  async assign(task: TaskSpec): Promise<void> {
    this.pendingTasks.push(task);

    const available = this.getAvailableSubagent();
    if (available) {
      await this.dispatch(available, task);
    }
  }

  async delegate(to: string, msg: BridgeMessage): Promise<void> {
    const subagent = this.subagents.get(to);
    if (!subagent) throw new Error(`Subagent "${to}" not found`);
    await subagent.context.parentBridge.send(msg);
  }

  async stop(subagentId: string): Promise<void> {
    const subagent = this.subagents.get(subagentId);
    if (!subagent) return;

    subagent.status = 'stopped';
    subagent.currentTask = undefined;

    this.emit('subagent.stopped', { subagentId, reason: 'stopped by coordinator' });
  }

  async stopAll(): Promise<void> {
    for (const id of this.subagents.keys()) {
      await this.stop(id);
    }
  }

  getStatus(): CoordinatorStatus {
    return {
      coordinatorId: this.coordinatorId,
      subagents: Array.from(this.subagents.entries()).map(([id, s]) => ({
        id,
        name: s.config.name,
        status: s.status,
        currentTask: s.currentTask,
      })),
      pendingTasks: this.pendingTasks.length,
      completedTasks: this.completedResults.length,
      totalIterations: this.totalIterations,
      done: this.isDone(),
    };
  }

  private getAvailableSubagent(): string | null {
    for (const [id, s] of this.subagents) {
      if (s.status === 'idle') return id;
    }
    return null;
  }

  private async dispatch(subagentId: string, task: TaskSpec): Promise<void> {
    const subagent = this.subagents.get(subagentId);
    if (!subagent) return;

    subagent.status = 'running';
    subagent.currentTask = task.id;
    task.subagentId = subagentId;

    this.emit('task.assigned', { task, subagentId });

    subagent.context.tasks.push(task);

    await subagent.context.parentBridge.send({
      id: randomUUID(),
      type: 'task',
      from: this.coordinatorId,
      to: subagentId,
      payload: task,
      timestamp: Date.now(),
    });
  }

  private isDone(): boolean {
    if (this.config.doneCondition.type === 'all_tasks_done') {
      return this.pendingTasks.length === 0 &&
        this.completedResults.every((r) => r.status === 'success');
    }
    if (this.config.doneCondition.maxIterations && this.totalIterations >= this.config.doneCondition.maxIterations) {
      return true;
    }
    return false;
  }

  completeTask(result: TaskResult): void {
    this.completedResults.push(result);
    this.totalIterations += result.iterations;

    const subagent = this.subagents.get(result.subagentId);
    if (subagent) {
      subagent.status = 'idle';
      subagent.currentTask = undefined;
    }

    this.emit('task.completed', {
      task: this.pendingTasks.shift()!,
      result,
    });

    if (this.pendingTasks.length > 0) {
      const available = this.getAvailableSubagent();
      if (available) {
        const nextTask = this.pendingTasks.shift()!;
        this.dispatch(available, nextTask);
      }
    } else if (this.isDone()) {
      this.emit('done', {
        results: this.completedResults,
        totalIterations: this.totalIterations,
      });
    }
  }
}