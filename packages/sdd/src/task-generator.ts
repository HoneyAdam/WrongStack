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

    // Overview task
    const overviewSection = spec.sections?.find((s) => s.type === 'overview');
    if (overviewSection?.content) {
      this.opts.taskTracker.addNode({
        title: `Implement: ${spec.title}`,
        description: overviewSection.content,
        type: 'feature',
        priority: 'high',
        status: 'pending',
        estimateHours: 4,
      });
    }

    // Requirement tasks (sorted by priority)
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...(spec.requirements ?? [])].sort(
      (a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9),
    );

    for (const req of sorted) {
      const estimateHours =
        req.priority === 'critical' ? 8 : req.priority === 'high' ? 4 : req.priority === 'medium' ? 2 : 1;

      const tags: string[] = [req.type, req.priority];

      const acLines = (req.acceptanceCriteria ?? [])
        .map((ac) => `- ${ac}`)
        .join('\n');
      const blockedLine = req.blockedBy?.length
        ? `\n\n**Blocked by:** ${req.blockedBy.join(', ')}`
        : '';
      const description =
        `${req.description}\n\n**Type:** ${req.type}` +
        (acLines ? `\n\n**Acceptance Criteria:**\n${acLines}` : '') +
        blockedLine;

      const metadata: Record<string, unknown> = {};
      if (this.opts.verificationFromAcceptance) {
        const cmd = extractVerificationCommand(req.acceptanceCriteria ?? []);
        if (cmd) metadata.verificationCommand = cmd;
      }

      this.opts.taskTracker.addNode({
        title: req.description,
        description,
        type: 'feature',
        priority: req.priority,
        status: 'pending',
        estimateHours,
        tags,
        specRequirementId: req.id,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
    }

    // API endpoint tasks
    if (spec.apiEndpoints?.length) {
      const apiParent = this.opts.taskTracker.addNode({
        title: 'API Implementation',
        description: 'Implement API endpoints as specified in the spec.',
        type: 'feature',
        priority: 'high',
        status: 'pending',
        estimateHours: 0,
      });

      for (const ep of spec.apiEndpoints) {
        const baseHours = 2;
        const authHours = ep.auth ? 1 : 0;
        const reqHours = ep.request ? 1 : 0;
        this.opts.taskTracker.addNode({
          title: `${ep.method} ${ep.path} — ${ep.description}`,
          description: `${ep.method} ${ep.path}: ${ep.description}`,
          type: 'feature',
          priority: 'medium',
          status: 'pending',
          estimateHours: baseHours + authHours + reqHours,
          parentId: apiParent.id,
        });
      }
    }

    // Always add closing tasks
    this.opts.taskTracker.addNode({
      title: 'Write Tests',
      description: 'Write comprehensive tests for the implemented features.',
      type: 'test',
      priority: 'high',
      status: 'pending',
      estimateHours: 4,
    });

    this.opts.taskTracker.addNode({
      title: 'Update Documentation',
      description: 'Update project documentation to reflect the changes.',
      type: 'docs',
      priority: 'low',
      status: 'pending',
      estimateHours: 2,
    });

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

export type { TaskStore };
