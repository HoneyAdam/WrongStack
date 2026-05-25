import {
  type DefaultModelsRegistry,
  DefaultSkillLoader,
  DefaultSystemPromptBuilder,
  type DefaultMemoryStore,
  DefaultModeStore,
  createContextManagerTool,
  type Config,
  type ToolRegistry,
  type WstackPaths,
  TOKENS,
} from '@wrongstack/core';
import {
  builtinToolsPack,
  forgetTool,
  rememberTool,
} from '@wrongstack/tools';
import type { TextBlock } from '@wrongstack/core';

export interface ToolsWiringDeps {
  config: Config;
  toolRegistry: ToolRegistry;
  modelsRegistry: DefaultModelsRegistry;
  memoryStore: DefaultMemoryStore;
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
  memoryStore: DefaultMemoryStore;
}

export async function setupTools(params: ToolsWiringDeps): Promise<ToolsWiringResult> {
  const { config, toolRegistry, modelsRegistry, memoryStore, wpaths, container, projectRoot, cwd } = params;

  // Tool registry — already created by caller, just configure it here
  toolRegistry.registerAllOrThrow([...(builtinToolsPack.tools ?? [])], builtinToolsPack.name);
  toolRegistry.registerDefault(
    createContextManagerTool({ compactor: container.resolve(TOKENS.Compactor) }),
  );
  if (config.features.memory) {
    toolRegistry.register(rememberTool(memoryStore));
    toolRegistry.register(forgetTool(memoryStore));
  }

  // Mode store
  const modeStore = new DefaultModeStore({ directory: wpaths.configDir });
  const activeMode = await modeStore.getActiveMode();
  const modeId = activeMode?.id ?? 'default';
  const modePrompt = activeMode?.prompt ?? '';

  // Skill loader
  const skillLoader = config.features.skills
    ? new DefaultSkillLoader({ paths: wpaths })
    : undefined;

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
    modeStore,
    modeId,
    modePrompt,
    modelCapabilities,
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