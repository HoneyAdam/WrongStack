/**
 * Brain panel data model — pure types + row derivation shared by the
 * reducer (cursor clamping), the key hook (action dispatch), and the
 * component (render). Mirrors the auth-panel pattern: the TUI never
 * touches config files — every mutation goes through the host bridge,
 * which the CLI implements on top of its BrainRuntime (live apply +
 * persist to the global config).
 */

import type { BrainRiskLevel } from './brain-panel.js';

/** One configured pool entry / council voter, display-mapped. */
export interface BrainPanelVoter {
  label: string;
  persona?: string | undefined;
  veto?: boolean | undefined;
  weight?: number | undefined;
}

/** Display-mapped snapshot of the live Brain settings. */
export interface BrainPanelSettings {
  mode: 'headless' | 'interactive';
  riskLevel: BrainRiskLevel;
  strategy: 'fallback' | 'round-robin';
  decisionTimeoutMs?: number | undefined;
  humanTimeoutMs?: number | undefined;
  /** Configured pool entries as compact "provider/model" labels. */
  pool: string[];
  /** Resolved pool labels from the last assembly (≤ pool.length). */
  poolResolved: string[];
  usingSessionModel: boolean;
  councilEnabled: boolean;
  councilMinRisk: 'medium' | 'high' | 'critical';
  /** Explicitly configured voters (empty = seats derive from the pool). */
  voters: BrainPanelVoter[];
  /** Effective council seat labels (empty = council disabled). */
  councilSeats: string[];
  judgeLabel?: string | undefined;
  ledgerEnabled: boolean;
  autoDenyAfterFailures?: number | undefined;
}

/**
 * Host bridge implemented by the CLI. Every setter returns an error string
 * (shown as the panel hint) or null on success; all setters apply LIVE and
 * persist to the active profile config. Model SELECTION is not part of this
 * bridge — the panel uses the shared /model picker via requestModelPick.
 */
export interface BrainPanelHost {
  getSettings(): BrainPanelSettings;
  setMode(mode: 'headless' | 'interactive'): Promise<string | null>;
  setRisk(level: BrainRiskLevel): Promise<string | null>;
  setStrategy(strategy: 'fallback' | 'round-robin'): Promise<string | null>;
  setDecisionTimeout(ms: number | undefined): Promise<string | null>;
  setHumanTimeout(ms: number | undefined): Promise<string | null>;
  addPoolModel(providerId: string, model: string): Promise<string | null>;
  removePoolModel(index: number): Promise<string | null>;
  clearPool(): Promise<string | null>;
  setCouncilEnabled(on: boolean): Promise<string | null>;
  setCouncilMinRisk(risk: 'medium' | 'high' | 'critical'): Promise<string | null>;
  addVoter(providerId: string, model: string): Promise<string | null>;
  removeVoter(index: number): Promise<string | null>;
  cycleVoterPersona(index: number): Promise<string | null>;
  toggleVoterVeto(index: number): Promise<string | null>;
  setJudge(providerId: string, model: string): Promise<string | null>;
  clearJudge(): Promise<string | null>;
  setLedgerEnabled(on: boolean): Promise<string | null>;
  setAutoDeny(count: number | undefined): Promise<string | null>;
}

/** One selectable row of the settings view. */
export type BrainPanelRow =
  | { kind: 'mode' }
  | { kind: 'risk' }
  | { kind: 'strategy' }
  | { kind: 'timeout' }
  | { kind: 'humanTimeout' }
  | { kind: 'poolModel'; index: number }
  | { kind: 'poolAdd' }
  | { kind: 'councilToggle' }
  | { kind: 'councilMinRisk' }
  | { kind: 'voter'; index: number }
  | { kind: 'voterAdd' }
  | { kind: 'judge' }
  | { kind: 'ledgerToggle' }
  | { kind: 'autoDeny' };

/** Derive the selectable rows for a settings snapshot. */
export function brainPanelRows(settings: BrainPanelSettings): BrainPanelRow[] {
  const rows: BrainPanelRow[] = [{ kind: 'mode' }, { kind: 'risk' }];
  for (let i = 0; i < settings.pool.length; i += 1) rows.push({ kind: 'poolModel', index: i });
  rows.push({ kind: 'poolAdd' });
  if (settings.pool.length > 1) rows.push({ kind: 'strategy' });
  rows.push({ kind: 'timeout' }, { kind: 'humanTimeout' });
  rows.push({ kind: 'councilToggle' });
  if (settings.councilEnabled || settings.voters.length > 0) {
    rows.push({ kind: 'councilMinRisk' });
    for (let i = 0; i < settings.voters.length; i += 1) rows.push({ kind: 'voter', index: i });
    rows.push({ kind: 'voterAdd' }, { kind: 'judge' });
  }
  rows.push({ kind: 'ledgerToggle' });
  if (settings.ledgerEnabled) rows.push({ kind: 'autoDeny' });
  return rows;
}

/** Preset ladders for ←/→ cycling on numeric rows. */
export const DECISION_TIMEOUT_PRESETS: ReadonlyArray<number | undefined> = [
  undefined,
  5_000,
  10_000,
  20_000,
  30_000,
  60_000,
];
export const HUMAN_TIMEOUT_PRESETS: ReadonlyArray<number | undefined> = [
  undefined,
  30_000,
  60_000,
  120_000,
  300_000,
];
export const AUTO_DENY_PRESETS: ReadonlyArray<number | undefined> = [undefined, 0, 2, 3, 5];
export const PERSONA_CYCLE = ['executor', 'skeptic', 'auditor'] as const;

/** Cycle helper: step through a preset ladder from the current value. */
export function cyclePreset<T>(presets: ReadonlyArray<T>, current: T, delta: number): T {
  const idx = presets.indexOf(current);
  const from = idx >= 0 ? idx : 0;
  const next = (from + delta + presets.length) % presets.length;
  return presets[next] as T;
}
