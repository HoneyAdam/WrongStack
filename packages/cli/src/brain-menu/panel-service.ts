/**
 * TUI Brain panel host — the CLI side of the BrainPanelHost bridge.
 *
 * Mirrors the auth-panel pattern: the TUI never touches config files or the
 * BrainRuntime directly; every mutation funnels through this service, which
 * calls `runtime.apply()` (live rebuild + persist to the GLOBAL config) and
 * returns an error string (panel hint) or null on success.
 */

import type {
  BrainConfigPatch,
  BrainCouncilVoterConfig,
  BrainModelEntry,
  BrainRuntime,
} from '@wrongstack/core';
import type { BrainPanelHost, BrainPanelSettings } from '@wrongstack/tui';

export interface BrainPanelServiceDeps {
  brainRuntime: BrainRuntime;
}

const PERSONA_CYCLE = ['executor', 'skeptic', 'auditor'] as const;

function compactEntry(entry: BrainModelEntry): string {
  return entry.provider ? `${entry.provider}/${entry.model}` : entry.model;
}

export function createBrainPanelHost(deps: BrainPanelServiceDeps): BrainPanelHost {
  const { brainRuntime } = deps;

  const apply = async (patch: BrainConfigPatch): Promise<string | null> => {
    try {
      const { persisted } = brainRuntime.apply(patch);
      const result = await persisted;
      return result.ok ? null : `Applied live but NOT saved: ${result.error ?? 'unknown error'}`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const currentPool = (): string[] => brainRuntime.getSnapshot().models.map(compactEntry);
  const currentVoters = (): BrainCouncilVoterConfig[] =>
    brainRuntime.getSnapshot().council.voters.map((v) => ({ ...v }));
  const applyVoters = (voters: BrainCouncilVoterConfig[]): Promise<string | null> =>
    apply({ council: { voters: voters.length > 0 ? voters : null } });

  return {
    getSettings(): BrainPanelSettings {
      const snap = brainRuntime.getSnapshot();
      return {
        mode: snap.mode,
        riskLevel: snap.maxAutoRisk,
        strategy: snap.strategy,
        decisionTimeoutMs: snap.decisionTimeoutMs,
        humanTimeoutMs: snap.humanTimeoutMs,
        pool: snap.models.map(compactEntry),
        poolResolved: snap.poolLabels,
        usingSessionModel: snap.usingSessionModel,
        councilEnabled: snap.council.enabled,
        councilMinRisk: snap.council.minRisk,
        voters: snap.council.voters.map((v) => ({
          label: compactEntry(v),
          persona: v.persona,
          veto: v.veto,
          weight: v.weight,
        })),
        councilSeats: snap.councilLabels,
        judgeLabel: snap.council.judge ? compactEntry(snap.council.judge) : undefined,
        ledgerEnabled: snap.ledger.enabled,
        autoDenyAfterFailures: snap.ledger.autoDenyAfterFailures,
      };
    },
    setMode: (mode) => apply({ mode }),
    setRisk: (level) => apply({ maxAutoRisk: level }),
    setStrategy: (strategy) => apply({ strategy }),
    setDecisionTimeout: (ms) => apply({ decisionTimeoutMs: ms ?? null }),
    setHumanTimeout: (ms) => apply({ humanTimeoutMs: ms ?? null }),
    addPoolModel: (providerId, model) =>
      apply({ models: [...currentPool(), `${providerId}/${model}`] }),
    removePoolModel: (index) => {
      const next = currentPool().filter((_, i) => i !== index);
      return apply({ models: next.length > 0 ? next : null });
    },
    clearPool: () => apply({ models: null }),
    setCouncilEnabled: (on) => apply({ council: { enabled: on } }),
    setCouncilMinRisk: (risk) => apply({ council: { minRisk: risk } }),
    addVoter: (providerId, model) => {
      const voters = currentVoters();
      const persona = PERSONA_CYCLE[voters.length % PERSONA_CYCLE.length] as string;
      return applyVoters([...voters, { provider: providerId, model, persona }]);
    },
    removeVoter: (index) => applyVoters(currentVoters().filter((_, i) => i !== index)),
    cycleVoterPersona: (index) => {
      const voters = currentVoters();
      const voter = voters[index];
      if (!voter) return Promise.resolve('No such voter.');
      const at = PERSONA_CYCLE.indexOf(voter.persona as (typeof PERSONA_CYCLE)[number]);
      voter.persona = PERSONA_CYCLE[(at + 1) % PERSONA_CYCLE.length] as string;
      return applyVoters(voters);
    },
    toggleVoterVeto: (index) => {
      const voters = currentVoters();
      const voter = voters[index];
      if (!voter) return Promise.resolve('No such voter.');
      voter.veto = !voter.veto;
      return applyVoters(voters);
    },
    setJudge: (providerId, model) => apply({ council: { judge: `${providerId}/${model}` } }),
    clearJudge: () => apply({ council: { judge: null } }),
    setLedgerEnabled: (on) => apply({ ledger: { enabled: on } }),
    setAutoDeny: (count) => apply({ ledger: { autoDenyAfterFailures: count ?? null } }),
  };
}
