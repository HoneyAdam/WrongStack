import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { SubagentConfig, TaskResult } from '../types/multi-agent.js';
import type { JSONSchema, Tool } from '../types/tool.js';
import type { Director } from './director.js';

/**
 * Opaque host interface so this factory doesn't have to depend on the
 * CLI's `MultiAgentHost`. Any caller that exposes the same three
 * methods can wire `delegate` — including test doubles.
 */
export interface DelegateHost {
  /** True if a Director is already attached and running. */
  isDirectorMode(): boolean;
  /** Build (or return the cached) Director when director mode is on. */
  ensureDirector(): Promise<Director | null>;
  /**
   * Force-promote a non-director session into director mode at runtime.
   * Returns the Director, or null when promotion is impossible (e.g. a
   * non-director coordinator has already spawned subagents in the
   * legacy code path).
   */
  promoteToDirector(): Promise<Director | null>;
}

export interface CreateDelegateToolOptions {
  host: DelegateHost;
  /**
   * Roster used to resolve `role` strings into full `SubagentConfig`s.
   * Typically `FLEET_ROSTER`. When omitted, `delegate({ role })` calls
   * fail and only the explicit `name + provider + model` path works.
   */
  roster?: Record<string, SubagentConfig>;
  /**
   * Default await timeout in milliseconds. `delegate` blocks until the
   * subagent's task resolves; without a cap, a stuck worker would hang
   * the host indefinitely. Set generously (default: 4 hours) so the
   * orchestrator can run multi-step refactors / monorepo audits
   * without being killed for being slow — the orchestrator must
   * decide per-call when a task needs to be cut short.
   */
  defaultTimeoutMs?: number;
  /**
   * Absolute directory under which per-subagent JSONL transcripts live —
   * matches `MultiAgentHostOptions.sessionsRoot`. When set, the delegate
   * tool reads the subagent's transcript on timeout / budget-exhaustion
   * to extract partial output, so the host LLM gets *something* useful
   * back instead of just an error.
   */
  sessionsRoot?: string;
  /**
   * The directorRunId used to namespace transcripts (typically the host
   * session id). Combined with `sessionsRoot` to locate per-subagent
   * JSONLs at `<sessionsRoot>/<runId>/<subagentId>.jsonl`.
   */
  directorRunId?: string;
}

/**
 * `delegate` — the only multi-agent tool a regular (non-director) agent
 * ever needs. It bundles spawn + assign + await into a single call and
 * transparently auto-promotes the host into director mode on first use.
 *
 * The model never has to ask "are we in director mode?" — it just calls
 * `delegate({ role, task })` and gets back a `TaskResult`. The cost of
 * that ergonomic packaging is that `delegate` cannot be used for
 * parallel work as-is; the model must fire multiple `delegate` calls in
 * parallel through the provider's parallel-tool-call surface, or escalate
 * to the explicit `spawn_subagent` + `assign_task` + `await_tasks` flow
 * when it wants fan-out it controls itself.
 */
export function createDelegateTool(opts: CreateDelegateToolOptions): Tool {
  // 4 hours by default. The previous 5-minute default killed any
  // non-trivial fan-out (monorepo audits, multi-file refactors) and
  // forced the orchestrator to constantly pass an explicit timeoutMs.
  // The right model here: the orchestrator should pick a tight value
  // only when it knows the work is small; otherwise let it run.
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 4 * 60 * 60 * 1000;
  const rosterIds = opts.roster ? Object.keys(opts.roster) : [];

  const inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'What the subagent should do — natural language, complete sentence(s). The subagent has its own tool slice, its own LLM call, and returns when its task is done.',
      },
      role: {
        type: 'string',
        description:
          rosterIds.length > 0
            ? `Roster role (preferred). One of: ${rosterIds.join(', ')}. Picks a pre-tuned config (prompt, budgets, tools) for that role.`
            : 'No roster is configured — pass `name` instead.',
        enum: rosterIds.length > 0 ? rosterIds : undefined,
      },
      name: {
        type: 'string',
        description:
          'Display name for the subagent when not using a roster role. Required when `role` is omitted.',
      },
      provider: {
        type: 'string',
        description:
          'Provider id (e.g. "anthropic", "openai"). Defaults to the host provider when omitted.',
      },
      model: {
        type: 'string',
        description: 'Model id within the provider. Defaults to the host model when omitted.',
      },
      systemPromptOverride: {
        type: 'string',
        description: 'Optional extra prompt text appended to the role baseline.',
      },
      timeoutMs: {
        type: 'number',
        description: `Wall-clock budget for this delegate in milliseconds. No hard cap — set as high as the task realistically needs (a monorepo audit can take hours, a single-file lint takes seconds). Default ${Math.round(defaultTimeoutMs / 1000 / 60)} minutes.`,
      },
      maxIterations: {
        type: 'number',
        description:
          'Maximum LLM iterations the subagent may take. Unset = use the role/coordinator default. Raise this for tasks with many tool-think-tool cycles (deep code analysis, multi-file refactors).',
      },
      maxToolCalls: {
        type: 'number',
        description:
          'Maximum number of tool invocations the subagent may make. Unset = use the role/coordinator default. Raise this for tasks that touch many files (large grep + read + report).',
      },
    },
    required: ['task'],
  };

  return {
    name: 'delegate',
    description:
      "Hand a discrete piece of work to a dedicated subagent and wait for its result. The subagent has its own context, its own LLM call, and its own budget — use this when a task is self-contained, would otherwise blow up your context, or benefits from a specialized role (bug-hunter, security-scanner, refactor-planner, audit-log). YOU decide how big the budget is: pass `timeoutMs`, `maxIterations`, and `maxToolCalls` sized to the actual work. There is no hidden cap forcing a 3-minute / 80-iteration limit — if a monorepo audit needs 2 hours and 500 tool calls, ask for that. Call multiple delegates in parallel through the provider's parallel-tool-call surface to fan work out across roles.",
    usageHint:
      "Set `task` to a complete instruction. Either pick `role` from the roster or pass `name` + `provider` + `model`. For non-trivial work, also pass `timeoutMs` (the wall-clock budget you actually need), `maxIterations`, and `maxToolCalls` — defaults are intentionally generous (4 hours) but the right values depend on scope. Returns the subagent's `TaskResult` — including the textual `result`, iteration count, tool count, and duration. Auto-promotes the host into director mode on first call.",
    permission: 'auto',
    mutating: false,
    inputSchema,
    async execute(input: unknown) {
      const i = (input ?? {}) as {
        task?: string;
        role?: string;
        name?: string;
        provider?: string;
        model?: string;
        systemPromptOverride?: string;
        timeoutMs?: number;
        maxIterations?: number;
        maxToolCalls?: number;
      };

      if (typeof i.task !== 'string' || !i.task.trim()) {
        return { ok: false, error: '`task` is required.' };
      }

      let director = await opts.host.ensureDirector();
      if (!director) {
        director = await opts.host.promoteToDirector();
      }
      if (!director) {
        return {
          ok: false,
          error:
            'Director could not be activated — multi-agent host already running in legacy non-director mode. Restart with `--director` for fleet support.',
        };
      }

      const timeoutMs = i.timeoutMs ?? defaultTimeoutMs;

      // Resolve config: prefer roster role when provided, fall back to
      // explicit name/provider/model. The two forms are intentionally
      // exclusive to keep the surface narrow.
      let cfg: SubagentConfig;
      if (i.role) {
        const base = opts.roster?.[i.role];
        if (!base) {
          return {
            ok: false,
            error: `Unknown role "${i.role}". Available: ${rosterIds.join(', ') || '(no roster configured)'}.`,
          };
        }
        cfg = { ...base };
        if (i.systemPromptOverride) cfg.systemPromptOverride = i.systemPromptOverride;
        if (i.provider) cfg.provider = i.provider;
        if (i.model) cfg.model = i.model;
      } else {
        if (!i.name) {
          return {
            ok: false,
            error: 'Either `role` (from the roster) or `name` is required.',
          };
        }
        cfg = {
          name: i.name,
          provider: i.provider,
          model: i.model,
          systemPromptOverride: i.systemPromptOverride,
        };
      }

      // Caller-supplied iteration / tool-call budgets win over both the
      // role default and the coordinator default. This is how the
      // orchestrator dials a long-running audit up to "as much as it
      // needs" without us having to second-guess the right number
      // anywhere lower in the stack.
      if (typeof i.maxIterations === 'number' && i.maxIterations > 0) {
        cfg.maxIterations = i.maxIterations;
      }
      if (typeof i.maxToolCalls === 'number' && i.maxToolCalls > 0) {
        cfg.maxToolCalls = i.maxToolCalls;
      }

      // Timeout coordination (Fix 2). The subagent's internal `timeoutMs`
      // is its OWN budget cap; the delegate's `timeoutMs` is the host's
      // patience. If the host's patience runs out before the subagent's
      // budget does, the host sees a `__timeout` with no result — but
      // the subagent keeps running, burning compute the host can never
      // observe. Force the subagent's internal cap to land ~30s BEFORE
      // the host's timeout so the subagent always finishes (or
      // exhausts) within the host's window and surfaces a real
      // outcome instead of a silent loss.
      const SUBAGENT_TIMEOUT_BUFFER_MS = 30_000;
      const desiredSubTimeout = Math.max(30_000, timeoutMs - SUBAGENT_TIMEOUT_BUFFER_MS);
      if (!cfg.timeoutMs || cfg.timeoutMs > desiredSubTimeout) {
        cfg.timeoutMs = desiredSubTimeout;
      }

      try {
        const subagentId = await director.spawn(cfg);
        const taskId = await director.assign({
          id: '',
          description: i.task,
          subagentId,
        });
        const result = await Promise.race<TaskResult | { __timeout: true }>([
          director.awaitTasks([taskId]).then((r) => r[0] as TaskResult),
          new Promise<{ __timeout: true }>((resolve) =>
            setTimeout(() => resolve({ __timeout: true }), timeoutMs),
          ),
        ]);

        if ('__timeout' in result) {
          // Host gave up waiting. Subagent may still be running but the
          // budget coordination above should have already capped it ~30s
          // before this point. Try to extract whatever the subagent
          // produced so far from its JSONL transcript.
          const partial = await readSubagentPartial(opts, subagentId);
          return {
            ok: false,
            stopReason: 'host_timeout',
            error: `Subagent did not finish within ${timeoutMs}ms.`,
            hint: 'Reduce scope of the next delegate, raise timeoutMs, or use spawn_subagent + await_tasks for long-running work.',
            subagentId,
            taskId,
            partial,
          };
        }

        // Task completed — but "completed" can mean success, budget
        // exhaustion (failed/timeout), or stop. Distinguish them so
        // the host LLM can react differently:
        //   - 'success' → end_turn, finalText reflects the actual answer
        //   - 'failed'/'timeout' with iterations >= maxIterations → budget
        //   - 'stopped' → user/director aborted
        // For non-success, also pull partial output from JSONL because
        // the runner throws on max_iterations and `result.result` ends
        // up empty.
        const baseStopReason: StopReason =
          result.status === 'success'
            ? 'end_turn'
            : result.status === 'timeout'
              ? 'subagent_timeout'
              : result.status === 'stopped'
                ? 'aborted'
                : 'budget_exhausted';
        const partial =
          result.status === 'success' ? undefined : await readSubagentPartial(opts, subagentId);

        return {
          ok: result.status === 'success',
          status: result.status,
          stopReason: baseStopReason,
          subagentId: result.subagentId,
          taskId: result.taskId,
          result: result.result,
          error: result.error,
          iterations: result.iterations,
          toolCalls: result.toolCalls,
          durationMs: result.durationMs,
          ...(partial ? { partial } : {}),
          ...(baseStopReason === 'budget_exhausted'
            ? {
                hint: 'Subagent exhausted its iteration / tool-call budget. Either narrow the task scope or pass higher `maxIterations` / `maxToolCalls` via spawn_subagent + assign_task for explicit budget control.',
              }
            : {}),
        };
      } catch (err) {
        return {
          ok: false,
          stopReason: 'error' as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

type StopReason =
  | 'end_turn'
  | 'budget_exhausted'
  | 'subagent_timeout'
  | 'host_timeout'
  | 'aborted'
  | 'error';

/**
 * Parse the per-subagent JSONL at `<sessionsRoot>/<runId>/<subagentId>.jsonl`
 * and pull out the last few useful pieces — the most recent assistant
 * text response, the stop reason, and a count of tool calls. Used by
 * `delegate` when the subagent timed out or exhausted budget without
 * returning a clean `finalText`, so the host LLM still sees what work
 * actually happened.
 */
async function readSubagentPartial(
  opts: CreateDelegateToolOptions,
  subagentId: string,
): Promise<
  | {
      lastAssistantText?: string;
      lastStopReason?: string;
      toolUsesObserved: number;
      events: number;
    }
  | undefined
> {
  if (!opts.sessionsRoot) return undefined;
  // Locate the JSONL. When `directorRunId` is provided we know the
  // exact path; otherwise scan the sessionsRoot for any subdir
  // containing this subagent id.
  const candidates: string[] = [];
  if (opts.directorRunId) {
    candidates.push(path.join(opts.sessionsRoot, opts.directorRunId, `${subagentId}.jsonl`));
  } else {
    try {
      const runDirs = await fsp.readdir(opts.sessionsRoot);
      for (const r of runDirs) {
        candidates.push(path.join(opts.sessionsRoot, r, `${subagentId}.jsonl`));
      }
    } catch {
      return undefined;
    }
  }
  for (const file of candidates) {
    let raw: string;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n').filter((l) => l.trim());
    let lastAssistantText: string | undefined;
    let lastStopReason: string | undefined;
    let toolUses = 0;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as {
          type: string;
          content?: unknown;
          stopReason?: string;
          name?: string;
        };
        if (ev.type === 'tool_use') toolUses += 1;
        if (ev.type === 'llm_response') {
          if (typeof ev.stopReason === 'string') lastStopReason = ev.stopReason;
          if (Array.isArray(ev.content)) {
            const txt = (ev.content as Array<{ type?: string; text?: string }>)
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('\n')
              .trim();
            if (txt) lastAssistantText = txt;
          }
        }
      } catch {
        // skip
      }
    }
    return {
      lastAssistantText,
      lastStopReason,
      toolUsesObserved: toolUses,
      events: lines.length,
    };
  }
  return undefined;
}
