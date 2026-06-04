import type { Capabilities, ModelsRegistry } from '@wrongstack/core';
import { capabilitiesForFamily } from './family-capabilities.js';

/**
 * Resolve capabilities for a (provider, model) pair using the family default
 * as a baseline and overlaying per-model facts from the ModelsRegistry.
 *
 * Priority for maxContext:
 *  1. model.capabilities.maxContext  — from registry getModel() (limit.context)
 *  2. raw model limit.context         — direct from provider.models fallback
 *  3. base.maxContext                — family default (e.g. 32K for openai-compatible)
 */
export async function capabilitiesFor(
  registry: ModelsRegistry,
  providerId: string,
  modelId: string,
): Promise<Capabilities> {
  const provider = await registry.getProvider(providerId);
  const base = capabilitiesForFamily(provider?.family ?? 'unsupported');
  const model = await registry.getModel(providerId, modelId);
  if (!model) return { ...base };

  // maxContext priority: resolved model caps → raw model limit.context → family default
  const resolvedMaxContext = model.capabilities.maxContext;
  let maxContext = resolvedMaxContext;
  if (!maxContext && provider) {
    // Fallback: read limit.context directly from the raw model list
    const rawModel = provider.models.find((m) => m.id === modelId);
    maxContext = rawModel?.limit?.context ?? base.maxContext;
  } else if (!maxContext) {
    maxContext = base.maxContext;
  }

  return {
    ...base,
    tools: model.capabilities.tools && base.tools,
    parallelTools: model.capabilities.tools && base.parallelTools,
    vision: model.capabilities.vision && base.vision,
    maxContext,
  };
}
