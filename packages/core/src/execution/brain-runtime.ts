/**
 * BrainRuntime — the live, rebuildable owner of `config.brain`.
 *
 * The Brain chain used to be assembled once at boot; every knob except the
 * risk ceiling and escalation mode was frozen until restart. This module
 * makes the whole `BrainConfig` surface live-editable AND persistable from
 * any host surface (/brain subcommands, TUI Brain panel, WebUI BrainSection):
 *
 *   - `arbiter` is a STABLE delegating handle (`decide` reads a mutable
 *     `current`), so hosts wrap it once in their EscalationRouting/Observable
 *     layers and no consumer ever needs a rebind after a settings change.
 *   - `apply(patch)` normalizes + validates the patch, commits it, rebuilds
 *     the tier chain when a structural knob changed (pool, council, timeout,
 *     ledger guard), and persists through an injected callback — core never
 *     touches config files itself.
 *   - `getSnapshot()` is the JSON-safe truth both UIs render: configured
 *     values plus derived facts (resolved pool/council labels, EFFECTIVE
 *     council enablement, session-model fallback).
 *
 * Persistence contract: `config.brain` is on the in-project deny list, so
 * the injected `persist` MUST write the GLOBAL config. A persist failure
 * never rolls back the live change; it is reported via the returned promise.
 *
 * @module brain-runtime
 */

import {
  type BrainArbiter,
  type BrainDecisionRequest,
  type BrainEscalationMode,
  DefaultBrainArbiter,
} from '../coordination/brain.js';
import { createLedgerGuardBrainArbiter } from '../coordination/brain-ledger.js';
import { parseModelRef } from '../core/fallback-model.js';
import type { BrainConfig, BrainCouncilVoterConfig, BrainModelEntry } from '../types/config.js';
import type { Provider } from '../types/provider.js';
import { type BrainAutoRisk, createTieredBrainArbiter } from './autonomy-brain.js';
import { assembleBrainTiers } from './brain-chain.js';

export type BrainCouncilMinRisk = 'medium' | 'high' | 'critical';
export type BrainPoolStrategy = 'fallback' | 'round-robin';

/** JSON-safe view of the live Brain configuration + derived facts. */
export interface BrainConfigSnapshot {
  mode: BrainEscalationMode;
  maxAutoRisk: BrainAutoRisk;
  /** Configured pool entries (normalized). Empty = session model. */
  models: BrainModelEntry[];
  strategy: BrainPoolStrategy;
  decisionTimeoutMs: number | undefined;
  humanTimeoutMs: number | undefined;
  council: {
    /** EFFECTIVE enablement (default rule `voters >= 2` applied). */
    enabled: boolean;
    /** Raw configured value (undefined = default rule decides). */
    configured: boolean | undefined;
    minRisk: BrainCouncilMinRisk;
    /** Explicitly configured voters; seats derived from the pool are visible via `councilLabels`. */
    voters: BrainCouncilVoterConfig[];
    quorum: number | undefined;
    approval: number | undefined;
    judge: BrainModelEntry | undefined;
  };
  ledger: {
    enabled: boolean;
    autoDenyAfterFailures: number | undefined;
    path: string | undefined;
  };
  /** Resolved pool labels from the LAST assembly (may be fewer than `models` — unresolvable refs are skipped). */
  poolLabels: string[];
  /** Resolved council seat labels; empty = council effectively disabled. */
  councilLabels: string[];
  usingSessionModel: boolean;
}

/** Council sub-patch. Arrays REPLACE; `null` clears back to the default. */
export interface BrainCouncilPatch {
  enabled?: boolean | null | undefined;
  minRisk?: BrainCouncilMinRisk | null | undefined;
  voters?: Array<string | BrainCouncilVoterConfig> | null | undefined;
  quorum?: number | null | undefined;
  approval?: number | null | undefined;
  judge?: string | BrainModelEntry | null | undefined;
}

/**
 * Partial update for the live Brain config. Omitted fields are untouched,
 * `null` clears a field back to its default, arrays replace wholesale.
 */
export interface BrainConfigPatch {
  mode?: BrainEscalationMode | undefined;
  maxAutoRisk?: BrainAutoRisk | undefined;
  models?: Array<string | BrainModelEntry> | null | undefined;
  strategy?: BrainPoolStrategy | null | undefined;
  decisionTimeoutMs?: number | null | undefined;
  humanTimeoutMs?: number | null | undefined;
  council?: BrainCouncilPatch | null | undefined;
  ledger?:
    | {
        enabled?: boolean | undefined;
        autoDenyAfterFailures?: number | null | undefined;
      }
    | null
    | undefined;
}

/** Host-owned ledger controller — the runtime never touches ledger files. */
export interface BrainRuntimeLedgerHost {
  getPath: () => string | undefined;
  isEnabled: () => boolean;
  /** Host starts/stops its BrainDecisionLedger instance. */
  setEnabled: (enabled: boolean) => void;
  failureStreakFor?:
    | ((request: Pick<BrainDecisionRequest, 'source' | 'question' | 'id'>) => number)
    | undefined;
  getDecisionDigest?: ((request: BrainDecisionRequest) => string | undefined) | undefined;
}

export interface BrainRuntimeOptions {
  /** Boot-time `config.brain`. Invalid entries are dropped leniently here (apply() is strict). */
  initialConfig: BrainConfig | undefined;
  /** The session's provider id (`config.provider`). */
  defaultProviderId: string;
  /** Live session provider — read per decision so `/setmodel` switches apply. */
  sessionProvider: () => Provider;
  /** Live session model id — read per decision. */
  sessionModel: () => string;
  /** Resolve a NON-default provider id. May throw / return null → entry skipped. */
  resolveProvider: (providerId: string, model: string) => Provider | null;
  ledger?: BrainRuntimeLedgerHost | undefined;
  /**
   * Injected writer for the canonical `BrainConfig`. MUST target the global
   * config (`config.brain` is denied in project scope). Absent = live-only.
   */
  persist?: ((config: BrainConfig) => Promise<void>) | undefined;
  /** Fired after every successful apply, with the fresh snapshot. */
  onApplied?: ((snapshot: BrainConfigSnapshot) => void) | undefined;
}

export interface BrainApplyResult {
  snapshot: BrainConfigSnapshot;
  /** Resolves `{ok: true}` immediately when persistence was skipped or absent. */
  persisted: Promise<{ ok: boolean; error?: string | undefined }>;
}

export interface BrainRuntime {
  /** STABLE arbiter handle — the inner tier chain swaps on `apply`. */
  arbiter: BrainArbiter;
  getMode(): BrainEscalationMode;
  getMaxAutoRisk(): BrainAutoRisk;
  getHumanTimeoutMs(): number | undefined;
  getSnapshot(): BrainConfigSnapshot;
  /** Canonical shape written to `config.brain` (compact string refs where lossless). */
  getConfig(): BrainConfig;
  /** Live-apply synchronously; persistence (default on) is async best-effort. */
  apply(patch: BrainConfigPatch, opts?: { persist?: boolean | undefined }): BrainApplyResult;
}

/** Patch keys that are read per-decision via closures — no chain rebuild needed. */
const FAST_PATH_KEYS: ReadonlySet<string> = new Set(['mode', 'maxAutoRisk', 'humanTimeoutMs']);

const AUTO_RISK_LEVELS: ReadonlySet<string> = new Set(['off', 'low', 'medium', 'high', 'all']);
const COUNCIL_MIN_RISKS: ReadonlySet<string> = new Set(['medium', 'high', 'critical']);

function normalizeEntry(raw: string | BrainModelEntry): BrainModelEntry {
  const parsed =
    typeof raw === 'string'
      ? (parseModelRef(raw) as { provider?: string | undefined; model?: string | undefined })
      : raw;
  const model = parsed.model?.trim();
  if (!model) {
    throw new Error(
      `Invalid model ref: ${typeof raw === 'string' ? `"${raw}"` : JSON.stringify(raw)} (expected "model" or "provider/model")`,
    );
  }
  const provider = parsed.provider?.trim();
  return provider ? { provider, model } : { model };
}

function normalizeVoter(raw: string | BrainCouncilVoterConfig): BrainCouncilVoterConfig {
  if (typeof raw === 'string') return normalizeEntry(raw);
  const base = normalizeEntry(raw);
  const voter: BrainCouncilVoterConfig = { ...base };
  if (raw.persona !== undefined) voter.persona = raw.persona;
  if (raw.weight !== undefined) {
    if (!Number.isFinite(raw.weight) || raw.weight <= 0) {
      throw new Error(`Invalid voter weight: ${String(raw.weight)} (must be a positive number)`);
    }
    voter.weight = raw.weight;
  }
  if (raw.veto !== undefined) voter.veto = raw.veto;
  return voter;
}

function requireFraction(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`Invalid ${label}: ${String(value)} (must be in (0, 1])`);
  }
  return value;
}

function requirePositiveMs(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid ${label}: ${String(value)} (must be a positive number of milliseconds)`,
    );
  }
  return Math.round(value);
}

/** Compact a normalized entry to the friendliest lossless config form. */
function compactEntry(entry: BrainModelEntry): string {
  return entry.provider ? `${entry.provider}/${entry.model}` : entry.model;
}

function compactVoter(voter: BrainCouncilVoterConfig): string | BrainCouncilVoterConfig {
  if (voter.persona === undefined && voter.weight === undefined && voter.veto === undefined) {
    return compactEntry(voter);
  }
  return { ...voter };
}

export interface BrainDefaultsContext {
  /** The session's fallback chain (`config.fallbackModels`) — seeds the default pool. */
  fallbackModels?: readonly string[] | undefined;
}

/**
 * Product defaults for hosts that want a minimum-human Brain out of the box
 * (CLI/TUI wiring and the standalone WebUI server both apply this before
 * `createBrainRuntime`). Only FILLS GAPS — every explicitly configured field
 * wins, so existing `config.brain` blocks are untouched by updates.
 *
 *   - `models`  → the user's own `fallbackModels` chain (never hardcoded
 *     model ids; every install has different providers). With ≥2 entries the
 *     council auto-derives from the pool, so multi-model users get a council
 *     by default.
 *   - `mode`    → 'headless': decisions never block on a human; the terminal
 *     policy (safe default / deny) is the escalation of last resort.
 *   - `maxAutoRisk` → adaptive: 'all' when a council can convene (critical
 *     questions get a multi-model panel), otherwise 'high' (critical
 *     questions resolve via the conservative terminal policy instead of a
 *     single unchecked model).
 *   - `humanTimeoutMs` → 120s: if the user explicitly switches back to
 *     'interactive', an unanswered prompt still auto-resolves instead of
 *     hanging an unattended run forever. Set `humanTimeoutMs: 0` to restore
 *     the legacy wait-indefinitely behavior.
 *
 * NOTE deliberately NOT persisted anywhere — resolved at boot, so existing
 * users pick these up on update without any config migration/write.
 */
export function resolveBrainConfigDefaults(
  brain: BrainConfig | undefined,
  ctx: BrainDefaultsContext = {},
): BrainConfig {
  const cfg: BrainConfig = { ...(brain ?? {}) };
  if (cfg.models === undefined && ctx.fallbackModels && ctx.fallbackModels.length > 0) {
    cfg.models = [...ctx.fallbackModels];
  }
  const seatCount = cfg.council?.voters?.length ?? cfg.models?.length ?? 0;
  const councilLikely = cfg.council?.enabled ?? seatCount >= 2;
  if (cfg.mode === undefined) cfg.mode = 'headless';
  if (cfg.maxAutoRisk === undefined) cfg.maxAutoRisk = councilLikely ? 'all' : 'high';
  if (cfg.humanTimeoutMs === undefined) cfg.humanTimeoutMs = 120_000;
  return cfg;
}

/** Lenient boot-time normalization: bad entries are dropped, not fatal. */
function normalizeInitial(config: BrainConfig | undefined): BrainConfig {
  const cfg: BrainConfig = { ...(config ?? {}) };
  const safe = <T, R>(items: readonly T[] | undefined, map: (item: T) => R): R[] =>
    (items ?? []).flatMap((item) => {
      try {
        return [map(item)];
      } catch {
        return [];
      }
    });
  if (cfg.models) cfg.models = safe(cfg.models, normalizeEntry);
  if (cfg.council) {
    const council = { ...cfg.council };
    if (council.voters) council.voters = safe(council.voters, normalizeVoter);
    if (council.judge) {
      try {
        council.judge = normalizeEntry(council.judge);
      } catch {
        council.judge = undefined;
      }
    }
    cfg.council = council;
  }
  return cfg;
}

export function createBrainRuntime(opts: BrainRuntimeOptions): BrainRuntime {
  let cfg: BrainConfig = normalizeInitial(opts.initialConfig);
  let poolLabels: string[] = [];
  let councilLabels: string[] = [];
  let current: BrainArbiter;

  // Digest + streak wrappers check the host's live ledger enablement per call
  // so a ledger toggle takes effect without re-plumbing.
  const getDecisionDigest = (request: BrainDecisionRequest): string | undefined => {
    const ledger = opts.ledger;
    if (!ledger || !ledger.isEnabled()) return undefined;
    return ledger.getDecisionDigest?.(request);
  };

  function rebuild(): void {
    const tiers = assembleBrainTiers({
      brainConfig: cfg,
      defaultProviderId: opts.defaultProviderId,
      sessionProvider: opts.sessionProvider,
      sessionModel: opts.sessionModel,
      resolveProvider: opts.resolveProvider,
      getDecisionDigest,
    });
    poolLabels = tiers.poolLabels;
    councilLabels = tiers.councilLabels;
    const tiered = createTieredBrainArbiter({
      policy: new DefaultBrainArbiter(),
      autonomous: tiers.autonomous,
      getMaxAutoRisk: () => cfg.maxAutoRisk ?? 'medium',
      council: tiers.council,
      getCouncilMinRisk: tiers.getCouncilMinRisk,
    });
    const streakFor = opts.ledger?.failureStreakFor;
    current =
      streakFor && opts.ledger?.isEnabled()
        ? createLedgerGuardBrainArbiter({
            inner: tiered,
            failureStreakFor: streakFor,
            denyAfter: cfg.ledger?.autoDenyAfterFailures,
          })
        : tiered;
  }
  rebuild();

  /** Merge + validate a patch into a NEW config. Throws before any state changes. */
  function mergePatch(patch: BrainConfigPatch): { next: BrainConfig; rebuildNeeded: boolean } {
    const next: BrainConfig = { ...cfg, council: cfg.council ? { ...cfg.council } : undefined };
    let rebuildNeeded = false;
    const structural = (): void => {
      rebuildNeeded = true;
    };

    if (patch.mode !== undefined) {
      if (patch.mode !== 'headless' && patch.mode !== 'interactive') {
        throw new Error(`Invalid mode: ${String(patch.mode)}`);
      }
      next.mode = patch.mode;
    }
    if (patch.maxAutoRisk !== undefined) {
      if (!AUTO_RISK_LEVELS.has(patch.maxAutoRisk)) {
        throw new Error(`Invalid maxAutoRisk: ${String(patch.maxAutoRisk)}`);
      }
      next.maxAutoRisk = patch.maxAutoRisk;
    }
    if (patch.humanTimeoutMs !== undefined) {
      next.humanTimeoutMs =
        patch.humanTimeoutMs === null
          ? undefined
          : requirePositiveMs(patch.humanTimeoutMs, 'humanTimeoutMs');
    }
    if (patch.models !== undefined) {
      next.models = patch.models === null ? undefined : patch.models.map(normalizeEntry);
      structural();
    }
    if (patch.strategy !== undefined) {
      if (
        patch.strategy !== null &&
        patch.strategy !== 'fallback' &&
        patch.strategy !== 'round-robin'
      ) {
        throw new Error(`Invalid strategy: ${String(patch.strategy)}`);
      }
      next.strategy = patch.strategy ?? undefined;
      structural();
    }
    if (patch.decisionTimeoutMs !== undefined) {
      next.decisionTimeoutMs =
        patch.decisionTimeoutMs === null
          ? undefined
          : requirePositiveMs(patch.decisionTimeoutMs, 'decisionTimeoutMs');
      structural();
    }
    if (patch.council !== undefined) {
      if (patch.council === null) {
        next.council = undefined;
      } else {
        const c = { ...(next.council ?? {}) };
        const p = patch.council;
        if (p.enabled !== undefined) c.enabled = p.enabled === null ? undefined : p.enabled;
        if (p.minRisk !== undefined) {
          if (p.minRisk !== null && !COUNCIL_MIN_RISKS.has(p.minRisk)) {
            throw new Error(`Invalid council minRisk: ${String(p.minRisk)}`);
          }
          c.minRisk = p.minRisk ?? undefined;
        }
        if (p.voters !== undefined) {
          c.voters = p.voters === null ? undefined : p.voters.map(normalizeVoter);
        }
        if (p.quorum !== undefined) {
          c.quorum = p.quorum === null ? undefined : requireFraction(p.quorum, 'council quorum');
        }
        if (p.approval !== undefined) {
          c.approval =
            p.approval === null ? undefined : requireFraction(p.approval, 'council approval');
        }
        if (p.judge !== undefined) {
          c.judge = p.judge === null ? undefined : normalizeEntry(p.judge);
        }
        next.council = c;
      }
      structural();
    }
    if (patch.ledger !== undefined) {
      if (patch.ledger === null) {
        next.ledger = undefined;
      } else {
        const l = { ...(next.ledger ?? {}) };
        if (patch.ledger.enabled !== undefined) l.enabled = patch.ledger.enabled;
        if (patch.ledger.autoDenyAfterFailures !== undefined) {
          const n = patch.ledger.autoDenyAfterFailures;
          if (n !== null && (!Number.isInteger(n) || n < 0)) {
            throw new Error(
              `Invalid autoDenyAfterFailures: ${String(n)} (must be an integer >= 0)`,
            );
          }
          l.autoDenyAfterFailures = n ?? undefined;
        }
        next.ledger = l;
      }
      structural();
    }

    for (const key of Object.keys(patch)) {
      if (!FAST_PATH_KEYS.has(key) && (patch as Record<string, unknown>)[key] !== undefined) {
        // structural keys already flagged above; unknown keys are rejected
        if (!['models', 'strategy', 'decisionTimeoutMs', 'council', 'ledger'].includes(key)) {
          throw new Error(`Unknown brain config field: ${key}`);
        }
      }
    }
    return { next, rebuildNeeded };
  }

  function getSnapshot(): BrainConfigSnapshot {
    const councilCfg = cfg.council;
    const voters = (councilCfg?.voters ?? []).map((v) => normalizeVoter(v));
    return {
      mode: cfg.mode ?? 'interactive',
      maxAutoRisk: cfg.maxAutoRisk ?? 'medium',
      models: (cfg.models ?? []).map((m) => normalizeEntry(m)),
      strategy: cfg.strategy ?? 'fallback',
      decisionTimeoutMs: cfg.decisionTimeoutMs,
      humanTimeoutMs: cfg.humanTimeoutMs,
      council: {
        enabled: councilLabels.length > 0,
        configured: councilCfg?.enabled,
        minRisk: councilCfg?.minRisk ?? 'high',
        voters,
        quorum: councilCfg?.quorum,
        approval: councilCfg?.approval,
        judge: councilCfg?.judge ? normalizeEntry(councilCfg.judge) : undefined,
      },
      ledger: {
        enabled: opts.ledger?.isEnabled() ?? false,
        autoDenyAfterFailures: cfg.ledger?.autoDenyAfterFailures,
        path: opts.ledger?.getPath(),
      },
      poolLabels: [...poolLabels],
      councilLabels: [...councilLabels],
      usingSessionModel: (cfg.models ?? []).length === 0,
    };
  }

  function getConfig(): BrainConfig {
    const out: BrainConfig = {};
    if (cfg.mode !== undefined) out.mode = cfg.mode;
    if (cfg.maxAutoRisk !== undefined) out.maxAutoRisk = cfg.maxAutoRisk;
    if (cfg.models?.length) out.models = cfg.models.map((m) => compactEntry(normalizeEntry(m)));
    if (cfg.strategy !== undefined) out.strategy = cfg.strategy;
    if (cfg.decisionTimeoutMs !== undefined) out.decisionTimeoutMs = cfg.decisionTimeoutMs;
    if (cfg.humanTimeoutMs !== undefined) out.humanTimeoutMs = cfg.humanTimeoutMs;
    if (cfg.council !== undefined) {
      const c = cfg.council;
      const outCouncil: NonNullable<BrainConfig['council']> = {};
      if (c.enabled !== undefined) outCouncil.enabled = c.enabled;
      if (c.minRisk !== undefined) outCouncil.minRisk = c.minRisk;
      if (c.voters?.length)
        outCouncil.voters = c.voters.map((v) => compactVoter(normalizeVoter(v)));
      if (c.quorum !== undefined) outCouncil.quorum = c.quorum;
      if (c.approval !== undefined) outCouncil.approval = c.approval;
      if (c.judge !== undefined) outCouncil.judge = compactEntry(normalizeEntry(c.judge));
      out.council = outCouncil;
    }
    if (cfg.ledger !== undefined) out.ledger = { ...cfg.ledger };
    if (cfg.monitor !== undefined) out.monitor = { ...cfg.monitor };
    return out;
  }

  return {
    arbiter: {
      decide: (request) => current.decide(request),
    },
    getMode: () => cfg.mode ?? 'interactive',
    getMaxAutoRisk: () => cfg.maxAutoRisk ?? 'medium',
    getHumanTimeoutMs: () => cfg.humanTimeoutMs,
    getSnapshot,
    getConfig,
    apply(patch, applyOpts) {
      const { next, rebuildNeeded } = mergePatch(patch);
      cfg = next;
      // Ledger enablement is host-owned state — toggle it BEFORE rebuilding
      // so the guard wrap sees the new value.
      if (patch.ledger && patch.ledger.enabled !== undefined) {
        opts.ledger?.setEnabled(patch.ledger.enabled);
      }
      if (rebuildNeeded) rebuild();
      const snapshot = getSnapshot();
      const shouldPersist = applyOpts?.persist !== false && opts.persist !== undefined;
      const persisted: Promise<{ ok: boolean; error?: string | undefined }> = shouldPersist
        ? (opts.persist as (config: BrainConfig) => Promise<void>)(getConfig()).then(
            () => ({ ok: true }),
            (err: unknown) => ({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        : Promise.resolve({ ok: true });
      opts.onApplied?.(snapshot);
      return { snapshot, persisted };
    },
  };
}
