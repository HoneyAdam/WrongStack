/**
 * Post-context backend service construction for the standalone WebUI server.
 *
 * Phase 1c of the god-module split (issue: God-modules >1500 lines).
 * `startWebUI` previously inlined ~400 lines of construction that runs
 * AFTER `context` exists: the agent pipelines + collab middleware, the
 * strategy compactor + auto-compaction middleware, the tool executor +
 * agent, the tiered Brain + monitor, and the per-feature WebSocket
 * handlers (AutoPhase, specs, SDD board/wizard, worktree, terminal, collab).
 *
 * All of that moves into `createAgentServices()`. The pre-context
 * registries/stores (modelsRegistry, container, toolRegistry, session,
 * tokenCounter, …) stay in `startWebUI` because they are interleaved with
 * the `opts.services?` injection contract the CLI's embedded server
 * relies on; lifting them would restructure that contract, which is a
 * separate, higher-risk task.
 *
 * The factory is pure construction — no behaviour change. It returns a
 * typed `AgentServices` object plus the `updateAutoCompactionMaxContext`
 * closure (which needs the live `context`, `autoCompactor`, and
 * `modelCapabilitiesRef` it just built).
 */
import { join } from 'node:path';
import type {
  AutoCompactionMiddleware,
  BrainAutoRisk,
  CollaborationBus,
  Compactor,
  Context,
  MemoryStore,
  DefaultModeStore,
  EventBus,
  Logger,
  ModelsRegistry,
  ObservableBrainArbiter,
  PermissionPolicy,
  Provider,
  ProviderRegistry,
  SessionStore,
  SkillInstaller,
  SkillLoader,
  ToolRegistry,
  AgentPipelines,
  Container,
  SessionReader,
} from '@wrongstack/core';
import type { DefaultTokenCounter } from '@wrongstack/core/infrastructure';
/** Session shape returned by `SessionStore.create()`. */
type Session = Awaited<ReturnType<SessionStore['create']>>;
import {
  Agent,
  AutoCompactionMiddleware as AutoCompactionMiddlewareCtor,
  BrainMonitor,
  CollaborationBus as CollaborationBusCtor,
  DEFAULT_TOOLS_CONFIG,
  createStrategyCompactor,
  collabInjectMiddleware,
  collabPauseMiddleware,
  estimateRequestTokensCalibrated,
  installDesignStudioMiddleware,
  ObservableBrainArbiter as ObservableBrainArbiterCtor,
  resolveContextWindowPolicy,
  BrainDecisionLedger,
  createBrainRuntime,
  type BrainRuntime,
  resolveBrainConfigDefaults,
  EscalationRoutingBrainArbiter,
  GlobalMailbox,
  mailboxSessionTag,
  SessionMemoryConsolidator,
  TOKENS,
  ToolExecutor,
  type AnnotationsStore,
} from '@wrongstack/core';
import type { MCPRegistry } from '@wrongstack/mcp';
import { AutoPhaseWebSocketHandler } from './autophase-ws-handler.js';
import { CollaborationWebSocketHandler } from './collaboration-ws-handler.js';
import { setupWebUICodebaseIndexing } from './codebase-indexing.js';
import { discoverMailboxBridgeForWebui } from './discover-mailbox-bridge.js';
import { SddBoardWebSocketHandler } from './sdd-board-ws-handler.js';
import { SddWizardWebSocketHandler } from './sdd-wizard-ws-handler.js';
import { SpecsWebSocketHandler } from './specs-ws-handler.js';
import { TerminalWebSocketHandler } from './terminal-ws-handler.js';
import { WorktreeWebSocketHandler } from './worktree-ws-handler.js';
import { buildSddWizardDeps } from './sdd-wizard-wiring.js';
import { resolveProviderModelMetadata } from './model-catalog.js';
import { makeLightSubagentFactory } from '@wrongstack/runtime';
import {
  createSuperMemoryToolCallMiddleware,
  createSuperMemoryTurnMiddleware,
  type SuperMemoryRetrieverLike,
} from '@wrongstack/super-memory';
import type { Config, ProviderConfig } from '@wrongstack/core/types';
import type { WstackPaths } from '@wrongstack/core/utils';
import { toErrorMessage } from '@wrongstack/core/utils';

export interface AgentServicesInput {
  config: Config;
  wpaths: WstackPaths;
  logger: Logger;
  projectRoot: string;
  workingDir: string;
  /** Pre-context services (built in startWebUI with opts.services injection). */
  context: Context;
  provider: Provider;
  container: Container;
  toolRegistry: ToolRegistry;
  providerRegistry: ProviderRegistry;
  modelsRegistry: ModelsRegistry;
  events: EventBus;
  mcpRegistry: MCPRegistry;
  memoryStore: MemoryStore;
  modeStore: DefaultModeStore;
  customModeStore: import('./custom-context-modes.js').CustomModeStore;
  skillLoader: SkillLoader | undefined;
  skillInstaller: SkillInstaller | undefined;
  tokenCounter: DefaultTokenCounter;
  pipelines: AgentPipelines;
  /** Mutable capabilities ref — the factory populates `.current`. */
  modelCapabilitiesRef: { current: unknown };
  /** Returns the LIVE session (swapped on /new + resume) — read at send time. */
  sessionGetter: () => Session;
  /** Read-only session reader (collab replay-on-join). */
  sessionReader: SessionReader;
  /** Annotations store (collab notes). */
  annotationsStore: AnnotationsStore;
  /**
   * Persist the canonical `config.brain` to the GLOBAL config (serialized
   * behind startWebUI's config write lock). Absent = Brain edits are
   * live-only.
   */
  persistBrainConfig?: ((config: import('@wrongstack/core/types').BrainConfig) => Promise<void>) | undefined;
}

export interface AgentServices {
  collabBus: CollaborationBus;
  compactor: Compactor;
  autoCompactor: AutoCompactionMiddleware | undefined;
  toolExecutor: ToolExecutor;
  agent: Agent;
  permissionPolicy: PermissionPolicy;
  pipelines: AgentPipelines;
  brain: ObservableBrainArbiter;
  brainSettings: { maxAutoRisk: BrainAutoRisk };
  /** Live-editable Brain config owner (brain.config.get/set routes). */
  brainRuntime: BrainRuntime;
  brainLog: Array<{ at: number; kind: string; question: string; outcome: string }>;
  brainMonitor: BrainMonitor;
  /** LIVE persistent decision ledger (undefined when disabled). Read via the
   *  services object at shutdown — ledger toggles swap the instance. */
  brainLedger: BrainDecisionLedger | undefined;
  codebaseIndexing: { onFileWritten(filePath: string): void; dispose(): void };
  autoPhaseHandler: AutoPhaseWebSocketHandler;
  specsHandler: SpecsWebSocketHandler;
  sddBoardHandler: SddBoardWebSocketHandler;
  sddWizardHandler: SddWizardWebSocketHandler;
  worktreeHandler: WorktreeWebSocketHandler;
  terminalHandler: TerminalWebSocketHandler;
  collabHandler: CollaborationWebSocketHandler;
  /** Refresh auto-compaction denominator on model switch. */
  updateAutoCompactionMaxContext: (
    newProvider: Provider,
    providerId?: string,
    providerCfg?: ProviderConfig | undefined,
  ) => Promise<void>;
}

/**
 * Build the post-context agent services: pipelines + middleware, compaction,
 * tool executor + agent, Brain, and the per-feature WebSocket handlers.
 *
 * Returns everything `startWebUI` needs to wire routes + the dispatcher.
 * The `updateAutoCompactionMaxContext` closure captures the live
 * `autoCompactor` / `modelCapabilitiesRef` it built.
 */
export async function createAgentServices(input: AgentServicesInput): Promise<AgentServices> {
  const {
    config,
    wpaths,
    logger,
    projectRoot,
    workingDir,
    context,
    provider,
    container,
    toolRegistry,
    providerRegistry,
    modelsRegistry,
    events,
    memoryStore,
    modelCapabilitiesRef,
  } = input;

  // Collaboration bus — process-singleton pause/resume signal. The
  // middleware below hooks it into the toolCall pipeline so a
  // `controller` participant can halt the agent before the next tool
  // call (Phase 3 of idea #13). The same bus instance is shared with
  // the CollaborationWebSocketHandler so client pause/resume requests
  // are routed to the kernel.
  const collabBus = new CollaborationBusCtor();
  const pipelines = input.pipelines;
  // Phase 4 — collab-inject. Install it first, then prepend collab-pause
  // ahead of it so a controller can pause + inject before the next tool result
  // flows through the pipeline.
  const collabInject = collabInjectMiddleware(collabBus, { logger });
  pipelines.toolCall.prepend(collabInject);
  const collabPause = collabPauseMiddleware(collabBus, { logger });
  pipelines.toolCall.prepend(collabPause);
  // Design Studio — per-turn UI-intent detection + kit-menu injection.
  installDesignStudioMiddleware({ pipelines, ctx: context });
  if (
    config.features.memory !== false
    && config.superMemory?.enabled !== false
    && isSuperMemoryRetriever(memoryStore)
  ) {
    if (config.superMemory?.inject?.toolResults !== false) {
      pipelines.toolCall.use(createSuperMemoryToolCallMiddleware({
        memory: memoryStore,
        maxHintsPerTool: config.superMemory?.inject?.maxHintsPerTool,
        maxCharsPerTool: config.superMemory?.inject?.maxCharsPerTool,
        minScore: config.superMemory?.inject?.minScore,
        repeatCooldownMs: config.superMemory?.inject?.repeatCooldownMs,
        verifyOnMutation: config.superMemory?.hygiene?.autoOnFileChange,
        triggers: config.superMemory?.inject?.triggers,
      }));
    }
    if (config.superMemory?.inject?.turnContext !== false) {
      pipelines.request.use(createSuperMemoryTurnMiddleware({
        memory: memoryStore,
        maxMemories: config.superMemory?.inject?.maxTurnMemories,
        maxChars: config.superMemory?.inject?.maxCharsPerTurn,
        minScore: config.superMemory?.inject?.minScore,
      }));
    }
  }
  const codebaseIndexing = setupWebUICodebaseIndexing({
    config,
    context,
    projectRoot,
    logger,
    events,
  });
  // Compactor — honors config.context.strategy ('hybrid' default, lossless
  // rules; 'intelligent'/'selective' resolve their provider from ctx at
  // compact()-time). eliseThreshold is a TOKEN COUNT (not a fraction).
  const compactor = createStrategyCompactor({
    strategy: config.context?.strategy,
    preserveK: config.context?.preserveK ?? 10,
    eliseThreshold: config.context?.eliseThreshold ?? 2000,
    summarizerModel: config.context?.summarizerModel,
    llmSelector: config.context?.llmSelector,
  });

  const initialContextPolicy = resolveContextWindowPolicy(config.context);
  // Auto-compaction
  let autoCompactor: AutoCompactionMiddleware | undefined;
  if (config.context?.autoCompact !== false) {
    let effectiveMaxContext = config.context?.effectiveMaxContext ?? 0;
    if (!effectiveMaxContext) {
      try {
        const m = await resolveProviderModelMetadata(
          modelsRegistry,
          config.provider,
          context.model,
          config.providers?.[config.provider],
        );
        effectiveMaxContext = m?.capabilities?.maxContext ?? 0;
      } catch {
        // best-effort: fall through to provider capability
      }
    }
    if (!effectiveMaxContext) effectiveMaxContext = provider.capabilities.maxContext;
    autoCompactor = new AutoCompactionMiddlewareCtor(
      compactor,
      effectiveMaxContext,
      (ctx) =>
        estimateRequestTokensCalibrated(
          ctx.messages,
          ctx.systemPrompt,
          ctx.tools ?? [],
          `${ctx.provider?.id ?? 'unknown'}/${ctx.model}`,
        ).total,
      {
        warn: initialContextPolicy.thresholds.warn,
        soft: initialContextPolicy.thresholds.soft,
        hard: initialContextPolicy.thresholds.hard,
      },
      {
        events,
        aggressiveOn: initialContextPolicy.aggressiveOn,
        policyProvider: (ctx) => {
          const policy = ctx.meta['contextWindowPolicy'];
          return policy && typeof policy === 'object'
            ? (policy as ReturnType<typeof resolveContextWindowPolicy>)
            : initialContextPolicy;
        },
      },
    );
    pipelines.contextWindow.use({ name: 'AutoCompaction', handler: autoCompactor.handler() });
  }

  /** Refresh AutoCompactionMiddleware denominator when the active model changes. */
  const updateAutoCompactionMaxContext = async (
    newProvider: Provider,
    providerId = newProvider.id,
    providerCfg?: ProviderConfig | undefined,
  ): Promise<void> => {
    await modelsRegistry.refresh().catch((err) => {
      logger.warn(
        `models.dev refresh failed for ${providerId}/${context.model}: ${toErrorMessage(err)}; using cached catalog`,
      );
    });
    const currentConfig = input.config;
    let newMaxContext = currentConfig.context?.effectiveMaxContext ?? newProvider.capabilities.maxContext;
    try {
      const m = await resolveProviderModelMetadata(
        modelsRegistry,
        providerId,
        context.model,
        providerCfg ?? currentConfig.providers?.[providerId],
      );
      newMaxContext = m?.capabilities?.maxContext ?? newMaxContext;
    } catch {
      // best-effort: use provider capability
    }
    newProvider.capabilities.maxContext = newMaxContext;
    modelCapabilitiesRef.current =
      newMaxContext > 0
        ? {
            maxContextTokens: newMaxContext,
            supportsTools: !!newProvider.capabilities.tools,
            supportsVision: !!newProvider.capabilities.vision,
            supportsReasoning: !!newProvider.capabilities.reasoning,
          }
        : undefined;
    if (newMaxContext > 0) {
      context.meta['effectiveMaxContext'] = newMaxContext;
      autoCompactor?.setMaxContext(newMaxContext);
      autoCompactor?.setEnabled(config.context?.autoCompact !== false);
    } else {
      delete context.meta['effectiveMaxContext'];
      autoCompactor?.setEnabled(false);
    }
    events.emit('ctx.max_context', {
      sessionId: context.session.id,
      providerId: newProvider.id,
      modelId: context.model,
      maxContext: newMaxContext,
    });
  };

  // Agent
  const secretScrubber = container.resolve(TOKENS.SecretScrubber);
  const renderer = container.has(TOKENS.Renderer) ? container.resolve(TOKENS.Renderer) : undefined;
  const permissionPolicy = container.resolve(TOKENS.PermissionPolicy);
  const toolExecutor = new ToolExecutor(toolRegistry, {
    permissionPolicy,
    secretScrubber,
    renderer,
    events,
    confirmAwaiter: undefined,
    iterationTimeoutMs: config.tools?.iterationTimeoutMs ?? DEFAULT_TOOLS_CONFIG.iterationTimeoutMs,
    perIterationOutputCapBytes:
      config.tools?.perIterationOutputCapBytes ?? DEFAULT_TOOLS_CONFIG.perIterationOutputCapBytes,
    tracer: undefined,
  });

  // Mailbox bridge discovery — fire-and-forget. Best-effort: a failed
  // discovery never blocks the WebUI from starting.
  const webuiLogger = container.resolve(TOKENS.Logger);
  void discoverMailboxBridgeForWebui({
    projectRoot,
    config,
    logger: webuiLogger,
    ctx: context,
  }).catch((err: unknown) => {
    webuiLogger.warn('mailbox bridge discovery threw on webui boot', {
      err: err instanceof Error ? err.message : String(err),
    });
  });

  const agent = new Agent({
    container,
    tools: toolRegistry,
    providers: providerRegistry,
    events,
    pipelines,
    context,
    maxIterations: config.tools?.maxIterations ?? DEFAULT_TOOLS_CONFIG.maxIterations,
    iterationTimeoutMs: config.tools?.iterationTimeoutMs ?? DEFAULT_TOOLS_CONFIG.iterationTimeoutMs,
    executionStrategy:
      config.tools?.defaultExecutionStrategy ?? DEFAULT_TOOLS_CONFIG.defaultExecutionStrategy,
    perIterationOutputCapBytes:
      config.tools?.perIterationOutputCapBytes ?? DEFAULT_TOOLS_CONFIG.perIterationOutputCapBytes,
    loopDetection: config.tools?.loopDetection ?? DEFAULT_TOOLS_CONFIG.loopDetection,
    confirmAwaiter: undefined,
    toolExecutor,
  });
  if (config.features.memory && config.features.memoryConsolidation !== false) {
    agent.extensions.register(new SessionMemoryConsolidator({ memoryStore }));
  }
  console.log('[WebUI] Agent initialized');

  // ── Brain — policy → LLM/council → terminal-policy decision layer ──────
  // The standalone WebUI has no blocking human prompt surface, so the
  // escalation tier always resolves through the terminal policy (safe
  // default or deny) — the Brain never returns a dangling `ask_human`.
  // The whole `config.brain` surface is owned by a BrainRuntime: the
  // brain.config.set route live-rebuilds the tiers AND persists globally
  // (config.brain is on the in-project deny list).
  // Product defaults (minimum-human): pool seeded from fallbackModels,
  // adaptive risk ceiling. Explicit config.brain fields always win.
  const brainCfg = resolveBrainConfigDefaults(config.brain, {
    fallbackModels: config.fallbackModels,
  });
  const brainLedgerPath = join(wpaths.projectDir, 'brain-ledger.jsonl');
  let brainLedgerEnabled = brainCfg.ledger?.enabled !== false;
  let brainLedger: BrainDecisionLedger | undefined;
  const startBrainLedger = (): void => {
    if (brainLedger) return;
    brainLedger = new BrainDecisionLedger({ events, filePath: brainLedgerPath });
    void brainLedger.start();
  };
  if (brainLedgerEnabled) startBrainLedger();
  const brainRuntime = createBrainRuntime({
    initialConfig: brainCfg,
    defaultProviderId: config.provider,
    sessionProvider: () => provider,
    sessionModel: () => context.model,
    resolveProvider: (providerId) => {
      const savedCfg: Partial<import('@wrongstack/core').ProviderConfig> =
        config.providers?.[providerId] ?? {};
      return providerRegistry.create({
        ...savedCfg,
        apiKey: savedCfg.apiKey ?? config.apiKey,
        baseUrl: savedCfg.baseUrl ?? config.baseUrl,
        type: providerId,
      } as never);
    },
    ledger: {
      getPath: () => (brainLedgerEnabled ? brainLedgerPath : undefined),
      isEnabled: () => brainLedgerEnabled,
      setEnabled: (on) => {
        brainLedgerEnabled = on;
        if (on) {
          startBrainLedger();
        } else {
          void brainLedger?.stop();
          brainLedger = undefined;
        }
      },
      failureStreakFor: (request) => brainLedger?.failureStreakFor(request) ?? 0,
      getDecisionDigest: (request) => brainLedger?.digestFor(request),
    },
    persist: input.persistBrainConfig,
  });
  // Back-compat facade for the risk-only route: assignment routes through
  // runtime.apply(), which live-applies AND persists.
  const brainSettings: { maxAutoRisk: BrainAutoRisk } = {
    get maxAutoRisk() {
      return brainRuntime.getMaxAutoRisk();
    },
    set maxAutoRisk(level: BrainAutoRisk) {
      void brainRuntime.apply({ maxAutoRisk: level }).persisted;
    },
  };
  const brain = new ObservableBrainArbiterCtor(
    new EscalationRoutingBrainArbiter(brainRuntime.arbiter, undefined, () => 'headless'),
    events,
  );
  container.bind(TOKENS.BrainArbiter, () => brain);

  // Decision log for the /brain command — last 20 decisions, newest last.
  const brainLog: Array<{ at: number; kind: string; question: string; outcome: string }> = [];
  const pushBrainLog = (entry: (typeof brainLog)[number]) => {
    brainLog.push(entry);
    if (brainLog.length > 20) brainLog.shift();
  };
  events.on('brain.decision_answered', (e) =>
    pushBrainLog({
      at: e.at,
      kind: 'answered',
      question: e.request.question,
      outcome: e.decision.type === 'answer' ? (e.decision.optionId ?? e.decision.text) : '',
    }),
  );
  events.on('brain.decision_ask_human', (e) =>
    pushBrainLog({
      at: e.at,
      kind: 'ask_human',
      question: e.request.question,
      outcome: 'needs human judgement',
    }),
  );
  events.on('brain.decision_denied', (e) =>
    pushBrainLog({
      at: e.at,
      kind: 'denied',
      question: e.request.question,
      outcome: e.decision.type === 'deny' ? e.decision.reason : '',
    }),
  );

  // Self-activation: watch for tool-failure streaks / error storms. `session`
  // is read at send time via the getter the caller passes, so the steer
  // always targets the LIVE session's leader identity.
  const brainMailbox = new GlobalMailbox(wpaths.projectDir, events);
  const brainMonitor = new BrainMonitor({
    events,
    brain,
    toolFailureStreak: brainCfg.monitor?.toolFailureStreak,
    errorStormCount: brainCfg.monitor?.errorStormCount,
    stallMs: brainCfg.monitor?.stallMs,
    fileChurnThreshold: brainCfg.monitor?.fileChurnThreshold,
    fileChurnWindowMs: brainCfg.monitor?.fileChurnWindowMs,
    cooldownMs: brainCfg.monitor?.cooldownMs,
    sessionId: () => context.session?.id,
    intervene: async ({ subject, body }) => {
      const tag = mailboxSessionTag(input.sessionGetter().id);
      await brainMailbox.send({
        from: `brain@${tag}`,
        to: `leader@${tag}`,
        type: 'steer',
        subject,
        body,
        priority: 'high',
      });
    },
  });
  brainMonitor.start();
  console.log('[WebUI] Brain initialized (tiered policy → LLM, monitor active)');

  // Per-feature WebSocket handlers.
  const autoPhaseHandler = new AutoPhaseWebSocketHandler(
    agent,
    context,
    logger,
    wpaths.projectAutophase,
    events,
    projectRoot,
  );
  const specsHandler = new SpecsWebSocketHandler(wpaths.projectSpecs, wpaths.projectTaskGraphs);
  const sddBoardHandler = new SddBoardWebSocketHandler(wpaths.projectSddBoards, undefined, {
    projectRoot,
    paths: {
      projectSpecs: wpaths.projectSpecs,
      projectTaskGraphs: wpaths.projectTaskGraphs,
      projectSddSession: wpaths.projectSddSession,
      projectSddBoards: wpaths.projectSddBoards,
    },
  });
  const sddWizardHandler = new SddWizardWebSocketHandler(
    buildSddWizardDeps({
      agent,
      events,
      projectRoot,
      brain,
      subagentFactory: makeLightSubagentFactory({
        container,
        providerRegistry,
        toolRegistry,
        session: input.sessionGetter(),
        projectRoot,
      }),
      paths: {
        projectSpecs: wpaths.projectSpecs,
        projectTaskGraphs: wpaths.projectTaskGraphs,
        projectSddBoards: wpaths.projectSddBoards,
        projectDir: wpaths.projectDir,
      },
    }),
  );
  const worktreeHandler = new WorktreeWebSocketHandler(events, logger, {
    projectRoot,
    boardsDir: wpaths.projectSddBoards,
  });
  const terminalHandler = new TerminalWebSocketHandler(() => workingDir, logger);
  const collabHandler = new CollaborationWebSocketHandler(
    events,
    logger,
    input.sessionReader,
    input.annotationsStore,
    collabBus,
    {
      getActiveSessionId: () => context.session.id,
    },
  );

  return {
    collabBus,
    compactor,
    autoCompactor,
    toolExecutor,
    agent,
    permissionPolicy,
    pipelines,
    brain,
    brainSettings,
    brainRuntime,
    brainLog,
    brainMonitor,
    // Getter: ledger toggles swap the instance, shutdown must stop the LIVE one.
    get brainLedger() {
      return brainLedger;
    },
    codebaseIndexing,
    autoPhaseHandler,
    specsHandler,
    sddBoardHandler,
    sddWizardHandler,
    worktreeHandler,
    terminalHandler,
    collabHandler,
    updateAutoCompactionMaxContext,
  };
}

function isSuperMemoryRetriever(memoryStore: MemoryStore): memoryStore is MemoryStore & SuperMemoryRetrieverLike {
  const value = memoryStore as unknown as Record<string, unknown>;
  return typeof value['retrieveForPath'] === 'function'
    && typeof value['searchSuper'] === 'function';
}
