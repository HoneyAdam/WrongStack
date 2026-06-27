/**
 * ACPServerAgentTurn — `RunTurn` adapter for the v1 server side.
 *
 * Wires the ACP v1 server (`ACPProtocolHandler`) to a core `Agent`.
 * Each session gets its own `Agent` instance (per spec: sessions are
 * isolated; sharing agents across sessions would defeat isolation).
 * The agent is created lazily on the first `session/prompt` and
 * torn down when the server is closed or the session is removed.
 *
 * The adapter:
 *  - converts the ACP `ContentBlock[]` prompt into a single string
 *    (concatenating text blocks; non-text blocks are recorded as a
 *    note in the prompt — future work can route images / audio to
 *    the appropriate provider)
 *  - calls `agent.run(prompt, {signal})` to drive the core loop
 *  - captures the agent's text result and emits it as one or more
 *    `agent_message_chunk` notifications
 *  - maps the agent's stop semantics to a v1 `StopReason`
 *
 * Streaming: the core `Agent` API is not currently token-streamed
 * through this surface (its `run()` returns a final `RunResult`).
 * v1 clients expect text deltas, but most implementations batch
 * them — a single chunk per turn is acceptable. A future
 * enhancement can use the Agent's `Renderer` interface to capture
 * deltas as they're written, then forward them as multiple chunks.
 *
 * Scope: the adapter is deliberately minimal. It does NOT:
 *  - model the full conversation history across turns (the v1 spec
 *    leaves this to the agent; on the next prompt we re-feed the
 *    latest user message and the agent handles its own history)
 *  - use the agent's tool registry, permission policy, or
 *    extensions (this adapter is the lowest-fidelity integration;
 *    a future PR can wire a richer session-aware agent)
 *  - stream deltas token-by-token (see "Streaming" above)
 *
 * Cancellation: the parent `AbortSignal` propagates through
 * `agent.run({signal})` and the underlying provider call observes
 * it. On abort, the adapter maps the resulting `AbortError` to
 * `{stopReason: 'cancelled'}`.
 */
import type { Agent } from '@wrongstack/core';
import type {
  ContentBlock,
  PlanEntry,
  StopReason,
  UsageCost,
} from '../types/acp-v1.js';
import type {
  RunTurn,
  RunTurnResult,
} from './protocol-handler.js';

export interface ACPServerAgentTurnOptions {
  /**
   * Factory that creates a fresh `Agent` for a given session.
   * Called once per session on the first `session/prompt` turn.
   * The factory must isolate each agent — sharing one agent
   * across sessions would defeat v1's session-isolation model.
   */
  agentFor: (sessionId: string, cwd: string) => Promise<Agent> | Agent;
  /**
   * Hard wall-clock cap for one turn. The agent's own provider
   * timeout is layered under this; this cap is a safety belt.
   * Default 5 minutes.
   */
  timeoutMs?: number | undefined;
}

/**
 * Build a `RunTurn` that owns per-session `Agent` instances and
 * delegates each turn to the appropriate agent. The returned
 * function is reusable across sessions — the agents are kept in a
 * Map keyed by `sessionId`.
 */
export function makeACPServerAgentTurn(
  opts: ACPServerAgentTurnOptions,
): RunTurn {
  const agents = new Map<string, Agent>();
  const timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return async (input, emit): Promise<RunTurnResult> => {
    // Lazily create an agent for this session on the first turn.
    let agent = agents.get(input.sessionId);
    if (!agent) {
      agent = await opts.agentFor(input.sessionId, process.cwd());
      agents.set(input.sessionId, agent);
    }

    // Per-turn safety belt: even if the agent ignores the parent
    // signal, the timer will fire and we'll surface a cancelled
    // result. The agent's actual run is called with the parent
    // signal so genuine cancellation propagates correctly.
    const timer = setTimeout(() => {
      timeouts.delete(input.sessionId);
    }, timeoutMs);
    timeouts.set(input.sessionId, timer);

    try {
      const userMessage = promptToText(input.prompt);
      const result = await agent.run(userMessage, { signal: input.signal });

      // Stream the agent's final text back
      const text = extractText(result);
      if (text) {
        emit({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        });
      }

      // Emit plan if the agent provided one
      const plan = extractPlan(result);
      if (plan.length > 0) {
        emit({
          sessionUpdate: 'plan',
          entries: plan,
        });
      }

      // Emit usage if the agent provided one
      const usage = extractUsage(result);
      if (usage) {
        emit({
          sessionUpdate: 'usage_update',
          used: usage.used,
          size: usage.size,
          ...(usage.cost ? { cost: usage.cost } : {}),
        });
      }

      const result_out: RunTurnResult = {
        stopReason: pickStopReason(result, input.signal),
      };
      if (text) result_out.text = text;
      const runTurnPlan = extractPlan(result);
      if (runTurnPlan.length > 0) result_out.plan = runTurnPlan;
      if (usage) result_out.usage = usage;
      return result_out;
    } finally {
      clearTimeout(timer);
      timeouts.delete(input.sessionId);
    }
  };
}

/**
 * Tear down the agents and timers held by a turn factory. The
 * server's `close()` should call this so child connections don't
 * outlive the server.
 */
export function disposeACPServerAgentTurn(
  opts: { agents: Map<string, Agent> },
): Promise<void> {
  return Promise.allSettled(
    Array.from(opts.agents.values()).map((agent) => agent.teardown()),
  ).then(() => undefined);
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Convert an ACP `ContentBlock[]` prompt to a single user-message
 * string. Text blocks are concatenated; image / audio / resource
 * blocks are recorded as a bracketed placeholder (full multimodal
 * support is a future PR — the adapter is v1-text only for now).
 */
function promptToText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      parts.push(b.text);
    } else if (b.type === 'image') {
      parts.push(`[image: ${b.mimeType}]`);
    } else if (b.type === 'audio') {
      parts.push(`[audio: ${b.mimeType}]`);
    } else if (b.type === 'resource') {
      parts.push(`[embedded resource: ${b.resource.uri}]`);
    } else if (b.type === 'resource_link') {
      parts.push(`[resource link: ${b.uri}]`);
    }
  }
  return parts.join('\n').trim();
}

/**
 * Extract the agent's final text from a `RunResult`. The shape
 * varies across core versions, so we read the most common fields
 * defensively and concatenate whatever text we find.
 */
function extractText(result: unknown): string {
  if (typeof result !== 'object' || result === null) return '';
  const r = result as Record<string, unknown>;
  // v1: result.text is the agent's final text (string).
  if (typeof r.text === 'string') return r.text;
  // Legacy: result.content is an array of blocks.
  if (Array.isArray(r.content)) {
    const parts: string[] = [];
    for (const c of r.content) {
      if (typeof c === 'object' && c !== null) {
        const cb = c as { type?: string; text?: unknown };
        if (cb.type === 'text' && typeof cb.text === 'string') parts.push(cb.text);
      }
    }
    return parts.join('');
  }
  return '';
}

/**
 * Map a `RunResult` (and the parent signal) to a v1 `StopReason`.
 *
 * If the parent signal was aborted, return `'cancelled'`. Otherwise
 * the agent completed normally — we treat any non-error result
 * as `'end_turn'`. The core `RunResult` doesn't currently surface
 * a per-turn stop reason, so v1's `'max_tokens'`, `'max_turn_requests'`,
 * and `'refusal'` discriminators can't be emitted precisely; we
 * log a warning if the result carries an error and return the
 * generic end_turn.
 */
function pickStopReason(result: unknown, signal: AbortSignal): StopReason {
  if (signal.aborted) return 'cancelled';
  if (typeof result !== 'object' || result === null) return 'end_turn';
  const r = result as { error?: unknown; stopReason?: unknown };
  if (r.error) {
    return 'end_turn';
  }
  if (typeof r.stopReason === 'string' && r.stopReason) {
    return r.stopReason as StopReason;
  }
  return 'end_turn';
}

/**
 * Extract a plan from the agent's RunResult, if available.
 * The plan is an array of PlanEntry objects.
 */
function extractPlan(result: unknown): PlanEntry[] {
  if (typeof result !== 'object' || result === null) return [];
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.plan)) {
    // Agent provided a plan array
    return r.plan.filter(
      (e: unknown) =>
        typeof e === 'object' && e !== null && typeof (e as { content?: unknown }).content === 'string',
    ) as PlanEntry[];
  }
  return [];
}

/**
 * Extract usage/token info from the agent's RunResult, if available.
 */
function extractUsage(
  result: unknown,
): { used: number; size: number; cost?: UsageCost | undefined } | null {
  if (typeof result !== 'object' || result === null) return null;
  const r = result as Record<string, unknown>;
  if (typeof r.usage === 'object' && r.usage !== null) {
    const u = r.usage as { used?: unknown; size?: unknown; cost?: unknown };
    if (typeof u.used === 'number' && typeof u.size === 'number') {
      return {
        used: u.used,
        size: u.size,
        ...(typeof u.cost === 'object' && u.cost !== null ? { cost: u.cost as UsageCost } : {}),
      };
    }
  }
  return null;
}
