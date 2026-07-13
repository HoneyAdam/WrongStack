import type { Context } from '../../core/context.js';
import type { ContentBlock } from '../../types/blocks.js';
import type { Usage } from '../../types/provider.js';

export interface ProviderEventMap {
  'provider.response': {
    sessionId?: string | undefined;
    ctx: Context;
    model: string;
    content?: ContentBlock[] | undefined;
    usage: Usage;
    stopReason: string;
  };
  'provider.text_delta': { sessionId?: string | undefined; ctx: Context; text: string };
  'provider.thinking_delta': { sessionId?: string | undefined; ctx: Context; text: string };
  'provider.tool_use_start': {
    sessionId?: string | undefined;
    ctx: Context;
    id: string;
    name: string;
  };
  'provider.tool_use_stop': {
    sessionId?: string | undefined;
    ctx: Context;
    id: string;
    name: string;
  };
  /**
   * Fired when a single SSE event handler throws mid-stream. Best-effort: the
   * malformed event is skipped and the partial response built from earlier
   * events is preserved, so the stream is not aborted. `eventType` is the SSE
   * event's `type`; `msg` is the handler error message.
   */
  'provider.stream_error': {
    sessionId?: string | undefined;
    ctx: Context;
    eventType: string;
    msg: string;
  };
  /**
   * Fired before each retry of a failed provider call. `attempt` is 1-based
   * (the first retry is attempt 1, etc.). `description` is the human-readable
   * one-liner from `ProviderError.describe()` — render this in the CLI/TUI
   * instead of grepping logger output for the raw JSON body.
   */
  'provider.retry': {
    sessionId?: string | undefined;
    providerId: string;
    attempt: number;
    delayMs: number;
    status: number;
    description: string;
  };
  /**
   * Fired once when a provider call ultimately fails (retries exhausted, or
   * non-retryable error). Same shape as `provider.retry` minus the delay.
   */
  'provider.error': {
    sessionId?: string | undefined;
    providerId: string;
    status: number;
    description: string;
    retryable: boolean;
  };
  /**
   * Fired by the fallback-model extension when the primary model is overloaded
   * (after its own retries are exhausted) and the agent switches to the next
   * model in the configured `fallbackModels` chain. `providerSwitched` is true
   * when the fallback also changed the active provider (cross-provider). UIs
   * render this as a notice: "⚠ opus overloaded — falling back to planner".
   */
  'provider.fallback': {
    sessionId?: string | undefined;
    from: { providerId: string; model: string };
    to: { providerId: string; model: string };
    status: number;
    providerSwitched: boolean;
    contextWindowWarning?:
      | {
          fromMaxContext: number;
          toMaxContext: number;
          currentTokens?: number | undefined;
        }
      | undefined;
  };
}
