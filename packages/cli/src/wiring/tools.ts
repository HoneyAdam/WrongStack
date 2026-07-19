import type { TextBlock, Tool } from '@wrongstack/core';
import {
  type Config,
  createContextManagerTool,
  type DefaultModelsRegistry,
  DefaultModeStore,
  DefaultSkillLoader,
  DefaultSystemPromptBuilder,
  applyToolDescriptionModes,
  applyToolResultRenderModes,
  configureChildEnvGitIdentity,
  makeMailboxTool,
  makeMailInboxTool,
  makeFleetStatusTool,
  makeMailSendTool,
  normalizeTokenSavingTier,
  type ConcreteTokenSavingTier,
  type MemoryStore,
  TOKENS,
  type ToolRegistry,
  type WstackPaths,
} from '@wrongstack/core';
import {
  builtinToolsPack,
  configureDangerBypass,
  configureExecPolicy,
  forgetTool,
  makeSkillTool,
  relatedMemoryTool,
  rememberTool,
  searchMemoryTool,
  TIER1_TOOLS,
  TIER2_TOOLS,
  TIER3_TOOLS,
} from '@wrongstack/tools';
import { resolveBundledSkillsDir } from '../cli-bundled-skills.js';
import {
  createSuperMemoryTools,
  type SuperMemoryServiceLike,
} from '@wrongstack/super-memory';

export interface ToolsWiringDeps {
  config: Config;
  toolRegistry: ToolRegistry;
  modelsRegistry: DefaultModelsRegistry;
  memoryStore: MemoryStore;
  wpaths: WstackPaths;
  projectRoot: string;
  cwd: string;
  container: { resolve<T>(tok: unknown): T; has(tok: unknown): boolean };
}

export interface ToolsWiringResult {
  toolRegistry: ToolRegistry;
  systemPrompt: Promise<TextBlock[]>;
  promptBuilder: DefaultSystemPromptBuilder;
  modeStore: DefaultModeStore;
  skillLoader: DefaultSkillLoader | undefined;
  memoryStore: MemoryStore;
}

/**
 * Returns the tools to register, filtered from `allTools` by tier.
 *
 * | Tier        | Tools returned                              |
 * |-------------|---------------------------------------------|
 * | 'off'       | allTools (no filtering)                    |
 * | 'minimal'   | TIER1 tools only                           |
 * | 'light'     | TIER1 tools only (guidance differs only)  |
 * | 'medium'    | TIER1 + TIER2 tools                       |
 * | 'aggressive'| TIER1 + TIER2 (minus task) + TIER3 (minus setWorkingDir) |
 *
 * Memory tools (remember, forget, searchMemory, relatedMemory) are NOT
 * included here — they are registered conditionally in setupTools() based
 * on `config.features.memory`.
 */
export function getToolsForTier(tier: ConcreteTokenSavingTier, allTools: Tool[]): Tool[] {
  const t1Names = new Set(TIER1_TOOLS.map((t) => t.name));
  const t2Names = new Set(TIER2_TOOLS.map((t) => t.name));
  const t3Names = new Set(TIER3_TOOLS.map((t) => t.name));

  switch (tier) {
    case 'off':
      return allTools;

    case 'minimal':
    case 'light':
      return allTools.filter((t) => t1Names.has(t.name));

    case 'medium':
      return allTools.filter((t) => t1Names.has(t.name) || t2Names.has(t.name));

    case 'aggressive':
      return allTools.filter(
        (t) =>
          t1Names.has(t.name) ||
          (t2Names.has(t.name) && t.name !== 'task') ||
          (t3Names.has(t.name) && t.name !== 'setWorkingDir'),
      );
  }
}

export async function setupTools(params: ToolsWiringDeps): Promise<ToolsWiringResult> {
  const { config, toolRegistry, modelsRegistry, memoryStore, wpaths, container, projectRoot, cwd } =
    params;

  // Apply the configured exec command policy (DEFAULT ∪ allow − deny). `allow`
  // is trusted-config-only — the config loader already stripped
  // `tools.exec.allow` from any in-project repo config before this point.
  configureExecPolicy(config.tools?.exec ?? {});
  configureDangerBypass(config.tools?.exec?.danger ?? {});
  // Commit identity for every git-touching child process. Trusted-config-only:
  // the loader strips `git` from repo-committed in-project configs.
  configureChildEnvGitIdentity(config.git?.identity ?? null);

  // Tool registry — already created by caller, just configure it here.
  // Determine token-saving tier (handles boolean backward-compat: true → 'medium')
  const tier = normalizeTokenSavingTier(config.features.tokenSavingMode);
  const allTools = builtinToolsPack.tools ?? [];
  const toolsToRegister = getToolsForTier(tier, allTools);
  toolRegistry.registerAllOrThrow([...toolsToRegister], builtinToolsPack.name);
  toolRegistry.registerDefault(
    createContextManagerTool({ compactor: container.resolve(TOKENS.Compactor) }),
  );
  // Register the inter-agent mailbox tools — resolve to the project-level
  // GlobalMailbox at runtime. mail_send/mail_inbox are the high-affordance
  // thin wrappers agents reach for autonomously.
  toolRegistry.register(makeMailboxTool({ projectDir: wpaths.projectDir }));
  toolRegistry.register(makeMailSendTool({ projectDir: wpaths.projectDir }));
  toolRegistry.register(makeMailInboxTool({ projectDir: wpaths.projectDir }));
  toolRegistry.register(makeFleetStatusTool({ projectDir: wpaths.projectDir }));
  if (config.features.memory) {
    // Super Memory owns the ENTIRE memory tool surface — remember/forget (full
    // structured args) + memory_update/memory_delete + memory_search/
    // memory_graph/memory_for_file/... reads. No legacy duplicates
    // (search_memory/find_related_memories) when super is active.
    // The legacy flat tools are only a fallback for a non-super store.
    // Keep this block in sync with registerBuiltinTools() (boot/tool-registry.ts)
    // and createPreContextServices() (webui-server/pre-context-services.ts).
    if (isSuperMemoryService(memoryStore)) {
      for (const tool of createSuperMemoryTools(memoryStore)) toolRegistry.register(tool);
    } else {
      toolRegistry.register(rememberTool(memoryStore));
      toolRegistry.register(forgetTool(memoryStore));
      toolRegistry.register(searchMemoryTool(memoryStore));
      toolRegistry.register(relatedMemoryTool(memoryStore));
    }
  }
  applyToolDescriptionModes(toolRegistry, config.tools?.descriptionMode);
  applyToolResultRenderModes(toolRegistry, config.tools?.resultRenderMode);
  // Apply disabled tools from config
  if (config.tools?.disabledTools) {
    toolRegistry.applyDisabled(config.tools.disabledTools);
  }

  // Mode store
  const modeStore = new DefaultModeStore({ directory: wpaths.configDir });
  const activeMode = await modeStore.getActiveMode();
  const modeId = activeMode?.id ?? 'default';
  const modePrompt = activeMode?.prompt ?? '';

  // Skill loader — discovers project, user, and bundled skills.
  // Bundled skills ship with @wrongstack/core (packages/core/skills/).
  const skillLoader = config.features.skills
    ? new DefaultSkillLoader({
        paths: wpaths,
        bundledDir: resolveBundledSkillsDir(),
        readClaudeSkills: config.skills?.readClaudeSkills,
        foreignSources: config.skills?.foreignSources,
        extraDirs: config.skills?.extraDirs,
      })
    : undefined;
  // Progressive-disclosure activation primitive: load a skill body on demand.
  if (skillLoader) {
    toolRegistry.register(makeSkillTool(skillLoader));
  }

  // Resolve model capabilities for system prompt
  const resolvedModel = await modelsRegistry.getModel(config.provider, config.model);
  const modelCapabilities = resolvedModel?.capabilities
    ? {
        maxContextTokens: resolvedModel.capabilities.maxContext,
        supportsTools: resolvedModel.capabilities.tools,
        supportsVision: resolvedModel.capabilities.vision,
        supportsReasoning: resolvedModel.capabilities.reasoning,
      }
    : undefined;

  // System prompt builder
  const promptBuilder = new DefaultSystemPromptBuilder({
    memoryStore,
    skillLoader,
    skillMode: config.skills?.mode,
    skillEagerMaxChars: config.skills?.eagerMaxChars,
    modeStore,
    modeId,
    modePrompt,
    modelCapabilities,
    tokenSavingMode: tier,
    instructionPaths: {
      globalDir: wpaths.globalInstructions,
      projectDir: wpaths.inProjectInstructions,
    },
  });

  const systemPrompt = promptBuilder.build({
    cwd,
    projectRoot,
    tools: toolRegistry.list(),
    provider: config.provider,
    model: config.model,
  });

  return { toolRegistry, systemPrompt, promptBuilder, modeStore, skillLoader, memoryStore };
}

function isSuperMemoryService(memoryStore: MemoryStore): memoryStore is SuperMemoryServiceLike {
  const value = memoryStore as unknown as Record<string, unknown>;
  return typeof value['retrieveForPath'] === 'function'
    && typeof value['searchSuper'] === 'function'
    && typeof value['graphFor'] === 'function'
    && typeof value['verify'] === 'function'
    && typeof value['hygiene'] === 'function';
}
