import {
  addPlanItem,
  clearPlan,
  emptyPlan,
  formatPlan,
  loadPlan,
  type PlanFile,
  removePlanItem,
  savePlan,
  setPlanItemStatus,
} from '@wrongstack/core';
import type { Tool } from '@wrongstack/core';

/**
 * `planTool` — the LLM-callable counterpart to the `/plan` slash command.
 *
 * Plans capture strategic, multi-step approaches that survive across
 * session resumes (unlike todos, which are tactical and per-turn).
 * Storage path comes from `ctx.meta['plan.path']` — the CLI seeds this
 * during startup so the tool always knows where to read/write.
 *
 * One tool, multiple actions, JSON in/out. The action discriminates the
 * operation so the LLM can do show / add / start / done / remove / clear
 * via a single tool registration instead of bloating the surface with
 * six near-identical tools.
 */
interface PlanInput {
  action: 'show' | 'add' | 'start' | 'done' | 'remove' | 'clear';
  /** Required for add. */
  title?: string;
  /** Optional detail line for add. */
  details?: string;
  /** Required for start/done/remove — accepts plan item id OR 1-based index OR title substring. */
  target?: string;
}

interface PlanOutput {
  ok: boolean;
  message: string;
  /** Formatted plan after the operation. Same string the user sees from `/plan show`. */
  plan: string;
  /** Total item count after the operation. */
  count: number;
  /** Number of items not in 'done' status. */
  open: number;
}

export const planTool: Tool<PlanInput, PlanOutput> = {
  name: 'plan',
  category: 'Session',
  description:
    'Inspect or edit the strategic plan board for this session. Plans persist across resume (unlike todos). Use this to lay out the multi-step approach before diving in, then mark steps in_progress/done as the work proceeds.',
  usageHint:
    'Set action to one of: show | add | start | done | remove | clear. Pass `title` for add. Pass `target` (item id, 1-based index, or title substring) for start/done/remove. Always returns the formatted plan plus open/total counts.',
  permission: 'auto',
  mutating: false,
  timeoutMs: 2_000,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['show', 'add', 'start', 'done', 'remove', 'clear'],
      },
      title: { type: 'string', description: 'Required when action = add.' },
      details: { type: 'string', description: 'Optional extra context for add.' },
      target: {
        type: 'string',
        description:
          'Plan item id, 1-based index, or title substring. Required for start/done/remove.',
      },
    },
    required: ['action'],
  },
  async execute(input, ctx) {
    const planPath = (ctx.meta as Record<string, unknown>)['plan.path'];
    if (typeof planPath !== 'string' || !planPath) {
      return {
        ok: false,
        message: 'Plan storage path is not configured for this session.',
        plan: '',
        count: 0,
        open: 0,
      };
    }
    const sessionId = ctx.session?.id ?? 'unknown';
    let plan: PlanFile = (await loadPlan(planPath)) ?? emptyPlan(sessionId);

    switch (input.action) {
      case 'show':
        break;
      case 'add': {
        const title = input.title?.trim();
        if (!title) {
          return mkResult(plan, false, 'add requires `title`.');
        }
        ({ plan } = addPlanItem(plan, title, input.details?.trim() || undefined));
        await savePlan(planPath, plan);
        break;
      }
      case 'start':
      case 'done': {
        if (!input.target) {
          return mkResult(plan, false, `${input.action} requires \`target\` (id|index|substring).`);
        }
        const next = setPlanItemStatus(
          plan,
          input.target,
          input.action === 'start' ? 'in_progress' : 'done',
        );
        if (next === plan) {
          return mkResult(plan, false, `No plan item matched "${input.target}".`);
        }
        plan = next;
        await savePlan(planPath, plan);
        break;
      }
      case 'remove': {
        if (!input.target) {
          return mkResult(plan, false, 'remove requires `target` (id|index|substring).');
        }
        const next = removePlanItem(plan, input.target);
        if (next === plan) {
          return mkResult(plan, false, `No plan item matched "${input.target}".`);
        }
        plan = next;
        await savePlan(planPath, plan);
        break;
      }
      case 'clear':
        plan = clearPlan(plan);
        await savePlan(planPath, plan);
        break;
      default:
        return mkResult(plan, false, `Unknown action "${(input as { action: string }).action}".`);
    }

    return mkResult(plan, true, `Plan ${input.action} ok.`);
  },
};

function mkResult(plan: PlanFile, ok: boolean, message: string): PlanOutput {
  const open = plan.items.filter((i) => i.status !== 'done').length;
  return {
    ok,
    message,
    plan: formatPlan(plan),
    count: plan.items.length,
    open,
  };
}
