import type { ToolCallPipelinePayload } from '@wrongstack/core';

export interface MemoryInjectorPlanInput {
  ctx: ToolCallPipelinePayload['ctx'];
  trigger: string;
  toolQuery: string;
  baseMaxHints: number;
  baseMaxChars: number;
  taskAware?: boolean | undefined;
}

export interface MemoryInjectorPlan {
  queryText: string;
  taskSignals: string[];
  maxHints: number;
  maxChars: number;
  contextPressure: number;
}

export interface MemoryInjectorMeasurement {
  candidates: number;
  eligible: number;
  injected: number;
  injectedChars: number;
}

/**
 * Task-aware, budget-measuring curator for on-demand memory injection.
 * It stays deterministic because an extra LLM request can cost more context
 * than the memory selection saves.
 */
export class MemoryInjectorAgent {
  plan(input: MemoryInjectorPlanInput): MemoryInjectorPlan {
    const taskSignals = input.taskAware === false ? [] : collectTaskSignals(input.ctx);
    const queryText = uniqueTerms([input.toolQuery, ...taskSignals].join(' '), 1_600);
    const contextPressure = readContextPressure(input.ctx);
    const budgetFactor = contextPressure >= 0.82 ? 0.45 : contextPressure >= 0.65 ? 0.7 : 1;
    const minimumHints = Math.min(input.baseMaxHints, contextPressure >= 0.82 ? 3 : 4);
    const minimumChars = Math.min(input.baseMaxChars, contextPressure >= 0.82 ? 1_200 : 1_600);
    return {
      queryText,
      taskSignals,
      maxHints: Math.max(minimumHints, Math.floor(input.baseMaxHints * budgetFactor)),
      maxChars: Math.max(minimumChars, Math.floor(input.baseMaxChars * budgetFactor)),
      contextPressure,
    };
  }

  record(
    ctx: ToolCallPipelinePayload['ctx'],
    plan: MemoryInjectorPlan,
    measurement: MemoryInjectorMeasurement,
  ): void {
    ctx.meta ??= {};
    ctx.meta['memoryInjectorLastRun'] = {
      at: new Date().toISOString(),
      queryChars: plan.queryText.length,
      taskSignals: plan.taskSignals.length,
      contextPressure: Number(plan.contextPressure.toFixed(3)),
      budget: { maxHints: plan.maxHints, maxChars: plan.maxChars },
      ...measurement,
    };
  }
}

function collectTaskSignals(ctx: ToolCallPipelinePayload['ctx']): string[] {
  const signals: string[] = [];
  const todos = Array.isArray(ctx.todos) ? ctx.todos : [];
  for (const todo of todos.filter((item) => item.status === 'in_progress').slice(0, 3)) {
    signals.push(todo.activeForm ?? todo.content);
  }
  for (const todo of todos.filter((item) => item.status === 'pending').slice(0, 2)) {
    signals.push(todo.content);
  }
  collectBoundedStrings(ctx.meta?.['kanban'], signals, 12);
  if (ctx.currentKanbanTaskId) signals.push(`kanban-task ${ctx.currentKanbanTaskId}`);
  if (ctx.currentKanbanBoardId) signals.push(`kanban-board ${ctx.currentKanbanBoardId}`);
  return [...new Set(signals.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, 12);
}

function collectBoundedStrings(value: unknown, out: string[], remaining: number): number {
  if (remaining <= 0 || value == null) return remaining;
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim();
    if (text) out.push(text.slice(0, 400));
    return remaining - 1;
  }
  if (Array.isArray(value)) {
    let left = remaining;
    for (const item of value) {
      left = collectBoundedStrings(item, out, left);
      if (left <= 0) break;
    }
    return left;
  }
  if (typeof value !== 'object') return remaining;
  let left = remaining;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out.push(`${key} ${item.slice(0, 400)}`);
    else left = collectBoundedStrings(item, out, left);
    left--;
    if (left <= 0) break;
  }
  return left;
}

function readContextPressure(ctx: ToolCallPipelinePayload['ctx']): number {
  const used = ctx.lastRequestTokens;
  const learned = ctx.meta?.['effectiveMaxContext'];
  const providerMax = ctx.provider?.capabilities?.maxContext;
  const max = typeof learned === 'number' && learned > 0
    ? learned
    : typeof providerMax === 'number' && providerMax > 0
      ? providerMax
      : 0;
  return typeof used === 'number' && used > 0 && max > 0 ? used / max : 0;
}

function uniqueTerms(text: string, maxChars: number): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  let chars = 0;
  for (const term of text.normalize('NFKC').split(/\s+/)) {
    const clean = term.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    if (chars + clean.length + 1 > maxChars) break;
    seen.add(key);
    terms.push(clean);
    chars += clean.length + 1;
  }
  return terms.join(' ');
}
