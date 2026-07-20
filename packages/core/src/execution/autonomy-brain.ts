/**
 * AutonomyBrain — a self-driving decision layer for autonomous workflows.
 *
 * Unlike the standard BrainArbiter which asks the human when uncertain,
 * AutonomyBrain makes decisions autonomously within configured risk
 * boundaries, keeping the system running unattended. It uses the session
 * LLM to evaluate situations and produce decisions.
 *
 * ## Identity
 * The AutonomyBrain is NOT the main agent. It is a dedicated decision
 * engine with a single purpose: evaluate blocked/stuck situations in
 * autonomous workflows and decide whether to continue, pivot, or stop.
 *
 * ## Decision Flow
 * 1. RISK GATE — if request risk > maxAutoRisk, auto-deny
 * 2. HEURISTIC — fast pattern-match for common situations (deadlock, retry-exhausted)
 * 3. LLM EVALUATION — complex decisions (goal completion, conflict resolution)
 *
 * ## Decision Logging
 * Every decision is emitted via `onDecision` callback with a human-readable
 * summary suitable for chat history and journal entries.
 *
 * Usage:
 *   const brain = createAutonomyBrain({
 *     provider, model, maxAutoRisk: 'high',
 *     onDecision: (summary) => journal.push(summary),
 *   });
 */

import type { Provider } from '../types/provider.js';
import type { BrainArbiter, BrainDecision, BrainDecisionRequest } from '../coordination/brain.js';
import { readBundledInstructionText } from '../utils/instruction-file.js';
import { safeParse } from '../utils/safe-json.js';

/** One (provider, model) pair the Brain may call for a decision. */
export interface BrainLlmTarget {
  provider: Provider;
  model: string;
  /** Display label for logs/status (e.g. "anthropic/claude-haiku"). */
  label?: string | undefined;
}

export interface AutonomyBrainOptions {
  /** LLM provider for decision-making. Ignored when `targets` is non-empty. */
  provider?: Provider | undefined;
  /** Model to use for decisions (should be fast + cheap). Ignored when `targets` is non-empty. */
  model?: string | undefined;
  /**
   * Ordered LLM pool. With `strategy: 'fallback'` (default) the first target
   * is primary and later ones are tried in order when a call fails/times
   * out; with 'round-robin' successive decisions rotate the starting target.
   * At least one of `targets` / (`provider` + `model`) must be provided.
   */
  targets?: BrainLlmTarget[] | undefined;
  /** Pool selection strategy. Default 'fallback'. */
  strategy?: 'fallback' | 'round-robin' | undefined;
  /** Maximum risk level the brain will auto-decide. Default: 'high'.
   *  'low'    — only auto-decide low-risk questions
   *  'medium' — auto-decide low/medium
   *  'high'   — auto-decide low/medium/high
   *  'all'    — auto-decide everything (including critical)
   */
  maxAutoRisk?: 'low' | 'medium' | 'high' | 'all' | undefined;
  /** Timeout for each decision call (ms). Default: 15_000. */
  decisionTimeoutMs?: number | undefined;
  /**
   * Decision-history digest for the LLM prompt (typically
   * `BrainDecisionLedger.digestFor`): how similar past decisions went and
   * how they turned out. Appended to the user message when non-empty.
   */
  getDecisionDigest?: ((request: BrainDecisionRequest) => string | undefined) | undefined;
  /**
   * Called after every decision with a human-readable summary.
   * Use this to log decisions into chat history, journal, or status line.
   * Example: "🧠 Brain: skipped deadlocked tasks → continuing with phase 3/5"
   */
  onDecision?: ((summary: string, decision: BrainDecision, request: BrainDecisionRequest) => void) | undefined;
}

const RISK_LEVELS: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Runtime-adjustable autonomy ceiling for the tiered brain. */
export type BrainAutoRisk = 'off' | 'low' | 'medium' | 'high' | 'all';

export interface TieredBrainArbiterOptions {
  /** Fast deterministic policy layer (DefaultBrainArbiter). Consulted first. */
  policy: BrainArbiter;
  /** LLM-backed autonomous layer (createAutonomyBrain). Consulted when the
   *  policy layer would escalate to the human and the request's risk is
   *  within the live ceiling. */
  autonomous?: BrainArbiter | undefined;
  /**
   * Live autonomy ceiling — read on EVERY decision so `/brain risk <level>`
   * changes take effect immediately. 'off' disables the autonomous layer
   * entirely (everything the policy can't answer goes to the human).
   */
  getMaxAutoRisk?: (() => BrainAutoRisk) | undefined;
  /**
   * Multi-LLM council (createCouncilBrainArbiter). When present, requests at
   * or above the council risk floor are decided by the council INSTEAD of
   * the single-LLM layer. Council answers AND denies are terminal — a panel
   * that considered the question and refused is a real decision, not a
   * failure. Only `ask_human` (quorum not met / judge unavailable) falls
   * through to the escalation tier.
   */
  council?: BrainArbiter | undefined;
  /** Live council risk floor. Default 'high'. Read on every decision. */
  getCouncilMinRisk?: (() => 'medium' | 'high' | 'critical') | undefined;
}

/**
 * The standard Brain positioning: policy first, LLM/council second,
 * escalation last.
 *
 *   1. POLICY  — deterministic DefaultBrainArbiter (low-risk fast path,
 *      fallback semantics). Denies and option-backed answers pass through
 *      untouched. A fallback-produced `continue` answer (no optionId, the
 *      request declared `fallback: 'continue'`) is only PROVISIONAL: it
 *      means "nobody could decide", not "this is the right call", so the
 *      LLM tier still gets consulted within the ceiling. Historically it
 *      short-circuited here, which meant e.g. goal-completion checks never
 *      reached the LLM at all.
 *   2. COUNCIL — requests at/above the council floor (default 'high') are
 *      decided by the multi-LLM council when one is wired.
 *   3. LLM     — everything else within the live ceiling goes to the
 *      single-LLM autonomous brain. Only a real `answer` short-circuits;
 *      denials/failures fall through.
 *   4. ESCALATION — anything left escalates. Callers wrap this in
 *      `EscalationRoutingBrainArbiter` (interactive prompt or headless
 *      terminal policy) or the legacy `HumanEscalatingBrainArbiter`.
 */
export function createTieredBrainArbiter(opts: TieredBrainArbiterOptions): BrainArbiter {
  return {
    async decide(request: BrainDecisionRequest): Promise<BrainDecision> {
      const policyDecision = await opts.policy.decide(request);
      // Provisional = the policy merely echoed the request's continue
      // fallback (no optionId means it did not pick a concrete option).
      const provisionalContinue =
        policyDecision.type === 'answer' &&
        policyDecision.optionId === undefined &&
        request.fallback === 'continue';
      if (policyDecision.type !== 'ask_human' && !provisionalContinue) return policyDecision;

      const ceiling = opts.getMaxAutoRisk?.() ?? 'medium';
      if (ceiling === 'off') return policyDecision;
      const ceilingLevel = ceiling === 'all' ? 3 : (RISK_LEVELS[ceiling] ?? 1);
      const requestLevel = RISK_LEVELS[request.risk] ?? 2;
      if (requestLevel > ceilingLevel) return policyDecision;

      // COUNCIL — high-stakes questions get the multi-LLM panel.
      if (opts.council) {
        const floor = opts.getCouncilMinRisk?.() ?? 'high';
        const floorLevel = RISK_LEVELS[floor] ?? 2;
        if (requestLevel >= floorLevel) {
          try {
            const councilDecision = await opts.council.decide(request);
            if (councilDecision.type !== 'ask_human') return councilDecision;
          } catch {
            // Council failure degrades to the single-LLM tier below.
          }
        }
      }

      if (!opts.autonomous) return policyDecision;
      try {
        const llmDecision = await opts.autonomous.decide(request);
        if (llmDecision.type === 'answer') return llmDecision;
      } catch {
        // LLM layer is best-effort — fall through to the escalation tier.
      }
      return policyDecision;
    },
  };
}

/**
 * Create a self-driving brain that makes autonomous decisions.
 * Never asks the human — within its risk boundary it answers, above it denies.
 */
export function createAutonomyBrain(opts: AutonomyBrainOptions): BrainArbiter {
  const maxRisk = opts.maxAutoRisk ?? 'high';
  const maxRiskLevel = RISK_LEVELS[maxRisk] ?? 2;
  const timeoutMs = opts.decisionTimeoutMs ?? 15_000;
  const targets: BrainLlmTarget[] =
    opts.targets && opts.targets.length > 0
      ? opts.targets
      : opts.provider && opts.model
        ? [{ provider: opts.provider, model: opts.model }]
        : [];
  if (targets.length === 0) {
    throw new Error('createAutonomyBrain: provide `targets` or `provider` + `model`.');
  }
  const strategy = opts.strategy ?? 'fallback';
  // Round-robin rotation cursor — advances once per decision, not per attempt.
  let rrCursor = 0;

  return {
    async decide(request: BrainDecisionRequest): Promise<BrainDecision> {
      const requestLevel = RISK_LEVELS[request.risk] ?? 2;

      // RISK GATE — above our risk boundary → auto-deny
      if (requestLevel > maxRiskLevel) {
        const reason = `Auto-denied: risk "${request.risk}" exceeds max "${maxRisk}"`;
        const decision: BrainDecision = { type: 'deny', reason };
        opts.onDecision?.(
          `🧠 Brain: DENIED — ${request.question.slice(0, 80)} (risk: ${request.risk} > ${maxRisk})`,
          decision,
          request,
        );
        return decision;
      }

      // HEURISTIC — fast pattern-match
      const heuristic = quickDecide(request);
      if (heuristic) {
        opts.onDecision?.(formatDecisionSummary(heuristic, request), heuristic, request);
        return heuristic;
      }

      // LLM EVALUATION — complex decisions. Try the pool in order; the first
      // target that produces a usable response wins.
      const start = strategy === 'round-robin' ? rrCursor++ % targets.length : 0;
      const ordered = [...targets.slice(start), ...targets.slice(0, start)];
      const digest = opts.getDecisionDigest?.(request);
      const llmDecision = await llmDecide(request, ordered, timeoutMs, digest);
      opts.onDecision?.(formatDecisionSummary(llmDecision, request), llmDecision, request);
      return llmDecision;
    },
  };
}

/**
 * Format a decision as a human-readable one-liner for chat history.
 */
export function formatDecisionSummary(
  decision: BrainDecision,
  request: BrainDecisionRequest,
): string {
  const question = request.question.length > 80
    ? request.question.slice(0, 77) + '…'
    : request.question;

  if (decision.type === 'deny') {
    return `🧠 Brain: DENIED — "${question}" → ${decision.reason}`;
  }

  if (decision.type === 'answer') {
    const action = decision.optionId
      ? `chose [${decision.optionId}]`
      : decision.text.length > 60
        ? decision.text.slice(0, 57) + '…'
        : decision.text;
    return `🧠 Brain: DECIDED — "${question}" → ${action}`;
  }

  return `🧠 Brain: ASKED HUMAN — "${question}"`;
}

/**
 * Fast heuristic decisions that don't need an LLM call.
 *
 * Deliberately narrow: heuristics never fire on option-bearing requests
 * (options are control-plane input demanding a structured choice, not a
 * keyword guess) and the continue fast-path only fires when the caller
 * itself declared continue the safe fallback AND the question offers no
 * alternative — "Should we continue or stop?" must reach the LLM.
 */
function quickDecide(request: BrainDecisionRequest): BrainDecision | null {
  if (request.options?.length) return null;

  const q = request.question.toLowerCase();
  const ctx = request.context?.toLowerCase() ?? '';

  // Deadlock with failed tasks → skip and continue. The context must mention
  // "failed" anchored to a work-unit noun (task, step, job, …) so that
  // incidental mentions like "login failed" don't trigger the fast path.
  if (q.includes('deadlock') && /\bfailed\s+(?:task|step|job|build|test|phase|stage|item|unit)s?\b/.test(ctx)) {
    return {
      type: 'answer',
      text: 'Skip deadlocked tasks and continue with remaining work. Failed tasks will be reported in the final summary.',
      rationale: 'Heuristic: deadlocked tasks blocked by failed dependencies — skipping unblocks remaining work.',
    };
  }

  // Repeated failure with retries demonstrably exhausted → move on. Requires
  // an explicit exhausted marker or a concrete ≥3 attempt/failure count —
  // a bare "3" anywhere in the context is not evidence.
  if (
    (q.includes('failed') || q.includes('retry')) &&
    (/\bexhausted\b/.test(ctx) ||
      /\b(?:[3-9]|\d{2,})\s+(?:consecutive\s+)?(?:times|attempts|retries|failures)\b/.test(ctx) ||
      /\b(?:attempt|retr(?:y|ies)|failure)s?\W{0,3}(?:[3-9]|\d{2,})\b/.test(ctx))
  ) {
    return {
      type: 'answer',
      text: 'Mark as failed and move on. Note the failure for the final report.',
      rationale: 'Heuristic: retries exhausted — continuing would waste resources.',
    };
  }

  // Goal complete verification → needs LLM evaluation
  if (q.includes('goal complete') || q.includes('mission complete')) {
    return null;
  }

  // Plain continue/proceed ping whose caller declared continue safe, with no
  // competing alternative in the question → yes without burning an LLM call.
  if (
    request.fallback === 'continue' &&
    /\b(?:continue|proceed)\b/.test(q) &&
    !/\b(?:stop|abort|halt|cancel|pause|rollback)\b/.test(q) &&
    !/\bor\b/.test(q)
  ) {
    return {
      type: 'answer',
      text: 'Continue execution. Do not stop.',
      rationale: 'Heuristic: autonomy mode — continue until all work is complete.',
    };
  }

  return null;
}

/**
 * Render a decision request as the user message for a Brain LLM call.
 * Shared by the single-LLM tier and every council voter so all of them see
 * the same question/context/options shape.
 */
export function buildBrainUserMessage(request: BrainDecisionRequest): string {
  const optionsText = request.options?.length
    ? '\nOptions:\n' +
      request.options
        .map(
          (o) =>
            `  [${o.id}] ${o.label}${o.consequence ? ` — ${o.consequence}` : ''}${o.recommended ? ' ★ recommended' : ''}`,
        )
        .join('\n')
    : '';

  return [
    `Question: ${request.question}`,
    request.context ? `\nContext:\n${request.context}` : '',
    optionsText,
  ].filter(Boolean).join('\n');
}

/** Append a decision-history digest to a Brain user message (shared shape). */
export function withDecisionDigest(user: string, digest: string | undefined): string {
  if (!digest?.trim()) return user;
  return `${user}\n\nOutcome history of similar past decisions (learn from it):\n${digest}`;
}

/**
 * One Brain LLM call against a single target. Throws on transport failure,
 * timeout, or abort — callers own the pool/fallback semantics.
 */
export async function completeBrainLlm(
  target: BrainLlmTarget,
  input: { system: string; user: string; timeoutMs: number; maxTokens?: number | undefined },
): Promise<string> {
  const signal = AbortSignal.timeout(input.timeoutMs);
  const response = await target.provider.complete(
    {
      model: target.model,
      system: [{ type: 'text', text: input.system }],
      messages: [{ role: 'user', content: input.user || 'Decide.' }],
      maxTokens: input.maxTokens ?? 200,
    },
    { signal },
  );
  return extractText(response).trim();
}

/**
 * Ask the LLM pool for a decision on complex questions. Targets are tried
 * in the given order; the first one that answers wins. Uses a carefully
 * crafted system prompt that establishes the brain's identity, purpose,
 * and decision-making framework.
 */
async function llmDecide(
  request: BrainDecisionRequest,
  targets: BrainLlmTarget[],
  timeoutMs: number,
  digest?: string | undefined,
): Promise<BrainDecision> {
  const systemPrompt = readBundledInstructionText('llm/autonomy-brain.md');
  const userMessage = withDecisionDigest(buildBrainUserMessage(request), digest);

  let text: string | null = null;
  for (const target of targets) {
    try {
      text = await completeBrainLlm(target, {
        system: systemPrompt,
        user: userMessage,
        timeoutMs,
      });
      break;
    } catch {
      // This target is unavailable/slow — fall through to the next one.
    }
  }

  if (text === null) {
    // Entire pool unavailable — use the request fallback.
    if (request.fallback === 'continue') {
      return {
        type: 'answer',
        text: 'Continue (Autonomy Brain LLM unavailable — using fallback).',
      };
    }
    return { type: 'deny', reason: 'Autonomy Brain LLM unavailable for decision.' };
  }

  // Option-bearing decisions are control-plane input, not prose. Accept the
  // canonical JSON envelope and the historical leading `[id]` form, but
  // never substring-match an id anywhere in free text: a response such as
  // "do not spawn; wait" must not select the earlier `spawn` option.
  if (request.options?.length) {
    const parsed = parseOptionDecision(text, request.options);
    if (parsed) {
      return parsed;
    }
    return {
      type: 'deny',
      reason: 'Autonomy Brain returned no exact valid option id.',
    };
  }

  // Free-text answer
  return {
    type: 'answer',
    text: text || (request.fallback === 'continue'
      ? 'Continue execution.'
      : 'Denied by autonomy policy.'),
    rationale: text || undefined,
  };
}

export function parseOptionDecision(
  rawText: string,
  options: NonNullable<BrainDecisionRequest['options']>,
): BrainDecision | null {
  const text = rawText.trim();
  const byId = new Map(options.map((option) => [option.id, option] as const));

  // A fenced response is accepted only when the fence is the entire payload.
  // Extracting an embedded JSON block from prose would reintroduce the same
  // ambiguity as substring matching (for example: "do not spawn" followed by
  // an illustrative `{ optionId: 'spawn' }` block).
  const wholeFence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text);
  const jsonCandidate = wholeFence ? (wholeFence[1] ?? '').trim() : text;
  const parsed = safeParse<{ optionId?: unknown; rationale?: unknown }>(jsonCandidate, 16_384);
  if (parsed.ok && parsed.value && typeof parsed.value.optionId === 'string') {
    const option = byId.get(parsed.value.optionId);
    if (!option) return null;
    return {
      type: 'answer',
      optionId: option.id,
      text: option.label,
      rationale:
        typeof parsed.value.rationale === 'string' && parsed.value.rationale.trim()
          ? parsed.value.rationale.trim()
          : undefined,
    };
  }

  // Backward compatibility for the prompt's former `[id] — rationale` shape.
  // The id must be the first semantic token; mentions later in prose are not
  // decisions and deliberately fail closed.
  const legacy = /^\s*\[([^\]\r\n]+)\](?:\s*(?:—|-|:)\s*)?([\s\S]*)$/.exec(text);
  if (!legacy) return null;
  const option = byId.get((legacy[1] ?? '').trim());
  if (!option) return null;
  const rationale = (legacy[2] ?? '').trim();
  return {
    type: 'answer',
    optionId: option.id,
    text: option.label,
    rationale: rationale || undefined,
  };
}

function extractText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    return (r.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
  }
  if (Array.isArray(r.choices)) {
    return (r.choices as Array<{ message?: { content?: string } }>)[0]?.message?.content ?? '';
  }
  return typeof r.text === 'string' ? r.text : '';
}
