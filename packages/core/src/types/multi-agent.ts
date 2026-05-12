import type { BridgeMessage, AgentBridge } from './agent-bridge.js';
import type { RunResult } from '../core/agent.js';

export interface SubagentConfig {
  id: string;
  name: string;
  role: string;
  prompt?: string;
  maxIterations?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  tools?: string[];
  model?: string;
  priority?: number;
}

export interface TaskResult<T = unknown> {
  subagentId: string;
  taskId: string;
  status: 'success' | 'failed' | 'timeout' | 'stopped';
  result?: T;
  error?: string;
  iterations: number;
  toolCalls: number;
  durationMs: number;
}

export interface TaskSpec {
  id: string;
  description: string;
  subagentId?: string;
  priority?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  context?: Record<string, unknown>;
}

export interface DoneCondition {
  type: 'iterations' | 'tool_calls' | 'output_match' | 'custom' | 'all_tasks_done';
  maxIterations?: number;
  maxToolCalls?: number;
  pattern?: string;
  predicate?: string;
}

export interface MultiAgentConfig {
  coordinatorId: string;
  leaderSystemPrompt?: string;
  subagents?: SubagentConfig[];
  maxConcurrent?: number;
  doneCondition: DoneCondition;
  timeoutMs?: number;
}

export interface SpawnResult {
  subagentId: string;
  agentId: string;
}

export interface TaskDelegation {
  task: TaskSpec;
  subagentId: string;
}

export interface CoordinatorEvents {
  'task.assigned': { task: TaskSpec; subagentId: string };
  'task.completed': { task: TaskSpec; result: TaskResult };
  'subagent.started': { subagent: SubagentConfig };
  'subagent.stopped': { subagentId: string; reason: string };
  'done': { results: TaskResult[]; totalIterations: number };
}

export interface MultiAgentCoordinator {
  readonly coordinatorId: string;
  readonly config: MultiAgentConfig;

  spawn(subagent: SubagentConfig): Promise<SpawnResult>;
  assign(task: TaskSpec): Promise<void>;
  delegate(to: string, msg: BridgeMessage): Promise<void>;
  stop(subagentId: string): Promise<void>;
  stopAll(): Promise<void>;
  getStatus(): CoordinatorStatus;
}

export interface CoordinatorStatus {
  coordinatorId: string;
  subagents: {
    id: string;
    name: string;
    status: 'running' | 'idle' | 'stopped' | 'error';
    currentTask?: string;
  }[];
  pendingTasks: number;
  completedTasks: number;
  totalIterations: number;
  done: boolean;
}

export interface SubagentContext {
  subagentId: string;
  tasks: TaskSpec[];
  parentBridge: AgentBridge;
  doneCondition: DoneCondition;
  maxConcurrent: number;
}