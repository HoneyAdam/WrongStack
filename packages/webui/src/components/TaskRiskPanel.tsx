import type { KanbanBoard, KanbanEvent, KanbanTask } from '@wrongstack/kanban';
import { AlertTriangle, CheckCircle2, ChevronDown, Database, ShieldAlert } from 'lucide-react';

export type TaskRiskSeverity = 'critical' | 'warning' | 'info';

export interface TaskRiskFinding {
  id: string;
  severity: TaskRiskSeverity;
  category: 'operational' | 'audit';
  title: string;
  detail: string;
  remediation: string;
}

export interface TaskRiskAssessment {
  score: number;
  findings: TaskRiskFinding[];
  critical: number;
  warnings: number;
  coverage: {
    durableEvents: number;
    actorPercent: number;
    sessionPercent: number;
    reasonPercent: number;
    hasExecutionRoute: boolean;
    hasTerminalEvidence: boolean;
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function terminal(status?: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

export function analyzeTaskRisk(
  board: KanbanBoard,
  task: KanbanTask,
  events: KanbanEvent[],
  now = new Date(),
): TaskRiskAssessment {
  const findings: TaskRiskFinding[] = [];
  const taskEvents = events.filter((event) => event.taskId === task.id);
  const mutationEvents = taskEvents.filter((event) => event.type !== 'task.created');
  const reasonEligibleEvents = mutationEvents.filter(
    (event) =>
      event.type !== 'task.assignment.heartbeat' && event.type !== 'task.assignment.snapshot',
  );
  const reasonEvents = reasonEligibleEvents.filter((event) => Boolean(event.note?.trim()));
  const assignment = task.assignment;
  const nowMs = now.getTime();
  let score = 100;
  const add = (finding: TaskRiskFinding, deduction = 0) => {
    if (findings.some((candidate) => candidate.id === finding.id)) return;
    findings.push(finding);
    score = Math.max(0, score - deduction);
  };

  if (
    task.dueDate &&
    !['completed', 'archived'].includes(task.status) &&
    Date.parse(task.dueDate) < nowMs
  ) {
    add({
      id: 'overdue',
      severity: 'critical',
      category: 'operational',
      title: 'Task is overdue',
      detail: `Due date ${task.dueDate} has passed while status is ${task.status}.`,
      remediation: 'Re-plan the due date or record the blocker and owner response.',
    });
  }

  const missingDependencies = (task.dependsOn ?? []).filter(
    (id) => !board.tasks.some((candidate) => candidate.id === id),
  );
  if (missingDependencies.length) {
    add({
      id: 'missing-dependency',
      severity: 'critical',
      category: 'operational',
      title: 'Dependency references are broken',
      detail: `${missingDependencies.length} dependency task${missingDependencies.length === 1 ? '' : 's'} cannot be found.`,
      remediation: 'Repair or remove the missing dependency IDs before dispatch.',
    });
  }
  const unresolvedDependencies = (task.dependsOn ?? []).filter((id) => {
    const dependency = board.tasks.find((candidate) => candidate.id === id);
    return dependency && !['completed', 'archived'].includes(dependency.status);
  });
  if (unresolvedDependencies.length) {
    add({
      id: 'unresolved-dependency',
      severity: 'warning',
      category: 'operational',
      title: 'Dependencies are unresolved',
      detail: `${unresolvedDependencies.length} dependency task${unresolvedDependencies.length === 1 ? '' : 's'} still block execution.`,
      remediation: 'Complete dependencies or explicitly waive them with a decision event.',
    });
  }

  if (assignment?.status === 'failed' || assignment?.error) {
    add({
      id: 'assignment-failed',
      severity: 'critical',
      category: 'operational',
      title: 'Latest agent run failed',
      detail: assignment.error ?? assignment.lastFailureKind ?? 'Assignment status is failed.',
      remediation:
        'Review the failed attempt evidence, adjust routing, then retry or block the task.',
    });
  }
  if (
    assignment?.status === 'failed' &&
    assignment.maxAttempts !== undefined &&
    (assignment.attempt ?? 0) >= assignment.maxAttempts
  ) {
    add({
      id: 'retry-exhausted',
      severity: 'critical',
      category: 'operational',
      title: 'Retry budget is exhausted',
      detail: `${assignment.attempt ?? 0}/${assignment.maxAttempts} attempts have been consumed.`,
      remediation: 'Escalate for a new route or explicitly increase the attempt budget.',
    });
  }
  if (
    assignment &&
    ['queued', 'running'].includes(assignment.status) &&
    assignment.leaseExpiresAt &&
    Date.parse(assignment.leaseExpiresAt) <= nowMs
  ) {
    add({
      id: 'lease-expired',
      severity: 'critical',
      category: 'operational',
      title: 'Assignment lease has expired',
      detail: `Lease expired at ${assignment.leaseExpiresAt} while run status is ${assignment.status}.`,
      remediation: 'Recover, release, or retry the stale assignment.',
    });
  }
  if (
    assignment?.status === 'running' &&
    assignment.heartbeatAt &&
    nowMs - Date.parse(assignment.heartbeatAt) > 5 * 60_000
  ) {
    add({
      id: 'heartbeat-stale',
      severity: 'warning',
      category: 'operational',
      title: 'Agent heartbeat is stale',
      detail: `No heartbeat has been recorded since ${assignment.heartbeatAt}.`,
      remediation: 'Inspect the subagent/run and recover the assignment if it is no longer alive.',
    });
  }
  if (task.status === 'in_progress' && !assignment) {
    add({
      id: 'unowned-in-progress',
      severity: 'warning',
      category: 'operational',
      title: 'In-progress task has no assignment',
      detail: 'The task claims active work but has no inspectable agent assignment.',
      remediation: 'Assign an agent or return the task to ready/blocked.',
    });
  }

  const failedChecks = (task.successCriteria ?? []).filter((check) => check.status === 'failed');
  const pendingChecks = (task.successCriteria ?? []).filter((check) => check.status === 'pending');
  if (failedChecks.length) {
    add({
      id: 'failed-checks',
      severity: task.status === 'completed' ? 'critical' : 'warning',
      category: 'operational',
      title: 'Acceptance checks failed',
      detail: `${failedChecks.length} completion check${failedChecks.length === 1 ? '' : 's'} failed.`,
      remediation: 'Resolve or explicitly waive failed acceptance evidence.',
    });
  }
  if (task.status === 'completed' && pendingChecks.length) {
    add({
      id: 'completed-with-pending-checks',
      severity: 'critical',
      category: 'operational',
      title: 'Completed task still has pending checks',
      detail: `${pendingChecks.length} acceptance check${pendingChecks.length === 1 ? '' : 's'} remain pending.`,
      remediation: 'Move the task back to review or complete the missing checks.',
    });
  }

  if (!taskEvents.length) {
    add(
      {
        id: 'no-durable-events',
        severity: 'critical',
        category: 'audit',
        title: 'No durable activity events loaded',
        detail: 'Current state cannot be traced to an append-only task event.',
        remediation: 'Refresh activity; migrate legacy state or record an observation event.',
      },
      25,
    );
  } else if (!taskEvents.some((event) => event.type === 'task.created')) {
    add(
      {
        id: 'missing-creation-event',
        severity: 'warning',
        category: 'audit',
        title: 'Creation provenance is missing',
        detail: 'The loaded event range does not contain task.created.',
        remediation: 'Load deeper history or record the legacy origin explicitly.',
      },
      10,
    );
  }

  const actorPercent = percent(
    mutationEvents.filter((event) => Boolean(event.actor)).length,
    mutationEvents.length,
  );
  const sessionPercent = percent(
    mutationEvents.filter((event) => Boolean(event.sessionId)).length,
    mutationEvents.length,
  );
  const reasonPercent = percent(reasonEvents.length, reasonEligibleEvents.length);
  if (mutationEvents.length && actorPercent < 100) {
    add(
      {
        id: 'actor-coverage',
        severity: 'warning',
        category: 'audit',
        title: 'Some mutations have no actor',
        detail: `Actor coverage is ${actorPercent}%.`,
        remediation: 'Ensure every route/tool mutation supplies agent or operator identity.',
      },
      10,
    );
  }
  if (mutationEvents.length && sessionPercent < 100) {
    add(
      {
        id: 'session-coverage',
        severity: 'warning',
        category: 'audit',
        title: 'Some mutations have no session',
        detail: `Session coverage is ${sessionPercent}%.`,
        remediation: 'Propagate session identity into all task event contexts.',
      },
      10,
    );
  }
  if (reasonEligibleEvents.length && reasonPercent < 50) {
    add(
      {
        id: 'reason-coverage',
        severity: 'info',
        category: 'audit',
        title: 'Decision rationale is sparse',
        detail: `Only ${reasonPercent}% of mutations include a reason or outcome.`,
        remediation: 'Use the change-reason and decision/outcome fields for meaningful mutations.',
      },
      10,
    );
  }

  const latestAssignmentEvent = [...taskEvents]
    .sort((left, right) => right.ts.localeCompare(left.ts))
    .find((event) => event.type === 'task.assigned' || event.type.startsWith('task.assignment.'));
  const routeSource = { ...record(latestAssignmentEvent?.after), ...(assignment ?? {}) };
  const hasExecutionRoute = Boolean(
    routeSource['provider'] || routeSource['model'] || routeSource['modelRouting'],
  );
  if (assignment && !hasExecutionRoute) {
    add(
      {
        id: 'missing-route',
        severity: 'warning',
        category: 'audit',
        title: 'Execution route is not inspectable',
        detail: 'Assignment has no routing mode, provider, or model.',
        remediation: 'Reassign with explicit session/fixed/fallback routing metadata.',
      },
      10,
    );
  }
  const hasTerminalEvidence = Boolean(
    assignment?.lastResult ||
      assignment?.error ||
      taskEvents.some(
        (event) =>
          terminal(String(record(event.after)['status'] ?? '')) && Boolean(event.note?.trim()),
      ),
  );
  if (terminal(assignment?.status) && !hasTerminalEvidence) {
    add(
      {
        id: 'missing-terminal-evidence',
        severity: 'critical',
        category: 'audit',
        title: 'Terminal run has no result or error evidence',
        detail: `Assignment ended as ${assignment?.status} without an inspectable output.`,
        remediation: 'Record the final result/error and supporting evidence.',
      },
      15,
    );
  }

  findings.sort((left, right) => {
    const rank: Record<TaskRiskSeverity, number> = { critical: 0, warning: 1, info: 2 };
    return rank[left.severity] - rank[right.severity];
  });
  return {
    score,
    findings,
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    coverage: {
      durableEvents: taskEvents.length,
      actorPercent,
      sessionPercent,
      reasonPercent,
      hasExecutionRoute,
      hasTerminalEvidence,
    },
  };
}

function tone(severity: TaskRiskSeverity): string {
  if (severity === 'critical') return 'border-destructive/30 bg-destructive/5 text-destructive';
  if (severity === 'warning') return 'border-warning/30 bg-warning/5 text-warning';
  return 'border-info/30 bg-info/5 text-info';
}

export function TaskRiskPanel({
  board,
  task,
  events,
}: {
  board: KanbanBoard;
  task: KanbanTask;
  events: KanbanEvent[];
}) {
  const assessment = analyzeTaskRisk(board, task, events);
  return (
    <details open className="mt-3 rounded-md border border-border/70 bg-muted/10">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <ShieldAlert className="size-4 text-primary" />
        <span className="text-xs font-semibold">Risk & audit quality</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] ${assessment.score >= 90 ? 'bg-success/10 text-success' : assessment.score >= 70 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}
        >
          audit {assessment.score}/100
        </span>
        {assessment.critical > 0 && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[9px] text-destructive">
            {assessment.critical} critical
          </span>
        )}
        <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
      </summary>
      <div className="space-y-2 border-t border-border/60 p-2.5">
        <div className="grid grid-cols-3 gap-1 text-center sm:grid-cols-6">
          {[
            ['Events', assessment.coverage.durableEvents],
            ['Actor', `${assessment.coverage.actorPercent}%`],
            ['Session', `${assessment.coverage.sessionPercent}%`],
            ['Reasons', `${assessment.coverage.reasonPercent}%`],
            ['Route', assessment.coverage.hasExecutionRoute ? 'yes' : 'no'],
            ['Outcome', assessment.coverage.hasTerminalEvidence ? 'yes' : 'no'],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border bg-background/70 px-1 py-1.5">
              <div className="text-[11px] font-semibold">{value}</div>
              <div className="text-[8px] uppercase text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        {assessment.findings.length === 0 ? (
          <div className="flex items-center gap-2 rounded border border-success/30 bg-success/5 px-2.5 py-2 text-[11px] text-success">
            <CheckCircle2 className="size-4" /> No deterministic task risks detected.
          </div>
        ) : (
          <div className="space-y-1.5">
            {assessment.findings.map((finding) => (
              <section
                key={finding.id}
                className={`rounded border px-2.5 py-2 ${tone(finding.severity)}`}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                  {finding.category === 'audit' ? (
                    <Database className="size-3.5" />
                  ) : (
                    <AlertTriangle className="size-3.5" />
                  )}
                  {finding.title}
                  <span className="ml-auto text-[8px] uppercase opacity-75">
                    {finding.category} · {finding.severity}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-4 opacity-90">{finding.detail}</p>
                <p className="mt-1 text-[9px] leading-4 opacity-75">
                  <strong>Next:</strong> {finding.remediation}
                </p>
              </section>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
