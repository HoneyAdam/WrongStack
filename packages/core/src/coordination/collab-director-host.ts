import type { SubagentConfig, TaskResult, TaskSpec } from '../types/multi-agent.js';

/** Minimal orchestration surface required by a collaborative session. */
export interface CollabDirectorHost {
  readonly id: string;
  readonly sharedScratchpadPath: string | null;
  spawn(config: SubagentConfig): Promise<string>;
  assign(task: TaskSpec): Promise<string>;
  awaitTasks(taskIds: string[]): Promise<TaskResult[]>;
  getLeaderBtwNotes(): string[];
}
