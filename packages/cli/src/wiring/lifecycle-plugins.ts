import {
  allServers,
  type Config,
  countShellHooks,
  GlobalMailbox,
  type HealthRegistry,
  HookRegistry,
  HookRunner,
  type Logger,
  type ModelsRegistry,
  type MetricsRuntimeStatus,
  normalizeTokenSavingTier,
  type Provider,
  type ProviderConfig,
  type ProviderRegistry,
  type SecretVault,
  type SessionWriter,
  SlashCommandRegistry,
  shellHooksEqual,
  TOKENS,
  type ToolRegistry,
  type WstackPaths,
} from '@wrongstack/core';
import { MCPRegistry } from '@wrongstack/mcp';
import { refreshRuntimeModelCatalog, resolveRuntimeMaxContext } from '../context-limit.js';
import {
  createLifecycleHooksExtension,
  createUserPromptSubmitMiddleware,
} from '../hooks-wiring.js';
import { makeConfirmAwaiter } from '../permission-prompt.js';
import { installDesignStudio } from './design-studio.js';
import { registerMcpObservability } from './metrics.js';
import { createAgent, setupCompaction } from './pipeline.js';
import { setupPlugins } from './plugins.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: large dependency bag — exact types add no safety here
type AnyRecord = Record<string, any>;

export interface LifecyclePluginsDeps {
  flags: Record<string, string | boolean>;
  config: Config;
  // biome-ignore lint/suspicious/noExplicitAny: DI container shape
  container: any;
  // biome-ignore lint/suspicious/noExplicitAny: pipeline shape
  pipelines: any;
  logger: Logger;
  session: SessionWriter;
  sessionBridge: any;
  // biome-ignore lint/suspicious/noExplicitAny: event bus
  events: any;
  modelsRegistry: ModelsRegistry;
  // biome-ignore lint/suspicious/noExplicitAny: context shape
  context: any;
  provider: Provider;
  // biome-ignore lint/suspicious/noExplicitAny: ref
  modelCapabilitiesRef: AnyRecord;
  // biome-ignore lint/suspicious/noExplicitAny: reader
  reader: any;
  wpaths: WstackPaths;
  toolRegistry: ToolRegistry;
  providerRegistry: ProviderRegistry;
  // biome-ignore lint/suspicious/noExplicitAny: config store
  configStore: any;
  eventWiring: any;
  healthRegistry: HealthRegistry;
  // biome-ignore lint/suspicious/noExplicitAny: optional loaders
  skillLoader: any;
  promptLoader: any;
  vault: SecretVault;
  // biome-ignore lint/suspicious/noExplicitAny: metrics sink
  metricsSink: any;
  metricsStatus?: MetricsRuntimeStatus | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: renderer
  renderer: any;
  // biome-ignore lint/suspicious/noExplicitAny: import
  buildProviderForIdRuntime: any;
}

export interface LifecyclePluginsResult {
  hookRegistry: HookRegistry;
  hookRunner: HookRunner;
  // biome-ignore lint/suspicious/noExplicitAny: auto-compactor
  autoCompactor: any;
  effectiveMaxContextRef: { current: number };
  applyMaxContext: (providerId: string, modelId: string, mc: number, seq?: number) => void;
  refreshMaxContext: (
    providerId: string,
    modelId: string,
    runtimeProviderConfig?: ProviderConfig,
  ) => Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: agent
  agent: any;
  mcpRegistry: MCPRegistry;
  slashRegistry: SlashCommandRegistry;
  hqPublisherRef: { current: any };
  brainMailbox: GlobalMailbox;
}

/**
 * Wire lifecycle hooks, compaction + max-context management, agent creation,
 * MCP servers, slash-registry, project mailbox, and plugins setup.
 *
 * Returns a result bag; the returned closures capture `effectiveMaxContext`
 * and `autoCompactor` internally so the caller can invoke `applyMaxContext`
 * / `refreshMaxContext` without needing those internals.
 */
export async function setupLifecycleAndPlugins(
  deps: LifecyclePluginsDeps,
): Promise<LifecyclePluginsResult> {
  const {
    flags,
    config,
    container,
    pipelines,
    logger,
    session,
    events,
    modelsRegistry,
    context,
    provider,
    modelCapabilitiesRef,
    reader,
    wpaths,
    toolRegistry,
    providerRegistry,
    configStore,
    sessionBridge,
    eventWiring,
    healthRegistry,
    skillLoader,
    promptLoader,
    vault,
    metricsSink,
    metricsStatus,
    buildProviderForIdRuntime: buildProviderForIdRuntimeFn,
  } = deps;

  // ── Lifecycle hooks ──────────────────────────────────────────────────────
  const hooksEnabled = flags['no-hooks'] !== true;
  const hookRegistry = new HookRegistry();
  // `--no-hooks` disables ordinary automation, not trusted enforcement.
  // Explicit `policy: true` hooks remain active and never ask for approval;
  // they only allow/mutate silently or deny with a model-visible reason.
  hookRegistry.loadShellHooks(config.hooks, { policyOnly: !hooksEnabled });
  container.bind(TOKENS.HookRegistry, () => hookRegistry);
  const hookRunner = new HookRunner({
    registry: hookRegistry,
    logger,
    allowNonPolicy: hooksEnabled,
    sessionId: () => session.id,
  });
  // Install the dispatch points even under --no-hooks: ordinary entries are
  // filtered by HookRunner, while policy hooks may be registered later by a
  // plugin and still need a live UserPromptSubmit interception point.
  pipelines.userInput.use(createUserPromptSubmitMiddleware(hookRunner));

  // Hot-reload configured hooks, preserving the --no-hooks policy filter.
  configStore.watch((next: Config, prev: Config) => {
    if (!shellHooksEqual(next.hooks, prev.hooks)) {
      try {
        hookRegistry.replaceShellHooks(next.hooks, { policyOnly: !hooksEnabled });
        logger.info(
          `Hooks reloaded (${countShellHooks(next.hooks)} configured entries across ${
            Object.keys(next.hooks ?? {}).length
          } events)`,
        );
      } catch (err) {
        logger.warn(`Hook hot-reload failed: ${(err as Error).message ?? String(err)}`);
      }
    }
  });

  // Design Studio — per-turn UI-intent detection + kit-menu injection.
  installDesignStudio({ pipelines, context });

  // ── Compaction + max context ─────────────────────────────────────────────
  const compactor = container.resolve(TOKENS.Compactor);
  const compactionSetup = await setupCompaction({
    compactor,
    events,
    modelsRegistry,
    context,
    config,
    provider,
    pipelines,
    fullConfig: config as never,
    sessionBridge,
  });
  const effectiveMaxContextRef = { current: compactionSetup.effectiveMaxContext };
  context.provider.capabilities.maxContext = effectiveMaxContextRef.current;
  modelCapabilitiesRef.current =
    effectiveMaxContextRef.current > 0
      ? {
          maxContextTokens: effectiveMaxContextRef.current,
          supportsTools: !!context.provider.capabilities.tools,
          supportsVision: !!context.provider.capabilities.vision,
          supportsReasoning: !!context.provider.capabilities.reasoning,
        }
      : undefined;
  const { autoCompactor } = compactionSetup;

  let maxContextRefreshSeq = 0;
  const applyMaxContext = (
    providerId: string,
    modelId: string,
    mc: number,
    seq?: number | undefined,
  ): void => {
    if (seq !== undefined && seq !== maxContextRefreshSeq) return;
    effectiveMaxContextRef.current = mc;
    context.provider.capabilities.maxContext = effectiveMaxContextRef.current;
    modelCapabilitiesRef.current =
      effectiveMaxContextRef.current > 0
        ? {
            maxContextTokens: effectiveMaxContextRef.current,
            supportsTools: !!context.provider.capabilities.tools,
            supportsVision: !!context.provider.capabilities.vision,
            supportsReasoning: !!context.provider.capabilities.reasoning,
          }
        : undefined;
    if (effectiveMaxContextRef.current > 0) {
      context.meta['effectiveMaxContext'] = effectiveMaxContextRef.current;
      autoCompactor?.setMaxContext(effectiveMaxContextRef.current);
      autoCompactor?.setEnabled(config.context.autoCompact !== false);
    } else {
      // biome-ignore lint/performance/noDelete: intentional property removal
      delete context.meta['effectiveMaxContext'];
      autoCompactor?.setEnabled(false);
    }
    events.emit('ctx.max_context', {
      sessionId: context.session.id,
      providerId,
      modelId,
      maxContext: effectiveMaxContextRef.current,
    });
    eventWiring.setEffectiveMaxContext(effectiveMaxContextRef.current);
  };

  const refreshMaxContext = async (
    providerId: string,
    modelId: string,
    runtimeProviderConfig?: ProviderConfig | undefined,
  ): Promise<void> => {
    const seq = ++maxContextRefreshSeq;
    const resolveAndApply = async (): Promise<void> => {
      const mc = await resolveRuntimeMaxContext({
        modelsRegistry,
        config,
        provider: context.provider,
        runtimeProviderConfig,
        providerId,
        modelId,
      });
      applyMaxContext(providerId, modelId, mc, seq);
    };
    await resolveAndApply();
    const refreshed = await refreshRuntimeModelCatalog({
      modelsRegistry,
      logger,
      reason: `${providerId}/${modelId}`,
    });
    if (refreshed) await resolveAndApply();
  };

  // ── Agent ────────────────────────────────────────────────────────────────
  const agent = createAgent({
    container,
    tools: toolRegistry,
    providers: providerRegistry,
    events,
    pipelines,
    context,
    config,
    confirmAwaiter: makeConfirmAwaiter(reader),
    hookRunner,
    fullConfig: config,
    source: 'cli',
  });

  // Same late-registration rule for plugin SessionStart/Stop policy hooks.
  agent.extensions.register(createLifecycleHooksExtension(hookRunner));

  // ── MCP servers ──────────────────────────────────────────────────────────
  const mcpRegistry = new MCPRegistry({
    toolRegistry,
    events,
    log: logger,
    lazyMode: normalizeTokenSavingTier(config.features.tokenSavingMode) !== 'off',
    cacheDir: wpaths.cacheDir,
  });
  if (config.features.mcp) {
    const presets = allServers();
    for (const cfg of Object.values(config.mcpServers ?? {})) {
      const preset = (presets as any)[(cfg as any).name];
      const merged = preset ? { ...preset, ...(cfg as any) } : cfg;
      try {
        await (mcpRegistry as any).start(merged);
      } catch (err) {
        logger.warn(`MCP server "${(cfg as any).name}" failed to start`, err);
      }
    }
  }
  registerMcpObservability(healthRegistry, metricsSink, mcpRegistry);

  // ── Slash registry + mailbox + plugins ───────────────────────────────────
  const slashRegistry = new SlashCommandRegistry();
  const hqPublisherRef: { current: any } = { current: undefined };
  const brainMailbox = new GlobalMailbox(wpaths.projectDir, events, () => hqPublisherRef.current);

  await setupPlugins({
    config,
    container,
    events,
    pipelines,
    toolRegistry,
    providerRegistry,
    slashCommandRegistry: slashRegistry,
    mcpRegistry,
    log: logger,
    agent,
    sessionWriter: context.session,
    metricsSink,
    metricsStatus,
    modelsRegistry,
    healthRegistry,
    skillLoader: config.features.skills ? skillLoader : undefined,
    promptLoader: config.features.prompts === false ? undefined : promptLoader,
    configStore,
    vault,
    paths: {
      globalRoot: wpaths.globalRoot,
      globalConfig: wpaths.globalConfig,
      globalSkills: wpaths.globalSkills,
      globalPrompts: wpaths.globalPrompts,
      globalMemory: wpaths.globalMemory,
      historyFile: wpaths.historyFile,
      syncConfig: wpaths.syncConfig,
      projectDir: wpaths.projectDir,
      projectGoal: wpaths.projectGoal,
    },
    hookRegistry,
    mailbox: brainMailbox,
    llm: {
      provider,
      model: config.model,
      createProvider: (name: string) =>
        buildProviderForIdRuntimeFn({ config, providerRegistry }, name),
    },
  });

  return {
    hookRegistry,
    hookRunner,
    autoCompactor,
    effectiveMaxContextRef,
    applyMaxContext,
    refreshMaxContext,
    agent,
    mcpRegistry,
    slashRegistry,
    hqPublisherRef,
    brainMailbox,
  };
}
