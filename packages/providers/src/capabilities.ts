import type { Capabilities, CustomModelDefinition, ModelsRegistry } from '@wrongstack/core';
import { capabilitiesForFamily } from './family-capabilities.js';

/**
 * Resolve capabilities for a (provider, model) pair using the family default
 * as a baseline and overlaying per-model facts from the ModelsRegistry.
 *
 * Priority chain (highest first):
 *  1. customModels[modelId].capabilities  — user-defined per-model overrides
 *  2. model facts from registry           — sub-fields AND-ed with base
 *  3. family default                      — e.g. 32K for openai-compatible
 */
export async function capabilitiesFor(
  registry: ModelsRegistry,
  providerId: string,
  modelId: string,
  customModels?: Record<string, CustomModelDefinition>,
): Promise<Capabilities> {
  const provider = await registry.getProvider(providerId);
  const base = capabilitiesForFamily(provider?.family ?? 'unsupported');

  // User-defined custom model overrides take top priority when present.
  const customDef = customModels?.[modelId];
  const customCaps = customDef?.capabilities;

  const model = await registry.getModel(providerId, modelId);

  // Without any model info at all, return base (possibly with custom overrides).
  if (!model && !customCaps) return { ...base };

  // maxContext resolution:
  //  1. customCaps.maxContext              — user explicitly overrides
  //  2. model.capabilities.maxContext      — registry getModel()
  //  3. raw model limit.context            — direct provider.models fallback
  //  4. base.maxContext                    — family default
  // maxOutput uses the same chain against `limit.output` (the models.dev
  // field that names the model's per-response output ceiling). It's the
  // driver for subagent `Request.maxTokens` (Chimera etc.) — keeping it
  // out of the family table means a fresh models.dev sync automatically
  // picks up new model ceilings without a code change.
  const rawModel = provider?.models.find((m) => m.id === modelId);
  const catalogMaxContext =
    model?.capabilities.maxContext ||
    rawModel?.limit?.context ||
    rawModel?.limit?.output ||
    base.maxContext;
  const catalogMaxOutput =
    model?.capabilities.maxOutput ||
    rawModel?.limit?.output ||
    base.maxOutput;

  // Per-field priority: customCaps (if set) → model facts AND-ed with base → base.
  // AND-ing with base is conservative: a model can't have a capability the
  // wire family doesn't support. Custom overrides skip this guard because
  // the user explicitly opted in.
  const modelTools = model?.capabilities.tools ?? false;
  const modelVision = model?.capabilities.vision ?? false;
  const modelReasoning = model?.capabilities.reasoning ?? false;

  return {
    ...base,
    // Capability booleans: AND model facts with base unless custom overrides
    tools: customCaps?.tools ?? (modelTools && base.tools),
    parallelTools: customCaps?.parallelTools ?? (modelTools && base.parallelTools),
    vision: customCaps?.vision ?? (modelVision && base.vision),
    reasoning: customCaps?.reasoning ?? modelReasoning,
    // Scalar fields: custom override wins, then catalog, then base
    maxContext: customCaps?.maxContext ?? catalogMaxContext,
    maxOutput: customCaps?.maxOutput ?? catalogMaxOutput,
    streaming: customCaps?.streaming ?? base.streaming,
    promptCache: customCaps?.promptCache ?? base.promptCache,
    systemPrompt: customCaps?.systemPrompt ?? base.systemPrompt,
    jsonMode: customCaps?.jsonMode ?? base.jsonMode,
    cacheControl: customCaps?.cacheControl ?? base.cacheControl,
    // Extended parameters: custom override wins, then family default
    topK: customCaps?.topK ?? base.topK,
    frequencyPenalty: customCaps?.frequencyPenalty ?? base.frequencyPenalty,
    presencePenalty: customCaps?.presencePenalty ?? base.presencePenalty,
    seed: customCaps?.seed ?? base.seed,
    structuredOutput: customCaps?.structuredOutput ?? base.structuredOutput,
    logprobs: customCaps?.logprobs ?? base.logprobs,
    audio: customCaps?.audio ?? base.audio,
    multipleCompletions: customCaps?.multipleCompletions ?? base.multipleCompletions,
  };
}
