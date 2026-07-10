import type { Specification } from '@wrongstack/core/types';
import type { TaskGraph, TaskPriority, TaskType } from '@wrongstack/core/types';
import type { TaskStore, TaskTracker } from '@wrongstack/core/tasking';

export interface TaskGeneratorOptions {
  taskTracker: TaskTracker;
  /**
   * Opt-in (default off): derive each task's completion-gate
   * `metadata.verificationCommand` from an acceptance criterion that carries a
   * runnable-command marker (`$ <cmd>`, or `run:`/`verify:`/`cmd:` prefix). Off
   * by default so the common case stays fast — auto-running a check per task is
   * exactly the slowness the robustness initiative set out to avoid; enable it
   * explicitly (the CLI gates it behind WRONGSTACK_SDD_VERIFY_FROM_ACCEPTANCE).
   */
  verificationFromAcceptance?: boolean | undefined;
}

/**
 * Pull a runnable verification command out of a requirement's acceptance
 * criteria. A criterion qualifies only when it carries an explicit marker —
 * `$ <cmd>` (shell-prompt style) or a `run:` / `verify:` / `cmd:` prefix — so
 * free-text criteria are never mistaken for commands. Returns the first match.
 */
export function extractVerificationCommand(criteria: readonly string[]): string | undefined {
  const marker = /^\s*(?:\$\s+|(?:run|verify|cmd)\s*:\s*)(.+\S)\s*$/i;
  for (const c of criteria) {
    const m = marker.exec(c);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

export interface GeneratedTask {
  specRequirementId?: string | undefined;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  estimateHours?: number | undefined;
  tags?: string[] | undefined;
}

export class TaskGenerator {
  constructor(private readonly opts: TaskGeneratorOptions) {}

  async generateFromSpec(spec: Specification): Promise<TaskGraph> {
    const graph = await this.opts.taskTracker.createGraph(spec.id, spec.title);
    return graph;
  }

  async generateSubtasks(parentTaskId: string, spec: Specification): Promise<void> {
    const reqId = this.opts.taskTracker.getNode(parentTaskId)?.specRequirementId;
    if (!reqId) return;
    const req = spec.requirements.find((r) => r.id === reqId);
    if (!req) return;
    if (req.acceptanceCriteria.length > 0) {
      for (const criterion of req.acceptanceCriteria) {
        this.opts.taskTracker.addNode({
          title: criterion,
          description: `Verify: ${criterion}`,
          type: 'test',
          priority: 'medium',
          status: 'pending',
          parentId: parentTaskId,
        });
      }
    }
  }
}

// Re-export the concrete store implementation so sdd's tests can do
// `import { DefaultTaskStore } from '../src/task-generator.js'`.
// Lives in core (./tasking/task-store.ts); this is a pass-through.
export { DefaultTaskStore } from '@wrongstack/core/tasking/task-store.js';
export { TaskStore };
