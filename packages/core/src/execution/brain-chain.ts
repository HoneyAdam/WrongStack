/**
 * Brain tier assembly — turns `Config.brain` into the concrete LLM tiers
 * (single-LLM pool + optional multi-LLM council) that
 * `createTieredBrainArbiter` composes. Shared by every host that wires a
 * Brain (CLI/TUI in `wiring/brain-and-orchestration.ts`, the standalone
 * WebUI server in `backend-services.ts`) so the config surface behaves
 * identically everywhere.
 *
 * Hosts differ only in HOW a provider id becomes a `Provider` instance, so
 * that is the one injected dependency (`resolveProvider`). Unresolvable
 * pool/council entries are skipped — one bad ref never takes the Brain down.
 *
 * @module brain-chain
 */

import type { BrainArbiter, BrainDecisionRequest } from '../coordination/brain.js';
import { parseModelRef } from '../core/fallback-model.js';
import type { BrainConfig, BrainModelEntry } from '../types/config.js';
import type { Provider } from '../types/provider.js';
import { type BrainLlmTarget, createAutonomyBrain } from './autonomy-brain.js';
import { type CouncilVoter, createCouncilBrainArbiter } from './council-brain.js';

/** Default council seats, assigned in order to voters without a persona. */
const DEFAULT_SEATS: ReadonlyArray<Pick<CouncilVoter, 'persona' | 'veto'>> = [
  { persona: 'executor' },
  { persona: 'skeptic', veto: true },
  { persona: 'auditor' },
];

export interface BrainTierAssemblyOptions {
  /** `config.brain` — undefined assembles the legacy session-model single tier. */
  brainConfig: BrainConfig | undefined;
  /** The session's provider id (`config.provider`). */
  defaultProviderId: string;
  /** Live session provider — read per decision so `/setmodel` switches apply. */
  sessionProvider: () => Provider;
  /** Live session model id — read per decision. */
  sessionModel: () => string;
  /**
   * Resolve a NON-default provider id to a Provider instance. May throw or
   * return null; the entry is then skipped.
   */
  resolveProvider: (providerId: string, model: string) => Provider | null;
  /**
   * Decision-history digest (typically `BrainDecisionLedger.digestFor`) —
   * injected into both the single-LLM and council prompts so the Brain
   * learns from the outcomes of its past similar decisions.
   */
  getDecisionDigest?: ((request: BrainDecisionRequest) => string | undefined) | undefined;
}

export interface BrainTierAssembly {
  /** Single-LLM tier for `TieredBrainArbiterOptions.autonomous`. */
  autonomous: BrainArbiter;
  /** Council tier for `TieredBrainArbiterOptions.council` (undefined = disabled). */
  council: BrainArbiter | undefined;
  /** Live council risk floor for `TieredBrainArbiterOptions.getCouncilMinRisk`. */
  getCouncilMinRisk: () => 'medium' | 'high' | 'critical';
  /** Human-readable pool labels for status surfaces; empty = session model. */
  poolLabels: string[];
  /** Human-readable council seat labels; empty = council disabled. */
  councilLabels: string[];
}

/** Assemble the LLM tiers of the Brain chain from `Config.brain`. */
export function assembleBrainTiers(opts: BrainTierAssemblyOptions): BrainTierAssembly {
  const brainCfg = opts.brainConfig;

  const toEntry = (entry: string | BrainModelEntry): BrainModelEntry =>
    typeof entry === 'string' ? (parseModelRef(entry) as BrainModelEntry) : entry;
  const buildTarget = (entry: BrainModelEntry): BrainLlmTarget | null => {
    if (!entry.model) return null;
    const providerId = entry.provider ?? opts.defaultProviderId;
    try {
      const provider =
        providerId === opts.defaultProviderId
          ? opts.sessionProvider()
          : opts.resolveProvider(providerId, entry.model);
      if (!provider) return null;
      return { provider, model: entry.model, label: `${providerId}/${entry.model}` };
    } catch {
      return null;
    }
  };

  const poolTargets = (brainCfg?.models ?? [])
    .map(toEntry)
    .map(buildTarget)
    .filter((t): t is BrainLlmTarget => t !== null);

  // Single-LLM tier. With a configured pool the arbiter is constructed once
  // (round-robin cursor + fallback order persist across decisions); without
  // one it is built per decision so live provider/model switches apply.
  const autonomous: BrainArbiter =
    poolTargets.length > 0
      ? createAutonomyBrain({
          targets: poolTargets,
          strategy: brainCfg?.strategy ?? 'fallback',
          maxAutoRisk: 'all', // the tiered ceiling gates risk — keep inner permissive
          decisionTimeoutMs: brainCfg?.decisionTimeoutMs,
          getDecisionDigest: opts.getDecisionDigest,
        })
      : {
          decide: (request) =>
            createAutonomyBrain({
              provider: opts.sessionProvider(),
              model: opts.sessionModel(),
              maxAutoRisk: 'all',
              decisionTimeoutMs: brainCfg?.decisionTimeoutMs,
              getDecisionDigest: opts.getDecisionDigest,
            }).decide(request),
        };

  // Council tier — seats come from explicit `brain.council.voters` or are
  // derived from the pool (first 3 models, default personas).
  const councilCfg = brainCfg?.council;
  const explicitVoters = (councilCfg?.voters ?? []).map((v) =>
    typeof v === 'string' ? { entry: toEntry(v), cfg: {} as Partial<CouncilVoter> } : { entry: v, cfg: v },
  );
  const voters: CouncilVoter[] = (
    explicitVoters.length > 0
      ? explicitVoters.map(({ entry, cfg }, i) => {
          const target = buildTarget(entry);
          if (!target) return null;
          const seat = DEFAULT_SEATS[i % DEFAULT_SEATS.length];
          return {
            ...target,
            persona: cfg.persona ?? seat?.persona,
            weight: cfg.weight,
            veto: cfg.veto ?? seat?.veto,
          } satisfies CouncilVoter;
        })
      : poolTargets.slice(0, DEFAULT_SEATS.length).map((target, i) => ({
          ...target,
          ...DEFAULT_SEATS[i % DEFAULT_SEATS.length],
        }))
  ).filter((v): v is CouncilVoter => v !== null);

  const judgeEntry = councilCfg?.judge
    ? typeof councilCfg.judge === 'string'
      ? toEntry(councilCfg.judge)
      : councilCfg.judge
    : undefined;
  const judge = (judgeEntry ? buildTarget(judgeEntry) : null) ?? poolTargets[0] ?? voters[0];
  const councilEnabled = councilCfg?.enabled ?? voters.length >= 2;
  const council =
    councilEnabled && voters.length >= 2
      ? createCouncilBrainArbiter({
          voters,
          judge,
          quorumFraction: councilCfg?.quorum,
          approvalFraction: councilCfg?.approval,
          decisionTimeoutMs: brainCfg?.decisionTimeoutMs,
          getDecisionDigest: opts.getDecisionDigest,
        })
      : undefined;

  return {
    autonomous,
    council,
    getCouncilMinRisk: () => councilCfg?.minRisk ?? 'high',
    poolLabels: poolTargets.map((t) => t.label ?? t.model),
    councilLabels: council
      ? voters.map((v) => `${v.label ?? v.model} (${v.persona ?? 'voter'}${v.veto ? ', veto' : ''})`)
      : [],
  };
}
