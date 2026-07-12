import { join } from 'node:path';
import {
  assembleBrainTiers,
  type BrainAutoRisk,
  BrainDecisionLedger,
  BrainDecisionQueue,
  type BrainEscalationMode,
  BrainMonitor,
  type Config,
  createDelegateTool,
  createLedgerGuardBrainArbiter,
  createMcpControlTool,
  createMcpUseTool,
  createTieredBrainArbiter,
  DefaultBrainArbiter,
  EscalationRoutingBrainArbiter,
  FLEET_ROSTER,
  ObservableBrainArbiter,
  type Provider,
  type SessionWriter,
  terminalPolicyDecision,
  TOKENS,
  type ToolRegistry,
} from '@wrongstack/core';
import { buildProviderForId } from './provider-runtime.js';
import { MultiAgentHost } from '../multi-agent.js';
import { subscribeBrainDecisionLog } from '../boot/brain-decision-log.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: large dep bag
type AnyObj = any;

/**
 * Live-mutable Brain settings shared with `/brain` (risk + mode subcommands)
 * and the TUI Brain panel. `describe` fields are static wiring facts surfaced
 * in `/brain status`.
 */
export interface BrainRuntimeSettings {
  maxAutoRisk: BrainAutoRisk;
  /** 'headless' = never block on a human; terminal policy resolves escalations. */
  mode: BrainEscalationMode;
  /** Human-readable pool labels (e.g. "anthropic/claude-haiku"), empty = session model. */
  poolLabels: string[];
  /** Human-readable council seat labels, empty = council disabled. */
  councilLabels: string[];
  /** Absolute path of the persistent decision ledger (undefined = disabled). */
  ledgerPath?: string | undefined;
}

export interface BrainOrchestrationDeps {
  events: AnyObj;
  config: Config;
  container: AnyObj;
  provider: Provider;
  session: SessionWriter;
  context: AnyObj;
  toolRegistry: ToolRegistry;
  providerRegistry: AnyObj;
  configStore: AnyObj;
  modelsRegistry: AnyObj;
  promptBuilder: AnyObj;
  tokenCounter: AnyObj;
  projectRoot: string;
  cwd: string;
  wpaths: AnyObj;
  teardownHandlers: (() => void)[];
  mailboxSessionTag: (id: string) => string;
  brainMailbox: AnyObj;
  agentMonitor: AnyObj;
  directorMode: boolean;
  manifestPath: string | undefined;
  sharedScratchpadPath: string | undefined;
  subagentSessionsRoot: string | undefined;
  stateCheckpointPath: string | undefined;
  fleetRootForPromotion: string;
  maxConcurrent: number | undefined;
  effectiveMaxContextRef: { current: number };
  mcpRegistry: AnyObj;
  sessResult: AnyObj;
}

export interface BrainOrchestrationResult {
  brain: ObservableBrainArbiter;
  brainLog: AnyObj[];
  brainSettings: BrainRuntimeSettings;
  brainQueue: BrainDecisionQueue;
  multiAgentHost: MultiAgentHost;
  shadowController: AnyObj;
  shadowDefaults: { intervalMs?: number; provider?: string; model?: string };
}

/**
 * Wire the global Brain chain (policy → LLM → human), BrainMonitor,
 * shadow controller, MultiAgentHost (subagent orchestration), and
 * delegate/mcp_control/mcp_use tool registration.
 *
 * The HQ telemetry bridges (setupHqTelemetry) are called separately
 * between brain chain setup and brain monitor creation in cli-main.ts,
 * which is why this function has two logical halves stitched together.
 */
export function setupBrainAndOrchestration(
  deps: BrainOrchestrationDeps,
): BrainOrchestrationResult {
  const {
    events,
    config,
    container,
    provider,
    session,
    context,
    toolRegistry,
    providerRegistry,
    configStore,
    modelsRegistry,
    promptBuilder,
    tokenCounter,
    projectRoot,
    cwd,
    wpaths,
    teardownHandlers,
    mailboxSessionTag,
    brainMailbox,
    agentMonitor,
    directorMode,
    manifestPath,
    sharedScratchpadPath,
    subagentSessionsRoot,
    stateCheckpointPath,
    fleetRootForPromotion,
    maxConcurrent,
    effectiveMaxContextRef,
    mcpRegistry,
    sessResult,
  } = deps;

  // ── Global Brain chain — policy → LLM/council → escalation ─────────────
  // Escalation routing is config-driven: 'interactive' prompts the human,
  // 'headless' resolves through the terminal policy so the Brain NEVER
  // blocks on a person. Switch live with `/brain mode <m>`. The LLM pool
  // and council come from `config.brain` via the shared tier assembly.
  const brainCfg = config.brain;

  // Persistent decision ledger — records every decision + observed outcome
  // (budget extensions vs. later task results, steer re-triggers) and feeds
  // outcome stats of similar past decisions back into the LLM/council
  // prompts. Lives OUTSIDE the repo, per project, across sessions.
  const ledgerEnabled = brainCfg?.ledger?.enabled !== false;
  const ledgerPath = join(wpaths.projectDir, 'brain-ledger.jsonl');
  const brainLedger = ledgerEnabled
    ? new BrainDecisionLedger({ events, filePath: ledgerPath })
    : undefined;
  if (brainLedger) {
    void brainLedger.start();
    teardownHandlers.push(() => {
      void brainLedger.stop();
    });
  }

  const tiers = assembleBrainTiers({
    brainConfig: brainCfg,
    defaultProviderId: config.provider,
    sessionProvider: () => provider,
    sessionModel: () => config.model,
    resolveProvider: (providerId) => buildProviderForId({ config, providerRegistry }, providerId),
    getDecisionDigest: brainLedger ? (request) => brainLedger.digestFor(request) : undefined,
  });

  const brainSettings: BrainRuntimeSettings = {
    maxAutoRisk: brainCfg?.maxAutoRisk ?? 'medium',
    mode: brainCfg?.mode ?? 'interactive',
    poolLabels: tiers.poolLabels,
    councilLabels: tiers.councilLabels,
    ledgerPath: brainLedger ? ledgerPath : undefined,
  };
  const brainQueue = new BrainDecisionQueue(events, {
    // An unanswered interactive prompt degrades to the terminal policy
    // instead of hanging the caller forever (when a timeout is configured).
    timeoutMs: brainCfg?.humanTimeoutMs,
    onTimeout: terminalPolicyDecision,
  });

  const tiered = createTieredBrainArbiter({
    policy: new DefaultBrainArbiter(),
    autonomous: tiers.autonomous,
    getMaxAutoRisk: () => brainSettings.maxAutoRisk,
    council: tiers.council,
    getCouncilMinRisk: tiers.getCouncilMinRisk,
  });
  // Deterministic ledger guard OUTSIDE the tiered arbiter: K consecutive
  // observed failures for a decision group → deny without any LLM call.
  const guarded = brainLedger
    ? createLedgerGuardBrainArbiter({
        inner: tiered,
        failureStreakFor: (request) => brainLedger.failureStreakFor(request),
        denyAfter: brainCfg?.ledger?.autoDenyAfterFailures,
      })
    : tiered;
  const brain = new ObservableBrainArbiter(
    new EscalationRoutingBrainArbiter(guarded, brainQueue, () => brainSettings.mode),
    events,
  );
  container.bind(TOKENS.BrainArbiter, () => brain);

  // Decision log for /brain status
  const { brainLog, dispose: disposeBrainLog } = subscribeBrainDecisionLog(events);
  teardownHandlers.push(disposeBrainLog);

  // NOTE: setupHqTelemetry() is called here in cli-main.ts between
  // brain chain and brain monitor. The function continues below.

  // ── Brain Monitor ────────────────────────────────────────────────────────
  const brainMonitor = new BrainMonitor({
    events,
    brain,
    toolFailureStreak: brainCfg?.monitor?.toolFailureStreak,
    errorStormCount: brainCfg?.monitor?.errorStormCount,
    stallMs: brainCfg?.monitor?.stallMs,
    fileChurnThreshold: brainCfg?.monitor?.fileChurnThreshold,
    fileChurnWindowMs: brainCfg?.monitor?.fileChurnWindowMs,
    cooldownMs: brainCfg?.monitor?.cooldownMs,
    sessionId: () => context.session?.id ?? session.id,
    intervene: async ({ subject, body }: { subject: string; body: string }) => {
      const leaderUniqueId = `leader@${mailboxSessionTag(session.id)}`;
      await brainMailbox.send({
        from: `brain@${mailboxSessionTag(session.id)}`,
        to: leaderUniqueId,
        type: 'steer',
        subject,
        body,
        priority: 'high',
      });
    },
  });
  brainMonitor.start();
  teardownHandlers.push(() => brainMonitor.stop());
  teardownHandlers.push(() => brainQueue.dispose());

  // ── Shadow controller ────────────────────────────────────────────────────
  let shadowDefaults: { intervalMs?: number; provider?: string; model?: string } = {};
  const shadowController = {
    activeId: null as string | null,
    register(id: string) {
      this.activeId = id;
    },
    clear() {
      this.activeId = null;
    },
    getDefaults() {
      return { ...shadowDefaults };
    },
    setDefaults(defaults: { intervalMs?: number; provider?: string; model?: string }) {
      shadowDefaults = { ...shadowDefaults, ...defaults };
    },
  };

  // ── MultiAgentHost ───────────────────────────────────────────────────────
  const multiAgentHost = new MultiAgentHost(
    {
      container,
      toolRegistry,
      providerRegistry,
      configStore,
      modelsRegistry,
      events,
      systemPromptBuilder: promptBuilder,
      session,
      tokenCounter,
      projectRoot,
      cwd,
      secretScrubber: container.resolve(TOKENS.SecretScrubber),
    },
    {
      directorMode,
      manifestPath,
      sharedScratchpadPath,
      sessionsRoot: subagentSessionsRoot,
      directorRunId: session.id,
      fleetRoot: fleetRootForPromotion,
      stateCheckpointPath,
      sessionWriter: session,
      ...(config.fleet?.budget
        ? {
            directorBudget: {
              maxTokens: config.fleet.budget.maxTokens,
              maxCostUsd: config.fleet.budget.maxCostUsd,
            },
          }
        : {}),
      maxSpawns: config.fleet?.budget?.maxSpawns,
      maxConcurrent,
      getLeaderMaxContext: () => effectiveMaxContextRef.current,
      brain,
      agentMonitor,
      traceId: sessResult.traceId,
      onShadowAgentStarted: (subagentId: string) => shadowController.register(subagentId),
      onShadowAgentStopped: (subagentId: string) => {
        if (shadowController.activeId === subagentId) shadowController.clear();
      },
    },
  );

  // Delegate tool is only exposed when Director mode is active. With Director
  // off, subagent/fleet work requires an explicit `/director` promotion first.
  if (directorMode) {
    toolRegistry.register(
      createDelegateTool({
        host: multiAgentHost,
        roster: FLEET_ROSTER,
        sessionsRoot: subagentSessionsRoot,
        directorRunId: session.id,
        events,
      }),
    );
  }

  // mcp_control tool
  toolRegistry.register(
    createMcpControlTool({
      getConfig: () => configStore.get(),
      configPath: wpaths.globalConfig,
      registry: mcpRegistry,
    }),
  );

  // mcp_use tool — meta-tool for token-saving mode
  if (config.features.tokenSavingMode) {
    toolRegistry.register(
      createMcpUseTool({
        registry: mcpRegistry,
        toolRegistry,
      }),
    );
  }

  return {
    brain,
    brainLog,
    brainSettings,
    brainQueue,
    multiAgentHost,
    shadowController,
    shadowDefaults,
  };
}
