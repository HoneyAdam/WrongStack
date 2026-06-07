/**
 * Shared configuration constants used across execution, storage, CLI, and WebUI.
 * Centralized here to avoid cross-domain import cycles.
 */

/** Default tools config — mirrors values baked into BEHAVIOR_DEFAULTS. */
export const DEFAULT_TOOLS_CONFIG = Object.freeze({
  defaultExecutionStrategy: 'smart',
  maxIterations: 100,
  iterationTimeoutMs: 300_000,
  sessionTimeoutMs: 1_800_000,
  perIterationOutputCapBytes: 100_000,
  autoExtendLimit: true,
});

/** Default context config — mirrors BEHAVIOR_DEFAULTS.context. */
export const DEFAULT_CONTEXT_CONFIG = Object.freeze({
  preserveK: 10,
  eliseThreshold: 2000,
});

/** Default autonomy config — auto-proceed delay etc. */
export const DEFAULT_AUTONOMY_CONFIG = Object.freeze({
  autoProceedDelayMs: 45_000,
});

/** Default session logging / audit configuration. */
export const DEFAULT_SESSION_LOGGING_CONFIG = Object.freeze({
  auditLevel: 'standard' as const,
  sampling: {
    toolProgress: {
      sampleRate: 8,
    },
  },
});

/** Default retention window for local session pruning. */
export const DEFAULT_SESSION_PRUNE_DAYS = 30;
