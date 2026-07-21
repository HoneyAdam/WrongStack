import type { ReasoningEffort, Request } from '@wrongstack/core';

/**
 * OpenAI's Chat Completions API accepts `reasoning_effort` only for these
 * values. `minimal`, `xhigh`, and `max` are broader WrongStack-internal
 * effort levels that get mapped down or filtered out here — sending an
 * unrecognized value would cause a 400.
 */
export const OPENAI_EFFORT_VALUES = new Set<ReasoningEffort>(['none', 'low', 'medium', 'high']);

export function isOpenAIEffort(effort: ReasoningEffort): boolean {
  return OPENAI_EFFORT_VALUES.has(effort);
}

/**
 * Decide whether the wire body should carry `reasoning_effort` for this request.
 *
 * Some Chat Completions gateways reject the field whenever function tools are
 * present, regardless of value — so we omit it in that case to keep the
 * request valid. This includes literal `none`: compatibility gateways often
 * validate the mere presence of `reasoning_effort` before inspecting its
 * value, so `none` must not be treated as a safe exception.
 *
 * NOTE: the gateway-rejection claim is based on observed behavior of a
 * subset of OpenAI-compatible Chat Completions gateways (e.g. some LiteLLM
 * / omniroute deployments). OpenAI's first-party Chat Completions endpoint
 * does not document this behavior. Provider-specific adapters that have an
 * explicit model allowlist (for example OpenCode Go) may restore supported
 * effort values after this conservative shared gate runs.
 */
export function shouldEmitReasoningEffort(req: Request): boolean {
  const effort = req.reasoning?.effort;
  if (effort === undefined) return false;
  if (!isOpenAIEffort(effort)) return false;
  return !(req.tools && req.tools.length > 0);
}
