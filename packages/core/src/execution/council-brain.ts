/**
 * CouncilBrainArbiter — a multi-LLM decision panel for high-stakes questions.
 *
 * A thin adapter over CouncilOrchestrator. Each CouncilVoter becomes a seat
 * with its OWN Provider via per-seat CouncilLLMCaller, so multi-provider
 * panels work correctly (no voters[0] collapsing).
 *
 * Decision lenses (personas):
 *   - executor — biased toward forward progress; hates stalling.
 *   - skeptic  — hunts for the reason the proposed action is wrong; may veto.
 *   - auditor  — cost/waste/budget lens; hates throwing tokens at dead ends.
 *   - security — examines trust boundaries, abuse cases, security impact.
 *   - maintainer   — evaluates complexity, compatibility, long-term ownership.
 *   - user-advocate — evaluates from the affected user's perspective.
 *
 * @module council-brain
 */

import type {
  BrainArbiter,
  BrainDecision,
  BrainDecisionRequest,
} from '../coordination/brain.js';
import {
  type BrainLlmTarget,
  completeBrainLlm,
} from './autonomy-brain.js';
import { CouncilOrchestrator } from './council-orchestrator.js';
import type { CouncilLLMCaller, CouncilModelTarget, CouncilProfileConfig, CouncilSeatConfig } from '../types/council.js';
import type { OneShotLLMInput, OneShotLLMResult } from '../types/one-shot-llm.js';

export const COUNCIL_REFUSE_OPTION_ID = 'council_refuse';

// ── Config ─────────────────────────────────────────────────────────────────

/** One voting seat on the council. */
export interface CouncilVoter extends BrainLlmTarget {
  /**
   * Decision lens. Built-ins: 'executor', 'skeptic', 'auditor'. Any other
   * string is injected verbatim as the persona description.
   */
  persona?: string | undefined;
  /** Vote weight. Default 1. */
  weight?: number | undefined;
  /** A refusal from this seat immediately denies the proposal. */
  veto?: boolean | undefined;
  /** Display label for status/logs. Defaults to model. */
  label?: string | undefined;
}

export interface CouncilBrainOptions {
  voters: CouncilVoter[];
  /** Tie-breaker / synthesizer. Default: none (ties call for human). */
  judge?: BrainLlmTarget | undefined;
  /** Fraction of voters that must vote. Default 0.5. */
  quorumFraction?: number | undefined;
  /** Winning option weight must exceed this fraction. Default 0.5. */
  approvalFraction?: number | undefined;
  /** Per-voter completion timeout in ms. Default 15 000. */
  decisionTimeoutMs?: number | undefined;
  /** Optional digest of past decisions for context. */
  getDecisionDigest?: ((request: BrainDecisionRequest) => string | undefined) | undefined;
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a council-of-LLMs Brain arbiter backed by CouncilOrchestrator
 * with per-seat LLM callers — each voter's own Provider is used for its
 * seat, avoiding the single-provider collapsing bug.
 */
export function createCouncilBrainArbiter(opts: CouncilBrainOptions): BrainArbiter {
  if (opts.voters.length === 0) {
    throw new Error('createCouncilBrainArbiter: at least one voter is required.');
  }

  // ── Per-seat caller factory ──────────────────────────────────────────
  // Each seat i gets a caller wrapping completeBrainLlm(voter[i], ...).
  function makeSeatCallerForVoter(target: BrainLlmTarget): CouncilLLMCaller {
    return {
      async call(input: OneShotLLMInput): Promise<OneShotLLMResult> {
        try {
          const raw = await completeBrainLlm(
            { provider: target.provider, model: input.model ?? target.model },
            {
              system: typeof input.system === 'string'
                ? input.system
                : Array.isArray(input.system)
                  ? input.system.map((b) => b.text).join('\n')
                  : '',
              user: input.userPrompt ?? '',
              timeoutMs: input.timeoutMs ?? 15_000,
              maxTokens: input.maxTokens,
            },
          );
          return {
            text: raw,
            model: target.model,
            provider: target.provider.id,
            tokens: { input: 0, output: 0, total: 0 },
            durationMs: 0,
            fromFallback: false,
          };
        } catch (error) {
          return {
            text: '',
            model: target.model,
            provider: target.provider.id,
            tokens: { input: 0, output: 0, total: 0 },
            durationMs: 0,
            fromFallback: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }

  const seatCaller = (seatIndex: number): CouncilLLMCaller => {
    const voter = opts.voters[seatIndex];
    if (!voter) {
      return {
        async call(_input: OneShotLLMInput): Promise<OneShotLLMResult> {
          return {
            text: '',
            model: '',
            provider: '',
            tokens: { input: 0, output: 0, total: 0 },
            durationMs: 0,
            fromFallback: false,
            error: `No voter at index ${seatIndex}.`,
          };
        },
      };
    }
    return makeSeatCallerForVoter(voter);
  };

  // ── Build a dynamic profile from voters ──────────────────────────────
  const seats: CouncilSeatConfig[] = opts.voters.map((voter, i) => ({
    id: `voter-${i}`,
    label: voter.label ?? voter.model,
    persona: voter.persona ?? 'executor',
    target: {
      providerId: voter.provider.id,
      model: voter.model,
      role: voter.persona ?? 'executor',
    } satisfies CouncilModelTarget,
    weight: voter.weight,
    veto: voter.veto,
  }));

  const judgeTarget = opts.judge
    ? ({
        providerId: opts.judge.provider.id,
        model: opts.judge.model,
        role: 'judge',
      } satisfies CouncilModelTarget)
    : false;

  const profile: CouncilProfileConfig = {
    id: 'brain-council-adapter',
    seats,
    judge: judgeTarget,
    quorumFraction: opts.quorumFraction ?? 0.5,
    approvalFraction: opts.approvalFraction ?? 0.5,
    perCallTimeoutMs: opts.decisionTimeoutMs ?? 15_000,
    distinctness: 'none',
  };

  // ── Orchestrator with per-seat callers ───────────────────────────────
  // Shared caller is unused when seatCaller is set, but required by the
  // CouncilOrchestrator constructor. We provide a no-op fallback.
  const noopCaller: CouncilLLMCaller = {
    async call(): Promise<OneShotLLMResult> {
      return {
        text: '',
        model: '',
        provider: '',
        tokens: { input: 0, output: 0, total: 0 },
        durationMs: 0,
        fromFallback: false,
        error: 'Per-seat caller must be used.',
      };
    },
  };

  const orchestrator = new CouncilOrchestrator({
    caller: noopCaller,
    defaultProfile: 'brain-council-adapter',
    seatCaller,
    judgeCaller: opts.judge
      ? makeSeatCallerForVoter(opts.judge)
      : undefined,
  });

  // ── Finish helpers ───────────────────────────────────────────────────

  function finish(_request: BrainDecisionRequest, decision: BrainDecision): BrainDecision {
    return decision;
  }

  const abstain = (request: BrainDecisionRequest, why: string): BrainDecision => ({
    type: 'ask_human',
    prompt: `Council abstained (${why}): ${request.question}`,
    options: request.options,
    rationale: `Temporary user escalation because ${why}.`,
  });

  // ── Decide ───────────────────────────────────────────────────────────

  return {
    async decide(request: BrainDecisionRequest): Promise<BrainDecision> {
      const digest = opts.getDecisionDigest?.(request);

      const question = {
        question: request.question,
        context: digest
          ? `${request.context ?? ''}\n\nPrevious decisions:\n${digest}`
          : request.context,
        ...(request.options ? { options: request.options } : {}),
        profile: profile satisfies CouncilProfileConfig,
      };

      const result = await orchestrator.ask(question);

      // Handle failures and cancellations
      if (result.status === 'cancelled' || result.status === 'failed') {
        return finish(
          request,
          abstain(request, result.reason ?? result.errors?.[0] ?? 'council error'),
        );
      }

      if (result.status === 'abstained') {
        return finish(request, abstain(request, result.reason ?? 'no consensus'));
      }

      if (result.status === 'denied') {
        return finish(request, {
          type: 'deny',
          reason: result.reason ?? `Council (${result.resolution})`,
        });
      }

      // Decided
      if (request.options && request.options.length > 0) {
        // Option-bearing: pick the winning option
        const winningOption = request.options.find((o) => o.id === result.optionId);
        return finish(request, {
          type: 'answer',
          ...(winningOption ? { optionId: result.optionId } : {}),
          text: winningOption?.label ?? result.answer ?? 'Council decided.',
          rationale: result.reason ?? `Council (${result.resolution})`,
        });
      }

      // Optionless: use the council's synthesized answer
      return finish(request, {
        type: 'answer',
        text: result.answer ?? 'Council decided.',
        rationale: result.reason ?? `Council (${result.resolution})`,
      });
    },
  };
}
