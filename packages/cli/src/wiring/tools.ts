import type { TextBlock } from '@wrongstack/core';
import {
  type Config,
  configureChildEnvGitIdentity,
  createContextManagerTool,
  type DefaultModelsRegistry,
  DefaultModeStore,
  DefaultSkillLoader,
  DefaultSystemPromptBuilder,
  type MemoryStore,
  makeFleetStatusTool,
  makeMailboxTool,
  makeMailInboxTool,
  makeMailSendTool,
  normalizeTokenSavingTier,
  TOKENS,
  type ToolRegistry,
  type WstackPaths,
} from '@wrongstack/core';
import { registerCanonicalHostTools } from '@wrongstack/runtime/tool-registration';
import { configureDangerBypass, configureExecPolicy, makeSkillTool } from '@wrongstack/tools';
import { resolveBundledSkillsDir } from '../cli-bundled-skills.js';

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
  registerCanonicalHostTools({
    registry: toolRegistry,
    tier,
    contextTool: createContextManagerTool({ compactor: container.resolve(TOKENS.Compactor) }),
    memory: { enabled: config.features.memory, store: memoryStore },
    coordinationTools: [
      makeMailboxTool({ projectDir: wpaths.projectDir }),
      makeMailSendTool({ projectDir: wpaths.projectDir }),
      makeMailInboxTool({ projectDir: wpaths.projectDir }),
      makeFleetStatusTool({ projectDir: wpaths.projectDir }),
    ],
    descriptionMode: config.tools?.descriptionMode,
    resultRenderMode: config.tools?.resultRenderMode,
    disabledTools: config.tools?.disabledTools,
  });

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
