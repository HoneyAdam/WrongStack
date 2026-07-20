import {
  type Config,
  Container,
  createStrategyCompactor,
  DefaultConfigStore,
  DefaultErrorHandler,
  FallbackProfileManager,
  DefaultModeStore,
  DefaultPermissionPolicy,
  DefaultPromptLoader,
  DefaultRetryPolicy,
  DefaultSecretScrubber,
  DefaultSessionStore,
  DefaultSkillLoader,
  DefaultSystemPromptBuilder,
  type DefaultSystemPromptBuilderOptions,
  type EventBus,
  type Logger,
  type ModelsRegistry,
  TOKENS,
  type Tool,
  type WstackPaths,
} from '@wrongstack/core';
// PR-C1 (66c4eb68): execution/ and infrastructure/ symbols come from the
// published subpaths now that types/index.ts no longer re-exports them.
import { buildRecoveryStrategies } from '@wrongstack/core/execution';
import { DefaultTokenCounter } from '@wrongstack/core/infrastructure';
import { getSessionRegistry } from '@wrongstack/core/storage';
import { SuperMemoryStore, SqliteSuperMemoryStore, isSqliteAvailable } from '@wrongstack/super-memory';
import type { MemoryStore } from '@wrongstack/core';

export interface CreateContainerOptions {
  config: Config;
  wpaths: WstackPaths;
  logger: Logger;
  modelsRegistry: ModelsRegistry;
  /**
   * Optional event bus — passed to SuperMemoryStore so plugins and
   * subsystems can react to memory mutations in real time.
   */
  events?: EventBus | undefined;
  permission?: {
    yolo?: boolean | undefined;
    promptDelegate?: (
      tool: Tool,
      input: unknown,
      suggestedPattern: string,
    ) => Promise<'yes' | 'no' | 'always' | 'deny'>;
  };
  compactor?: { preserveK?: number | undefined; eliseThreshold?: number | undefined };
  systemPrompt?: Partial<DefaultSystemPromptBuilderOptions> | undefined;
  /** Bundled skills directory path (resolved at boot time). */
  bundledSkillsDir?: string | undefined;
  /** Bundled prompt dataset directory path (`<core>/data/prompts`, resolved at boot). */
  bundledPromptsDir?: string | undefined;
}

/**
 * Create a Container pre-bound with all default service implementations.
 * Both CLI and WebUI use this factory so container wiring stays in one place.
 */
export function createDefaultContainer(opts: CreateContainerOptions): Container {
  const { config, wpaths, logger, modelsRegistry } = opts;
  const container = new Container();

  const configStore = new DefaultConfigStore(config);
  const fallbackProfileManager = new FallbackProfileManager(config);
  configStore.watch((next) => fallbackProfileManager.reload(next as Config));
  container.bind(TOKENS.ConfigStore, () => configStore);
  container.bind(TOKENS.FallbackProfileManager, () => fallbackProfileManager);
  container.bind(TOKENS.Logger, () => logger);
  container.bind(TOKENS.SecretScrubber, () => new DefaultSecretScrubber());
  container.bind(TOKENS.RetryPolicy, () => new DefaultRetryPolicy());
  // Wire the compactor into the recovery chain so a 413 / context-overflow
  // response can shed tokens and retry. Without an explicit compactor the
  // default `context_overflow_reduce` strategy is a no-op. The Compactor
  // binding is resolved lazily (it is registered further below).
  container.bind(
    TOKENS.ErrorHandler,
    () =>
      new DefaultErrorHandler(
        buildRecoveryStrategies({
          compactor: container.resolve(TOKENS.Compactor),
          modelsRegistry,
          getConfig: () => configStore.get(),
        }),
      ),
  );
  container.bind(TOKENS.ModelsRegistry, () => modelsRegistry);
  container.bind(
    TOKENS.TokenCounter,
    () =>
      new DefaultTokenCounter({
        registry: modelsRegistry,
        providerId: config.provider,
        events: opts.events,
      }),
  );

  const modeStore = new DefaultModeStore({ directory: wpaths.configDir });
  container.bind(TOKENS.ModeStore, () => modeStore);
  container.bind(
    TOKENS.SessionStore,
    () =>
      new DefaultSessionStore({
        dir: wpaths.projectSessions,
        projectRoot: wpaths.projectRoot,
        logger,
        // Scrub secrets out of persisted user/model turns (F-06). Tool output
        // is already scrubbed by the executor.
        secretScrubber: container.resolve(TOKENS.SecretScrubber),
        // Cross-process guard consulted by delete(): refuses to remove a
        // session that a LIVE terminal/TUI/WebUI in this project is using.
        // The store also checks active.json directly; this widens the check
        // to every concurrently-running surface (active.json only tracks the
        // latest active session per project).
        isSessionInUse: async (sessionId) => {
          try {
            const registry = getSessionRegistry(wpaths.globalRoot);
            const live = await registry.listByProject(wpaths.projectSlug);
            const hit = live.find((e) => e.sessionId === sessionId);
            if (hit) {
              return `active in ${hit.projectName} (PID ${hit.pid})`;
            }
          } catch {
            // registry unavailable — fall back to the active.json check only
          }
          return null;
        },
      }),
  );

  // Single memory backend: Super Memory is the only store. `superMemory.enabled`
  // no longer swaps the backend — it only gates automatic context injection and
  // session-end hygiene (see wiring/super-memory.ts). This guarantees "one memory
  // system, no other" across TUI, slash commands, agent tools, and WebUI.
  //
  // When `superMemory.storage.engine === 'sqlite'`, the store uses the SQLite
  // backend (indexed + FTS5 search, auto-migrates from JSONL on first open).
  // If node:sqlite is unavailable, falls back to JSONL with a warning.
  // Otherwise the JSONL backend is used.
  const wantSqlite = config.superMemory?.storage?.engine === 'sqlite';
  const useSqlite = wantSqlite && isSqliteAvailable();
  if (wantSqlite && !useSqlite) {
    logger.warn(
      'Super Memory: SQLite engine requested but node:sqlite is unavailable in this runtime. ' +
        'Falling back to JSONL backend. (SQLite requires Node >= 22.5.)',
    );
  }
  const memoryStore = useSqlite
    ? new SqliteSuperMemoryStore({
        projectRoot: wpaths.projectRoot,
        directory: config.superMemory?.storage?.directory,
        events: opts.events,
      })
    : new SuperMemoryStore({
        projectRoot: wpaths.projectRoot,
        directory: config.superMemory?.storage?.directory,
        events: opts.events,
      });
  container.bind(TOKENS.MemoryStore, () => memoryStore as unknown as MemoryStore);

  const skillLoader = new DefaultSkillLoader({
    paths: wpaths,
    bundledDir: opts.bundledSkillsDir,
    readClaudeSkills: config.skills?.readClaudeSkills,
    foreignSources: config.skills?.foreignSources,
    extraDirs: config.skills?.extraDirs,
  });
  container.bind(TOKENS.SkillLoader, () => skillLoader);

  const promptLoader = new DefaultPromptLoader({
    paths: wpaths,
    bundledDir: opts.bundledPromptsDir,
  });
  container.bind(TOKENS.PromptLoader, () => promptLoader);

  if (opts.systemPrompt) {
    container.bind(
      TOKENS.SystemPromptBuilder,
      () =>
        new DefaultSystemPromptBuilder({
          instructionPaths: {
            globalDir: wpaths.globalInstructions,
            projectDir: wpaths.inProjectInstructions,
          },
          skillMode: config.skills?.mode,
          skillEagerMaxChars: config.skills?.eagerMaxChars,
          // Super Memory's turn middleware owns memory injection — don't also
          // inject a static prompt section. Callers may override via
          // opts.systemPrompt if they truly want the static section.
          injectMemory: false,
          ...opts.systemPrompt,
        }),
    );
  }

  container.bind(TOKENS.PermissionPolicy, () => {
    const policyOptions: ConstructorParameters<typeof DefaultPermissionPolicy>[0] = {
      trustFile: wpaths.projectTrust,
      yolo: opts.permission?.yolo ?? false,
    };
    if (opts.permission?.promptDelegate !== undefined) {
      policyOptions.promptDelegate = opts.permission.promptDelegate;
    }
    return new DefaultPermissionPolicy(policyOptions);
  });

  container.bind(TOKENS.Compactor, () =>
    // Strategy comes from config.context.strategy: 'hybrid' (default, lossless
    // rules, no LLM), 'intelligent' (LLM summarization), or 'selective'
    // (LLM-driven selection). The LLM strategies resolve their provider from
    // ctx at compact()-time, so binding here (before context.provider exists)
    // is safe. preserveK / eliseThreshold are class-level fallbacks; the active
    // ContextWindowPolicy in ctx.meta normally overrides both at runtime.
    // eliseThreshold is a TOKEN COUNT — a previous value of 0.7 elided
    // essentially every tool_result (anything > 1 token).
    createStrategyCompactor({
      strategy: config.context?.strategy,
      preserveK: opts.compactor?.preserveK ?? 10,
      eliseThreshold: opts.compactor?.eliseThreshold ?? 2000,
      smart: true,
      summarizerModel: config.context?.summarizerModel,
      llmSelector: config.context?.llmSelector,
    }),
  );

  return container;
}
